import TurndownService from "turndown";
import { sanitizeUrl } from "../server/markdown";

const REMOVED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "link",
  "base",
  "template",
  "svg",
  "math",
]);

function markdownDestination(value: string): string {
  return `<${value.replace(/ /g, "%20").replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
}

function markdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, "\\$1").replace(/[\r\n]+/g, " ").trim();
}

function markdownTitle(value: string | null): string {
  if (!value) return "";
  const normalized = value.replace(/[\r\n]+/g, " ").replace(/([\\\"])/g, "\\$1").trim();
  return normalized ? ` \"${normalized}\"` : "";
}

function safeImageUrl(value: string): string | null {
  const url = sanitizeUrl(value);
  return url && !/^mailto:/i.test(url) ? url : null;
}

function createConverter(): TurndownService {
  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  converter.remove((node) => REMOVED_TAGS.has(node.nodeName.toLowerCase()));
  converter.addRule("safe-link", {
    filter: (node) => node.nodeName === "A",
    replacement: (content, node) => {
      const href = sanitizeUrl(node.getAttribute("href") ?? "");
      if (!href) return content;
      return `[${content}](${markdownDestination(href)}${markdownTitle(node.getAttribute("title"))})`;
    },
  });
  converter.addRule("safe-image", {
    filter: (node) => node.nodeName === "IMG",
    replacement: (_content, node) => {
      const src = safeImageUrl(node.getAttribute("src") ?? "");
      if (!src) return markdownLabel(node.getAttribute("alt") ?? "");
      const alt = markdownLabel(node.getAttribute("alt") ?? "");
      return `![${alt}](${markdownDestination(src)}${markdownTitle(node.getAttribute("title"))})`;
    },
  });
  return converter;
}

const converter = createConverter();

export function htmlToSafeMarkdown(html: string): string {
  const source = String(html).replace(/\u0000/g, "");
  return converter.turndown(source).replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
