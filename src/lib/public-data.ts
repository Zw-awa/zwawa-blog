import { listPublishedContent, getPublishedContentBySlug } from "./server/content-repository";
import { getRuntimeEnv } from "./server/env";
import { extractExcerpt, renderMarkdown } from "./server/markdown";
import { getSetting } from "./server/settings-repository";
import { listPlatforms } from "./server/stats-repository";
import type { ContentMediaItem, ContentRecord, ContentType, JsonObject } from "./server/types";

export type PublicContentType = ContentType;

export interface PublicContent {
  id: string;
  type: PublicContentType;
  typeLabel: string;
  title: string;
  slug: string;
  summary: string;
  bodyMarkdown: string;
  renderedHtml: string;
  locale: string;
  tags: string[];
  media: PublicMedia[];
  coverUrl: string | null;
  coverAlt: string;
  metadata: JsonObject;
  publishedAt: string;
  updatedAt: string;
}

export interface PublicMedia {
  id: string;
  role: ContentMediaItem["role"];
  url: string;
  caption: string;
  alt: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface PublicContentQuery {
  type?: PublicContentType;
  tag?: string;
  search?: string;
  locale?: string;
  page?: number;
  limit?: number;
}

export interface PublicContentPage {
  items: PublicContent[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PublicSiteIdentity {
  name: string;
  description: string;
  email: string;
  locale: string;
  tagline: string;
}

export interface PublicSiteAssets {
  avatarUrl: string | null;
  backgroundUrl: string | null;
  homeHeroUrl: string | null;
  studioLoginUrl: string | null;
}

export interface PublicPlatformLink {
  id: string;
  platform: string;
  label: string;
  href: string;
  note: string;
  mark: string;
}

const defaultIdentity: PublicSiteIdentity = {
  name: "ZWAWA",
  description: "技术、游戏与创作的个人档案馆",
  email: "hello@example.com",
  locale: "zh-CN",
  tagline: "星夜像素档案馆",
};

const emptyAssets: PublicSiteAssets = {
  avatarUrl: null,
  backgroundUrl: null,
  homeHeroUrl: null,
  studioLoginUrl: null,
};

function assetUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? `/media/${encodeURIComponent(value.trim())}`
    : null;
}

export async function getPublicSiteIdentity(locals: unknown): Promise<PublicSiteIdentity> {
  const db = getRuntimeEnv(locals).DB;
  if (!db) return defaultIdentity;
  try {
    const setting = await getSetting(db, "site.identity");
    const value = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value)
      ? setting.value as Record<string, unknown>
      : {};
    const text = (key: keyof PublicSiteIdentity) => typeof value[key] === "string" && value[key].trim()
      ? value[key].trim()
      : defaultIdentity[key];
    return { name: text("name"), description: text("description"), email: text("email"), locale: text("locale"), tagline: text("tagline") };
  } catch (error) {
    console.warn("[public-data] site identity is unavailable", error);
    return defaultIdentity;
  }
}

export async function getPublicSiteAssets(locals: unknown): Promise<PublicSiteAssets> {
  const db = getRuntimeEnv(locals).DB;
  if (!db) return emptyAssets;
  try {
    const setting = await getSetting(db, "site.assets");
    const value = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value)
      ? setting.value as Record<string, unknown>
      : {};
    return {
      avatarUrl: assetUrl(value.avatar),
      backgroundUrl: assetUrl(value.background),
      homeHeroUrl: assetUrl(value.homeHero),
      studioLoginUrl: assetUrl(value.studioLogin),
    };
  } catch (error) {
    console.warn("[public-data] site assets are unavailable", error);
    return emptyAssets;
  }
}

