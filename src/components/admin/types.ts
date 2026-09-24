export type ContentType = "article" | "game" | "artwork" | "photo";
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

export interface ContentRecord {
  id: string;
  type: ContentType;
  status: ContentStatus;
  title: string;
  slug: string;
  summary: string;
  bodyMarkdown: string;
  locale: string;
  translationGroup: string | null;
  coverMediaId: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  media: ContentMediaItem[];
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentMediaItem {
  mediaId: string;
  role: "cover" | "inline" | "gallery" | "attachment";
  sortOrder: number;
  caption: string;
  fileName: string;
  mimeType: string;
  mediaKind: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string;
  url: string;
}

export interface MediaRecord {
  id: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  mediaKind: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string;
  createdAt: string;
  url?: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiEnvelope<T> {
  data: T;
  error?: { code?: string; message?: string } | string;
}

export interface EditorDraft {
  id?: string;
  type: ContentType;
  status: ContentStatus;
  title: string;
  slug: string;
  summary: string;
  bodyMarkdown: string;
  locale: string;
  tags: string[];
  coverMediaId: string | null;
  metadata: Record<string, string>;
  media: ContentMediaItem[];
  publishedAt: string | null;
}

export const EMPTY_DRAFT: EditorDraft = {
  type: "article",
  status: "draft",
  title: "",
  slug: "",
  summary: "",
  bodyMarkdown: "",
  locale: "zh-CN",
  tags: [],
  coverMediaId: null,
  metadata: {},
  media: [],
  publishedAt: null,
};
