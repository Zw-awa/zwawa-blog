/**
 * A deliberately small, dependency-free Markdown reader for the server.
 *
 * This module is designed to run in a Cloudflare Worker. It does not use
 * Node APIs, a DOM, or dynamic code evaluation. The renderer is intentionally
 * conservative: source HTML is always escaped and only a small set of URL
 * schemes is allowed in generated links and images.
 */

export type FrontmatterScalar = string | number | boolean | null;
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[];
export type FrontmatterData = Record<string, FrontmatterValue>;

export interface ParsedFrontmatter {
  /** Parsed key/value pairs. */
  data: FrontmatterData;
  /** Markdown after the frontmatter fence. */
  content: string;
  /** Alias for content, useful to callers that use the term body. */
  body: string;
  /** The text between the opening and closing fences, or null. */
  frontmatter: string | null;
  /** Whether an opening and closing frontmatter fence were found. */
  hasFrontmatter: boolean;
}

export interface MarkdownRenderOptions {
  /** Add deterministic id attributes to headings. Defaults to false. */
  headingIds?: boolean;
  /** Maximum number of nested inline parses. Defaults to 8. */
  maxInlineDepth?: number;
}

export interface ExcerptOptions {
  /** Maximum length, including the suffix. Defaults to 160. */
  maxLength?: number;
  /** Suffix used when text is truncated. Defaults to "...". */
  suffix?: string;
}

export interface ParsedMarkdown extends ParsedFrontmatter {
  html: string;
  text: string;
  excerpt: string;
  /** Internal block representation, exposed for callers that need metadata. */
  blocks: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; blocks: MarkdownBlock[] }
  | {
      type: "list";
      ordered: boolean;
      start?: number;
      items: MarkdownBlock[][];
    }
  | { type: "code"; language?: string; value: string }
  | { type: "thematicBreak" };