export async function listPublicPlatformLinks(locals: unknown): Promise<PublicPlatformLink[]> {
  const db = getRuntimeEnv(locals).DB;
  if (!db) return [];
  try {
    return (await listPlatforms(db))
      .filter((item) => item.enabled && item.profileUrl)
      .map((item) => ({
        id: item.id,
        platform: item.platform,
        label: item.label,
        href: item.profileUrl,
        note: typeof item.config.note === "string" ? item.config.note : item.handle ? `@${item.handle}` : "外部主页",
        mark: item.label.replace(/[^A-Za-z0-9\p{Letter}]/gu, "").slice(0, 2).toUpperCase() || "↗",
      }));
  } catch (error) {
    console.warn("[public-data] platform links are unavailable", error);
    return [];
  }
}

const typeLabels: Record<PublicContentType, string> = {
  article: "文章",
  game: "游戏档案",
  artwork: "画作",
  photo: "摄影"
};

const emptyPage = (query: PublicContentQuery): PublicContentPage => ({
  items: [],
  page: Math.max(1, query.page ?? 1),
  limit: Math.max(1, query.limit ?? 20),
  total: 0,
  totalPages: 0
});

function stringMetadata(metadata: JsonObject, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function toPublicContent(record: ContentRecord): PublicContent {
  const publishedAt = record.publishedAt ?? record.updatedAt;
  const media = record.media.map((item) => ({
    id: item.mediaId,
    role: item.role,
    url: item.url,
    caption: item.caption,
    alt: item.altText,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height
  }));
  const coverMedia = media.find((item) => item.id === record.coverMediaId || item.role === "cover");
  return {
    id: record.id,
    type: record.type,
    typeLabel: typeLabels[record.type],
    title: record.title,
    slug: record.slug,
    summary: record.summary || extractExcerpt(record.bodyMarkdown, 180),
    bodyMarkdown: record.bodyMarkdown,
    renderedHtml: renderMarkdown(record.bodyMarkdown, { headingIds: true }),
    locale: record.locale,
    tags: record.tags,
    media,
    coverUrl: coverMedia?.url ?? (record.coverMediaId ? `/media/${encodeURIComponent(record.coverMediaId)}` : null),
    coverAlt: coverMedia?.alt || stringMetadata(record.metadata, "coverAlt"),
    metadata: record.metadata,
    publishedAt,
    updatedAt: record.updatedAt
  };
}

export async function listPublicContent(
  locals: unknown,
  query: PublicContentQuery = {}
): Promise<PublicContentPage> {
  const db = getRuntimeEnv(locals).DB;
  if (!db) return emptyPage(query);

  try {
    const result = await listPublishedContent(db, query);
    return { ...result, items: result.items.map(toPublicContent) };
  } catch (error) {
    console.warn("[public-data] published content is unavailable", error);
    return emptyPage(query);
  }
}

export async function getPublicContent(
  locals: unknown,
  type: PublicContentType,
  slug: string
): Promise<PublicContent | null> {
  const db = getRuntimeEnv(locals).DB;
  if (!db) return null;

  try {
    const record = await getPublishedContentBySlug(db, type, slug);
    return record ? toPublicContent(record) : null;
  } catch (error) {
    console.warn("[public-data] published content detail is unavailable", error);
    return null;
  }
}

export async function listAllPublicContent(
  locals: unknown,
  query: Omit<PublicContentQuery, "page" | "limit"> = {}
): Promise<PublicContent[]> {
  const first = await listPublicContent(locals, { ...query, page: 1, limit: 100 });
  if (first.totalPages <= 1) return first.items;

  const remaining = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      listPublicContent(locals, { ...query, page: index + 2, limit: 100 })
    )
  );
  return [first, ...remaining].flatMap((page) => page.items);
}

export function contentHref(item: Pick<PublicContent, "type" | "slug">): string {
  const slug = encodeURIComponent(item.slug);
  switch (item.type) {
    case "article":
      return `/writing/${slug}`;
    case "game":
      return `/games/${slug}`;
    case "artwork":
      return `/gallery/art/${slug}`;
    case "photo":
      return `/gallery/photo/${slug}`;
  }
}

export function formatPublicDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
