import { describe, expect, it } from "vitest";
import { markdownToHtml, parseFrontmatter, serializeFrontmatter } from "../src/lib/server/markdown";
import { normalizeSlug, validateContentCreate, validateContentPatch } from "../src/lib/server/validation";

describe("content validation", () => {
  it("keeps readable Chinese slugs and normalizes separators", () => {
    expect(normalizeSlug("  泰拉瑞亚 多人世界__第一夜  ")).toBe("泰拉瑞亚-多人世界-第一夜");
  });

  it("creates a safe draft with stable defaults", () => {
    const value = validateContentCreate({
      type: "article",
      title: "第一篇文章",
      bodyMarkdown: "# Hello",
      tags: ["Astro", "astro", "Cloudflare"]
    });
    expect(value.status).toBe("draft");
    expect(value.slug).toBe("第一篇文章");
    expect(value.tags).toEqual(["astro", "Cloudflare"]);
    expect(value.publishedAt).toBeNull();
  });

  it("clears the publication date when a post is unpublished", () => {
    const current = {
      id: "post-1",
      ...validateContentCreate({
        type: "article",
        status: "published",
        title: "Published",
        slug: "published",
        summary: "Summary",
        bodyMarkdown: "Body"
      }),
      media: [],
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    expect(validateContentPatch({ status: "draft" }, current).publishedAt).toBeNull();
  });
});

describe("Markdown boundaries", () => {
  it("round-trips the supported Obsidian frontmatter fields", () => {
    const source = serializeFrontmatter({
      id: "post-1",
      title: "Hello",
      tags: ["one", "two"],
      publishedAt: null
    }, "# Body");
    const parsed = parseFrontmatter(source);
    expect(parsed.data.title).toBe("Hello");
    expect(parsed.data.tags).toEqual(["one", "two"]);
    expect(parsed.content).toBe("# Body");
  });

  it("escapes raw HTML and rejects executable link schemes", () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders constrained image presentation settings", () => {
    const html = markdownToHtml("![Cover](/media/cover){width=60 crop=16:9 position=top}");
    expect(html).toContain('style="width:60%;aspect-ratio:16/9;object-fit:cover;object-position:top"');
    expect(html).toContain('data-image-crop="16:9"');
    expect(html).not.toContain(">{width=60");
  });

  it("leaves unsupported image settings as ordinary text", () => {
    const html = markdownToHtml("![Cover](/media/cover){width=999 onclick=bad}");
    expect(html).not.toContain('style="width:999');
    expect(html).toContain("{width=999 onclick=bad}");
  });
});