const DEFAULT_EXCERPT_LENGTH = 160;
const DEFAULT_INLINE_DEPTH = 8;
const FORBIDDEN_FRONTMATTER_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Escape text for use in HTML text nodes and attributes. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripUnsafeControlCharacters(value: string): string {
  // Keep ordinary spaces and unicode text, but remove characters browsers can
  // silently discard while parsing an href/src attribute.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function decodePercentForScheme(value: string): string {
  let current = value;
  // A few rounds catch nested encodings without allowing an attacker to cause
  // unbounded work. decodeURIComponent can throw for malformed escapes.
  for (let i = 0; i < 3; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

function decodeUrlEntities(value: string): string {
  // Browsers decode character references in attributes. Decode the numeric
  // forms and the handful of named whitespace entities relevant to schemes so
  // that e.g. "&#106;avascript:" cannot bypass the scheme check.
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    })
    .replace(/&#([0-9]+);?/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    })
    .replace(/&colon;?/gi, ":")
    .replace(/&Tab;?/gi, "\t")
    .replace(/&NewLine;?/gi, "\n");
}

/**
 * Return a URL safe to put in an href/src attribute, or null when it is not
 * safe. Relative URLs, fragments, and query strings are accepted for links
 * within the site; external URLs are limited to http(s) and mailto.
 */
export function sanitizeUrl(value: string): string | null {
  if (typeof value !== "string") return null;

  let candidate = value.trim();
  if (!candidate) return null;
  candidate = stripUnsafeControlCharacters(candidate);
  if (!candidate || candidate.includes("\\")) return null;

  const forCheck = decodePercentForScheme(decodeUrlEntities(candidate))
    .replace(/[\u0000-\u0020\u007f]/g, "")
    .toLowerCase();

  // Explicitly reject dangerous schemes, including encoded and mixed-case
  // variants. Unknown schemes are rejected below as well.
  if (/^(?:javascript|data|vbscript|file|blob|filesystem|about):/.test(forCheck)) {
    return null;
  }

  const scheme = forCheck.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
  if (scheme && scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
    return null;
  }

  if (/^(?:https?:|mailto:)/i.test(candidate)) return candidate;
  // Protocol-relative URLs inherit the page's scheme and can be surprising in
  // an exported document, so require an explicit http(s) scheme instead.
  if (candidate.startsWith("//")) return null;
  if (candidate.startsWith("/") || candidate.startsWith("./") || candidate.startsWith("../")) {
    return candidate;
  }
  if (candidate.startsWith("#") || candidate.startsWith("?")) return candidate;
  // A bare path such as "notes/today" is safe and useful in Markdown.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return candidate;
  return null;
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_[\]{}()#+.!<>-])/g, "$1");
}

function removeUnescapedClosing(value: string): string {
  return value.replace(/[ \t]+#+[ \t]*$/, "").trim();
}

function findUnescaped(value: string, needle: string, start: number): number {
  for (let i = start; i <= value.length - needle.length; i += 1) {
    if (value[i] !== needle[0] || value.slice(i, i + needle.length) !== needle) continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && value[j] === "\\"; j -= 1) slashes += 1;
    if (slashes % 2 === 0) return i;
  }
  return -1;
}

interface LinkParts {
  label: string;
  destination: string;
  title?: string;
  end: number;
}

interface ImagePresentation {
  width?: number;
  crop?: "1:1" | "4:3" | "16:9" | "3:4" | [number, number, number, number];
  ratio?: number;
  position?: "center" | "top" | "bottom" | "left" | "right";
  end: number;
}

function parseImagePresentation(value: string, start: number): ImagePresentation | null {
  if (value[start] !== "{") return null;
  const closing = value.indexOf("}", start + 1);
  if (closing < 0) return null;
  const tokens = value.slice(start + 1, closing).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const presentation: ImagePresentation = { end: closing + 1 };
  for (const token of tokens) {
    const [key, setting, extra] = token.split("=");
    if (!setting || extra !== undefined) return null;
    if (key === "width" && /^\d{1,3}$/.test(setting)) {
      const width = Number(setting);
      if (width < 20 || width > 100) return null;
      presentation.width = width;
      continue;
    }
    if (key === "crop") {
      if (/^(?:1:1|4:3|16:9|3:4)$/.test(setting)) {
        presentation.crop = setting as ImagePresentation["crop"];
        continue;
      }
      const crop = setting.split(",").map(Number);
      if (crop.length === 4 && crop.every(Number.isFinite) && crop[0] >= 0 && crop[1] >= 0 && crop[2] >= 5 && crop[3] >= 5 && crop[0] + crop[2] <= 100.01 && crop[1] + crop[3] <= 100.01) {
        presentation.crop = crop as [number, number, number, number];
        continue;
      }
      return null;
    }
    if (key === "ratio" && /^\d+(?:\.\d+)?$/.test(setting)) {
      const ratio = Number(setting);
      if (ratio < 0.1 || ratio > 20) return null;
      presentation.ratio = ratio;
      continue;
    }
    if (key === "position" && /^(?:center|top|bottom|left|right)$/.test(setting)) {
      presentation.position = setting as ImagePresentation["position"];
      continue;
    }
    return null;
  }
  return presentation;
}

function parseLinkAt(value: string, start: number): LinkParts | null {
  const labelEnd = findUnescaped(value, "]", start + 1);
  if (labelEnd < 0 || value[labelEnd + 1] !== "(") return null;

  let cursor = labelEnd + 2;
  while (cursor < value.length && /[ \t\n]/.test(value[cursor])) cursor += 1;
  let destination = "";
  if (value[cursor] === "<") {
    const destinationEnd = findUnescaped(value, ">", cursor + 1);
    if (destinationEnd < 0) return null;
    destination = value.slice(cursor + 1, destinationEnd);
    cursor = destinationEnd + 1;
  } else {
    const destinationStart = cursor;
    let depth = 0;
    while (cursor < value.length) {
      const character = value[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      if (depth === 0 && /[ \t\n]/.test(character)) break;
      cursor += 1;
    }
    destination = value.slice(destinationStart, cursor);
  }

  while (cursor < value.length && /[ \t\n]/.test(value[cursor])) cursor += 1;
  let title: string | undefined;
  if (value[cursor] === '"' || value[cursor] === "'" || value[cursor] === "(") {
    const opener = value[cursor];
    const closer = opener === "(" ? ")" : opener;
    const titleEnd = findUnescaped(value, closer, cursor + 1);
    if (titleEnd < 0) return null;
    title = value.slice(cursor + 1, titleEnd);
    cursor = titleEnd + 1;
    while (cursor < value.length && /[ \t\n]/.test(value[cursor])) cursor += 1;
  }
  if (value[cursor] !== ")") return null;
  return {
    label: value.slice(start + 1, labelEnd),
    destination: unescapeMarkdown(destination),
    title: title === undefined ? undefined : unescapeMarkdown(title),
    end: cursor + 1,
  };
}

function findCodeSpanEnd(value: string, start: number, length: number): number {
  const needle = "`".repeat(length);
  return findUnescaped(value, needle, start + length);
}

function safeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.trim().split(/[ \t]/)[0];
  if (!first || !/^[A-Za-z0-9][A-Za-z0-9_+.#-]*$/.test(first)) return undefined;
  return first;
}

function plainInline(value: string, depth: number, maxDepth: number): string {
  return renderInline(value, "text", depth, maxDepth);
}

function renderInline(
  value: string,
  mode: "html" | "text",
  depth = 0,
  maxDepth = DEFAULT_INLINE_DEPTH,
): string {
  if (!value) return "";
  if (depth > maxDepth) return mode === "html" ? escapeHtml(value) : value;

  let output = "";
  let plain = "";
  const flushPlain = () => {
    if (!plain) return;
    output += mode === "html" ? escapeHtml(plain) : plain;
    plain = "";
  };

  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];

    if (character === "\\" && i + 1 < value.length && /[\\`*_[\]{}()#+.!<>-]/.test(value[i + 1])) {
      plain += value[i + 1];
      i += 1;
      continue;
    }

    if (character === "`") {
      let run = 1;
      while (value[i + run] === "`") run += 1;
      const end = findCodeSpanEnd(value, i, run);
      if (end >= 0) {
        flushPlain();
        let code = value.slice(i + run, end);
        if (/^\s[\s\S]*\s$/.test(code) && /\S/.test(code)) code = code.slice(1, -1);
        output += mode === "html" ? `<code>${escapeHtml(code)}</code>` : code;
        i = end + run - 1;
        continue;
      }
      plain += "`".repeat(run);
      i += run - 1;
      continue;
    }

    if ((character === "!" && value[i + 1] === "[") || character === "[") {
      const image = character === "!";
      const start = image ? i + 1 : i;
      const link = parseLinkAt(value, start);
      if (link) {
        flushPlain();
        const destination = sanitizeUrl(link.destination);
        const presentation = image ? parseImagePresentation(value, link.end) : null;
        // Render link labels in the requested mode. In particular, an HTML
        // label such as `[<img src=x>](https://example.com)` must remain
        // escaped rather than being inserted into the generated anchor.
        const labelText = mode === "html"
          ? renderInline(link.label, "html", depth + 1, maxDepth)
          : plainInline(link.label, depth + 1, maxDepth);
        if (mode === "text") {
          output += labelText;
        } else if (!destination) {
          // Keep the visible label while dropping an unsafe destination.
          output += labelText;
        } else if (image) {
          const alt = escapeHtml(plainInline(link.label, depth + 1, maxDepth));
          const width = presentation?.width ? `width:${presentation.width}%` : "";
          const legacyCrop = typeof presentation?.crop === "string" ? `aspect-ratio:${presentation.crop.replace(":", "/")};object-fit:cover` : "";
          const position = presentation?.position ? `object-position:${presentation.position}` : "";
          const style = [width, legacyCrop, position].filter(Boolean).join(";");
          const attributes = presentation ? value.slice(link.end, presentation.end) : "";
          const source = value.slice(i, link.end) + attributes;
          if (Array.isArray(presentation?.crop) && presentation.ratio) {
            const [x, y, cropWidth, cropHeight] = presentation.crop;
            const frameStyle = [width || "width:100%", `aspect-ratio:${presentation.ratio}`].join(";");
            const imageStyle = `width:${10000 / cropWidth}%;max-width:none;left:-${(x / cropWidth) * 100}%;top:-${(y / cropHeight) * 100}%`;
            output += `<span class="markdown-image-crop" style="${frameStyle}"><img src="${escapeHtml(destination)}" alt="${alt}" loading="lazy" decoding="async" data-markdown-source="${escapeHtml(source)}" style="${imageStyle}"></span>`;
          } else {
            output += `<img src="${escapeHtml(destination)}" alt="${alt}" loading="lazy" decoding="async" data-markdown-source="${escapeHtml(source)}"${presentation?.crop ? ` data-image-crop="${presentation.crop}"` : ""}${style ? ` style="${style}"` : ""}>`;
          }
        } else {
          const title = link.title ? ` title="${escapeHtml(link.title)}"` : "";
          output += `<a href="${escapeHtml(destination)}"${title}>${labelText}</a>`;
        }
        i = (presentation?.end ?? link.end) - 1;
        continue;
      }
    }

    if (character === "<") {
      const autoEnd = findUnescaped(value, ">", i + 1);
      if (autoEnd >= 0) {
        const candidate = value.slice(i + 1, autoEnd);
        if (/^(?:https?:\/\/|mailto:)[^ <>]+$/i.test(candidate)) {
          const destination = sanitizeUrl(candidate);
          if (destination) {
            flushPlain();
            output += mode === "html" ? `<a href="${escapeHtml(destination)}">${escapeHtml(candidate)}</a>` : candidate;
            i = autoEnd;
            continue;
          }
        }
      }
    }

    let marker = "";
    if (value.slice(i, i + 2) === "**" || value.slice(i, i + 2) === "__" || value.slice(i, i + 2) === "~~") {
      marker = value.slice(i, i + 2);
    } else if (character === "*" || character === "_") {
      marker = character;
    }
    if (marker) {
      const end = findUnescaped(value, marker, i + marker.length);
      if (end > i + marker.length && /\S/.test(value.slice(i + marker.length, end))) {
        // Underscores inside a word are ordinary characters, not emphasis.
        if (marker.includes("_") && i > 0 && /[A-Za-z0-9]/.test(value[i - 1]) && end + marker.length < value.length && /[A-Za-z0-9]/.test(value[end + marker.length])) {
          plain += marker;
          continue;
        }
        flushPlain();
        const inner = renderInline(value.slice(i + marker.length, end), mode, depth + 1, maxDepth);
        if (mode === "html") {
          const tag = marker === "~~" ? "del" : marker.length === 2 ? "strong" : "em";
          output += `<${tag}>${inner}</${tag}>`;
        } else {
          output += inner;
        }
        i = end + marker.length - 1;
        continue;
      }
    }

    if (character === "\n") {
      const hardBreak = / {2,}$/.test(plain);
      plain = plain.replace(/ {2,}$/, "");
      flushPlain();
      output += mode === "html" ? (hardBreak ? "<br>\n" : "\n") : "\n";
      continue;
    }

    plain += character;
  }
  flushPlain();
  return output;
}

function leadingSpaces(value: string): number {
  const match = value.match(/^ */);
  return match ? match[0].length : 0;
}

interface ListMarker {
  indent: number;
  ordered: boolean;
  markerLength: number;
  text: string;
  start?: number;
}

function matchListMarker(value: string): ListMarker | null {
  const match = value.match(/^( {0,})(?:(\d+)[.)]|([-+*]))[ \t]+(.*)$/);
  if (!match) return null;
  const indent = match[1].length;
  const ordered = Boolean(match[2]);
  return {
    indent,
    ordered,
    markerLength: match[0].length - match[4].length,
    text: match[4],
    start: ordered ? Number.parseInt(match[2], 10) : undefined,
  };
}

function isThematicBreak(value: string): boolean {
  return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(value);
}

function matchFence(value: string): { character: "`" | "~"; length: number; info: string } | null {
  const match = value.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
  if (!match) return null;
  return {
    character: match[1][0] as "`" | "~",
    length: match[1].length,
    info: match[2].trim(),
  };
}

function isBlockStart(value: string): boolean {
  return Boolean(
    matchFence(value) ||
      /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(value) ||
      /^ {0,3}>/.test(value) ||
      matchListMarker(value) ||
      isThematicBreak(value) ||
      /^ {4}/.test(value),
  );
}

function stripIndent(value: string, count: number): string {
  let remaining = count;
  let index = 0;
  while (remaining > 0 && value[index] === " ") {
    index += 1;
    remaining -= 1;
  }
  return value.slice(index);
}

function parseList(lines: string[], start: number, first: ListMarker): { block: MarkdownBlock; next: number } {
  const items: MarkdownBlock[][] = [];
  let index = start;
  while (index < lines.length) {
    const marker = matchListMarker(lines[index]);
    if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) break;
    const itemLines: string[] = [marker.text];
    index += 1;
    while (index < lines.length) {
      const nextMarker = matchListMarker(lines[index]);
      if (nextMarker && nextMarker.indent === first.indent && nextMarker.ordered === first.ordered) break;
      if (lines[index].trim() === "") {
        // Keep a blank when it introduces an indented continuation; otherwise
        // consume it and let the outer parser handle the next block.
        const lookahead = lines[index + 1];
        if (lookahead !== undefined && (leadingSpaces(lookahead) > first.indent || matchListMarker(lookahead)?.indent === first.indent)) {
          itemLines.push("");
          index += 1;
          continue;
        }
        index += 1;
        break;
      }
      const indent = leadingSpaces(lines[index]);
      if (indent > first.indent) {
        itemLines.push(stripIndent(lines[index], first.indent + 2));
        index += 1;
        continue;
      }
      // CommonMark permits a lazy continuation line at the marker's indent.
      if (itemLines.length === 1 && !isBlockStart(lines[index])) {
        itemLines.push(lines[index]);
        index += 1;
        continue;
      }
      break;
    }
    items.push(parseBlocks(itemLines));
  }
  return {
    block: {
      type: "list",
      ordered: first.ordered,
      start: first.ordered ? first.start : undefined,
      items,
    },
    next: index,
  };
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const fence = matchFence(lines[index]);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closing = lines[index].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
          index += 1;
          break;
        }
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", language: safeLanguage(fence.info), value: codeLines.join("\n") });
      continue;
    }

    const heading = lines[index].match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)\s*|$)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: removeUnescapedClosing(heading[2] || "") });
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && lines[index].trim() && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1])) {
      blocks.push({
        type: "heading",
        level: lines[index + 1].trim().startsWith("=") ? 1 : 2,
        text: lines[index].trim(),
      });
      index += 2;
      continue;
    }

    if (/^ {0,3}>/.test(lines[index])) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        if (/^ {0,3}>/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^ {0,3}>[ \t]?/, ""));
          index += 1;
          continue;
        }
        if (!lines[index].trim() && /^ {0,3}>/.test(lines[index + 1] || "")) {
          quoteLines.push("");
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "blockquote", blocks: parseBlocks(quoteLines) });
      continue;
    }

    const list = matchListMarker(lines[index]);
    if (list && list.indent <= 3) {
      const parsed = parseList(lines, index, list);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    if (isThematicBreak(lines[index])) {
      blocks.push({ type: "thematicBreak" });
      index += 1;
      continue;
    }

    if (/^ {4}/.test(lines[index])) {
      const codeLines: string[] = [];
      while (index < lines.length && (lines[index].trim() || /^ {4}/.test(lines[index]))) {
        codeLines.push(stripIndent(lines[index], 4));
        index += 1;
      }
      blocks.push({ type: "code", value: codeLines.join("\n") });
      continue;
    }

    const paragraphLines: string[] = [lines[index]];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function headingId(value: string): string {
  const plain = plainInline(value, 0, DEFAULT_INLINE_DEPTH)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return plain || "section";
}

function renderBlockHtml(block: MarkdownBlock, options: Required<MarkdownRenderOptions>): string {
  switch (block.type) {
    case "heading": {
      const id = options.headingIds ? ` id="${escapeHtml(headingId(block.text))}"` : "";
      return `<h${block.level}${id}>${renderInline(block.text, "html", 0, options.maxInlineDepth)}</h${block.level}>`;
    }
    case "paragraph":
      return `<p>${renderInline(block.text, "html", 0, options.maxInlineDepth)}</p>`;
    case "blockquote":
      return `<blockquote>\n${renderBlocksHtml(block.blocks, options)}\n</blockquote>`;
    case "code": {
      const className = block.language ? ` class="language-${escapeHtml(block.language)}"` : "";
      return `<pre><code${className}>${escapeHtml(block.value)}</code></pre>`;
    }
    case "thematicBreak":
      return "<hr>";
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.start !== undefined && block.start !== 1 ? ` start="${block.start}"` : "";
      const items = block.items
        .map((item) => {
          const rendered = renderBlocksHtml(item, options);
          // Tight list items are more useful to consumers when they do not gain
          // an unnecessary paragraph wrapper.
          const compact = item.length === 1 && item[0].type === "paragraph" ? renderInline(item[0].text, "html", 0, options.maxInlineDepth) : rendered;
          return `<li>${compact}</li>`;
        })
        .join("\n");
      return `<${tag}${start}>\n${items}\n</${tag}>`;
    }
  }
}

