export const CONTENT_TYPES = ["article", "game", "artwork", "photo"] as const;
export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface D1ResultLike<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
  error?: string;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface R2ObjectBodyLike {
  body: ReadableStream;
  size: number;
  etag?: string;
  httpEtag?: string;
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string | null,
    options?: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
      onlyIf?: unknown;
    }
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}

export interface AppRuntimeEnv {
  DB?: D1DatabaseLike;
  MEDIA?: R2BucketLike;
  ENVIRONMENT?: string;
  SITE_URL?: string;
  ADMIN_DEV_TOKEN?: string;
  ADMIN_API_KEY?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ZONE_ID?: string;
  [key: string]: unknown;
}

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
  metadata: JsonObject;
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
  mediaKind: "image" | "video" | "audio" | "document" | "other";
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string;
  metadata: JsonObject;
  url: string;
}

export interface ContentWriteInput {
  type: ContentType;
  status: ContentStatus;
  title: string;
  slug: string;
  summary: string;
  bodyMarkdown: string;
  locale: string;
  translationGroup: string | null;
  coverMediaId: string | null;
  metadata: JsonObject;
  tags: string[];
  publishedAt: string | null;
}

export interface MediaRecord {
  id: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  mediaKind: "image" | "video" | "audio" | "document" | "other";
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
