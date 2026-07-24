import { AppError } from "./errors";
import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  type ContentRecord,
  type ContentStatus,
  type ContentType,
  type ContentWriteInput,
  type JsonObject,
  type JsonValue
} from "./types";

function own(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function stringValue(value: unknown, field: string, maxLength: number, required = false): string {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new AppError(422, "validation_error", `${field} 必须是字符串。`);
  const result = value.trim();
  if (required && !result) throw new AppError(422, "validation_error", `${field} 不能为空。`);
  if (result.length > maxLength) {
    throw new AppError(422, "validation_error", `${field} 不能超过 ${maxLength} 个字符。`);
  }
  return result;
}

export function normalizeSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

export function normalizeTagSlug(value: string): string {
  return normalizeSlug(value) || `tag-${crypto.randomUUID().slice(0, 8)}`;
}

function contentType(value: unknown): ContentType {
  if (typeof value !== "string" || !CONTENT_TYPES.includes(value as ContentType)) {
    throw new AppError(422, "validation_error", `type 必须是 ${CONTENT_TYPES.join("、")} 之一。`);
  }
  return value as ContentType;
}

function contentStatus(value: unknown): ContentStatus {
  if (typeof value !== "string" || !CONTENT_STATUSES.includes(value as ContentStatus)) {
    throw new AppError(422, "validation_error", `status 必须是 ${CONTENT_STATUSES.join("、")} 之一。`);
  }
  return value as ContentStatus;
}

function nullableString(value: unknown, field: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  return stringValue(value, field, maxLength);
}

function isoDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AppError(422, "validation_error", `${field} 必须是有效的日期时间。`);
  }
  return new Date(value).toISOString();
}

function jsonObject(value: unknown, field: string): JsonObject {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(422, "validation_error", `${field} 必须是 JSON 对象。`);
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 100_000) throw new Error("too large");
    return JSON.parse(serialized) as JsonObject;
  } catch {
    throw new AppError(422, "validation_error", `${field} 包含无效或过大的 JSON 数据。`);
  }
}

function tagList(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AppError(422, "validation_error", "tags 必须是字符串数组。" );
  const normalized = value.map((tag) => stringValue(tag, "tag", 60, true));
  return [...new Map(normalized.map((tag) => [tag.toLocaleLowerCase("zh-CN"), tag])).values()].slice(0, 30);
}

export function validateContentCreate(value: unknown): ContentWriteInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(422, "validation_error", "内容必须是 JSON 对象。" );
  }
  const input = value as Record<string, unknown>;
  const title = stringValue(input.title, "title", 200, true);
  const slug = normalizeSlug(stringValue(input.slug ?? title, "slug", 200, true));
  if (!slug) throw new AppError(422, "validation_error", "slug 必须至少包含一个字母或数字。" );
  const status = contentStatus(input.status ?? "draft");
  const bodyMarkdown = typeof input.bodyMarkdown === "string" ? input.bodyMarkdown : "";
  if (bodyMarkdown.length > 2_000_000) throw new AppError(413, "payload_too_large", "Markdown 正文超过 2 MB。" );
  return {
    type: contentType(input.type ?? "article"),
    status,
    title,
    slug,
    summary: stringValue(input.summary, "summary", 500),
    bodyMarkdown,
    locale: stringValue(input.locale ?? "zh-CN", "locale", 20, true),
    translationGroup: nullableString(input.translationGroup, "translationGroup", 100),
    coverMediaId: nullableString(input.coverMediaId, "coverMediaId", 100),
    metadata: jsonObject(input.metadata, "metadata"),
    tags: tagList(input.tags),
    publishedAt: status === "published" ? isoDate(input.publishedAt, "publishedAt") ?? new Date().toISOString() : null
  };
}

export function validateContentPatch(value: unknown, current: ContentRecord): ContentWriteInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(422, "validation_error", "内容必须是 JSON 对象。" );
  }
  const input = value as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    type: own(input, "type") ? input.type : current.type,
    status: own(input, "status") ? input.status : current.status,
    title: own(input, "title") ? input.title : current.title,
    slug: own(input, "slug") ? input.slug : current.slug,
    summary: own(input, "summary") ? input.summary : current.summary,
    bodyMarkdown: own(input, "bodyMarkdown") ? input.bodyMarkdown : current.bodyMarkdown,
    locale: own(input, "locale") ? input.locale : current.locale,
    translationGroup: own(input, "translationGroup") ? input.translationGroup : current.translationGroup,
    coverMediaId: own(input, "coverMediaId") ? input.coverMediaId : current.coverMediaId,
    metadata: own(input, "metadata") ? input.metadata : current.metadata,
    tags: own(input, "tags") ? input.tags : current.tags,
    publishedAt: own(input, "publishedAt") ? input.publishedAt : current.publishedAt
  };
  return validateContentCreate(merged);
}

export function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed: JsonValue = JSON.parse(value) as JsonValue;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}