function renderBlocksHtml(blocks: MarkdownBlock[], options: Required<MarkdownRenderOptions>, markBlocks = false): string {
  return blocks.map((block, index) => {
    const html = renderBlockHtml(block, options);
    return markBlocks ? html.replace(/^<([a-z][a-z0-9]*)/, `<$1 data-markdown-block="${index}"`) : html;
  }).join("\n\n");
}

function renderBlockText(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return plainInline(block.text, 0, DEFAULT_INLINE_DEPTH);
    case "blockquote":
      return block.blocks.map(renderBlockText).filter(Boolean).join("\n\n");
    case "code":
      return block.value;
    case "thematicBreak":
      return "";
    case "list":
      return block.items.map((item) => item.map(renderBlockText).filter(Boolean).join("\n\n")).filter(Boolean).join("\n");
  }
}

function renderBlocksText(blocks: MarkdownBlock[]): string {
  return blocks.map(renderBlockText).filter((value) => value.length > 0).join("\n\n");
}

/** Parse frontmatter and return the remaining Markdown body. */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = normalizeLineEndings(String(source));
  const lines = normalized.split("\n");
  if (lines.length === 0 || !/^(?:\uFEFF)?---[ \t]*$/.test(lines[0])) {
    return { data: nullRecord<FrontmatterValue>(), content: normalized, body: normalized, frontmatter: null, hasFrontmatter: false };
  }

  let closing = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) {
      closing = i;
      break;
    }
  }
  if (closing < 0) {
    return { data: nullRecord<FrontmatterValue>(), content: normalized, body: normalized, frontmatter: null, hasFrontmatter: false };
  }

  const raw = lines.slice(1, closing).join("\n");
  const content = lines.slice(closing + 1).join("\n");
  const data = parseFrontmatterValues(raw);
  return { data, content, body: content, frontmatter: raw, hasFrontmatter: true };
}

function stripYamlComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    if (quote) {
      if (character === quote && value[i - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trim();
}

function splitInlineList(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    if (quote) {
      if (character === quote && value[i - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[" || character === "{") depth += 1;
    if (character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      result.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter((item) => item.length > 0);
}

function parseYamlScalar(input: string): FrontmatterValue {
  const value = stripYamlComment(input);
  if (!value || value === "~" || /^null$/i.test(value)) return null;
  if (/^(?:true|false)$/i.test(value)) return value.toLowerCase() === "true";

  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInlineList(value.slice(1, -1)).map((item) => {
      const parsed = parseYamlScalar(item);
      return Array.isArray(parsed) || (parsed !== null && typeof parsed === "object") ? String(item) : parsed;
    });
  }

  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return value;
}

function parseFrontmatterValues(raw: string): FrontmatterData {
  const lines = raw.split("\n");
  const result = nullRecord<FrontmatterValue>();
  let index = 0;
  while (index < lines.length) {
    const original = lines[index];
    const trimmed = original.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      index += 1;
      continue;
    }
    const match = original.match(/^\s*([^:#][^:]*?)\s*:\s*(.*)$/);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1].trim();
    if (!key || FORBIDDEN_FRONTMATTER_KEYS.has(key)) {
      index += 1;
      continue;
    }
    const valueText = match[2].trim();

    if (valueText === "|" || valueText === ">") {
      const collected: string[] = [];
      index += 1;
      while (index < lines.length) {
        const next = lines[index];
        if (next.trim() && leadingSpaces(next) === 0 && /^\s*[^:#][^:]*\s*:/.test(next)) break;
        collected.push(next.replace(/^ {2}/, ""));
        index += 1;
      }
      const joined = valueText === ">" ? collected.join(" ").replace(/\s+\n\s+/g, " ") : collected.join("\n");
      Object.defineProperty(result, key, { value: joined.replace(/\n+$/, ""), enumerable: true, writable: true, configurable: true });
      continue;
    }

    if (!valueText) {
      const list: FrontmatterScalar[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const item = lines[cursor].match(/^\s+-\s+(.*)$/);
        if (!item) break;
        const parsed = parseYamlScalar(item[1]);
        list.push(Array.isArray(parsed) ? String(item[1]) : parsed);
        cursor += 1;
      }
      if (list.length > 0) {
        Object.defineProperty(result, key, { value: list, enumerable: true, writable: true, configurable: true });
        index = cursor;
        continue;
      }
    }

    Object.defineProperty(result, key, { value: parseYamlScalar(valueText), enumerable: true, writable: true, configurable: true });
    index += 1;
  }
  return result;
}

function isPlainYamlString(value: string): boolean {
  if (!value || value.trim() !== value || /[\r\n]/.test(value)) return false;
  if (/^[\[\]{},&*#?|>!%@`]/.test(value) || /:\s|\s#/.test(value)) return false;
  if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)) return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return false;
  return true;
}

function serializeYamlValue(value: FrontmatterValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => serializeYamlValue(item)).join(", ")}]`;
  return isPlainYamlString(value) ? value : JSON.stringify(value);
}

/** Serialize frontmatter and, optionally, append a Markdown body. */
export function serializeFrontmatter(data: FrontmatterData, content = ""): string {
  const lines: string[] = [];
  for (const key of Object.keys(data || {})) {
    if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) continue;
    const safeKey = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
    const value = data[key];
    if (typeof value === "string" && /[\r\n]/.test(value)) {
      lines.push(`${safeKey}: |`);
      for (const line of normalizeLineEndings(value).split("\n")) lines.push(`  ${line}`);
    } else {
      lines.push(`${safeKey}: ${serializeYamlValue(value)}`);
    }
  }
  const body = normalizeLineEndings(String(content));
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export const stringifyFrontmatter = serializeFrontmatter;

function resolvedRenderOptions(options?: MarkdownRenderOptions): Required<MarkdownRenderOptions> {
  return {
    headingIds: options?.headingIds === true,
    maxInlineDepth: Number.isFinite(options?.maxInlineDepth) && (options?.maxInlineDepth || 0) > 0 ? Math.floor(options!.maxInlineDepth!) : DEFAULT_INLINE_DEPTH,
  };
}

/** Render Markdown as safe HTML. Frontmatter is omitted from the output. */
export function renderMarkdown(source: string, options?: MarkdownRenderOptions): string {
  const parsed = parseFrontmatter(source);
  const blocks = parseBlocks(parsed.content.split("\n"));
  return renderBlocksHtml(blocks, resolvedRenderOptions(options), true);
}

export const markdownToHtml = renderMarkdown;

/** Convert Markdown to readable plain text, omitting formatting markers. */
export function markdownToPlainText(source: string): string {
  const parsed = parseFrontmatter(source);
  const blocks = parseBlocks(parsed.content.split("\n"));
  return renderBlocksText(blocks).trim();
}

export const stripMarkdown = markdownToPlainText;

function excerptFromText(text: string, options?: number | ExcerptOptions): string {
  const resolved = typeof options === "number" ? { maxLength: options, suffix: "..." } : options || {};
  const maxLength = Number.isFinite(resolved.maxLength) ? Math.max(0, Math.floor(resolved.maxLength!)) : DEFAULT_EXCERPT_LENGTH;
  const suffix = resolved.suffix === undefined ? "..." : String(resolved.suffix);
  const normalized = text.replace(/\s+/g, " ").trim();
  if (maxLength === 0) return "";
  if (Array.from(normalized).length <= maxLength) return normalized;
  const suffixLength = Array.from(suffix).length;
  if (suffixLength >= maxLength) return Array.from(normalized).slice(0, maxLength).join("");
  const room = maxLength - suffixLength;
  let head = Array.from(normalized).slice(0, room).join("").trimEnd();
  // Avoid ending in the middle of a word where there is a natural boundary.
  const boundary = head.lastIndexOf(" ");
  if (boundary > Math.floor(room * 0.55)) head = head.slice(0, boundary);
  return `${head}${suffix}`;
}

/** Extract a whitespace-normalized excerpt from Markdown. */
export function extractExcerpt(source: string, options?: number | ExcerptOptions): string {
  return excerptFromText(markdownToPlainText(source), options);
}

/** Parse once and return all commonly needed representations. */
export function parseMarkdown(source: string, options?: MarkdownRenderOptions & ExcerptOptions): ParsedMarkdown {
  const parsed = parseFrontmatter(source);
  const blocks = parseBlocks(parsed.content.split("\n"));
  const resolved = resolvedRenderOptions(options);
  const text = renderBlocksText(blocks).trim();
  return {
    ...parsed,
    blocks,
    html: renderBlocksHtml(blocks, resolved, true),
    text,
    excerpt: excerptFromText(text, options),
  };
}

export const parseMarkdownDocument = parseMarkdown;
