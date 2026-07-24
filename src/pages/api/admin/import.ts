import type { APIRoute } from "astro";
import { requireAdmin } from "../../../lib/server/auth";
import { createContent, getContentById, updateContent } from "../../../lib/server/content-repository";
import { getDb } from "../../../lib/server/env";
import { AppError } from "../../../lib/server/errors";
import { apiHandler, ok, readJson } from "../../../lib/server/http";
import { extractExcerpt, parseFrontmatter } from "../../../lib/server/markdown";
import { validateContentCreate, validateContentPatch } from "../../../lib/server/validation";

export const prerender = false;

function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export const POST: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const payload = await readJson<{ markdown?: unknown; commit?: unknown; confirm?: unknown }>(context.request, 2_200_000);
  if (typeof payload.markdown !== "string") throw new AppError(422, "validation_error", "markdown 必须是字符串。" );
  const parsed = parseFrontmatter(payload.markdown);
  const id = scalar(parsed.data.id);
  const db = getDb(context.locals);
  const existing = id ? await getContentById(db, id) : null;
  const cover = scalar(parsed.data.cover);
  const candidateValue = {
    type: scalar(parsed.data.type) ?? existing?.type ?? "article",
    status: "draft",
    title: scalar(parsed.data.title) ?? existing?.title ?? "未命名草稿",
    slug: scalar(parsed.data.slug) ?? undefined,
    summary: scalar(parsed.data.summary) ?? extractExcerpt(parsed.content, 180),
    bodyMarkdown: parsed.content,
    locale: scalar(parsed.data.locale) ?? existing?.locale ?? "zh-CN",
    translationGroup: scalar(parsed.data.translationGroup) ?? existing?.translationGroup ?? null,
    coverMediaId: cover?.match(/^\/media\/([^/?#]+)/)?.[1] ?? existing?.coverMediaId ?? null,
    tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : existing?.tags ?? [],
    metadata: existing?.metadata ?? {}
  };
  const candidate = existing
    ? validateContentPatch(candidateValue, existing)
    : validateContentCreate(candidateValue);
  const diff = existing ? Object.fromEntries(
    Object.entries(candidate).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(existing[key as keyof typeof existing]))
      .map(([key, value]) => [key, { before: existing[key as keyof typeof existing], after: value }])
  ) : null;

  if (payload.commit !== true) return ok({ candidate, existing, diff, requiresConfirmation: Boolean(existing) });
  if (existing && payload.confirm !== true) {
    throw new AppError(409, "import_confirmation_required", "导入会更新现有内容，请确认差异后重试。", { diff });
  }
  const saved = existing
    ? await updateContent(db, existing.id, candidate, "markdown-import")
    : await createContent(db, candidate, "markdown-import");
  return ok(saved, undefined, { status: existing ? 200 : 201 });
});
