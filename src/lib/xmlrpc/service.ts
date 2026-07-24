import { createContent as createStoredContent } from "../server/content-repository";
import { verifyCredential as verifyStoredCredential } from "../server/credentials-repository";
import { extractExcerpt } from "../server/markdown";
import { storeMedia as storeStoredMedia, type StoreMediaInput } from "../server/media-repository";
import type { ContentRecord, ContentWriteInput, D1DatabaseLike, MediaRecord, R2BucketLike } from "../server/types";
import { normalizeSlug } from "../server/validation";
import { htmlToSafeMarkdown } from "./html";
import { XmlRpcFault, type XmlRpcCall, type XmlRpcStruct, type XmlRpcValue } from "./protocol";

const MAX_POST_HTML_LENGTH = 2_000_000;
export const MAX_XMLRPC_UPLOAD_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Map([
  ["image/jpeg", "image/jpeg"],
  ["image/jpg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/gif", "image/gif"],
  ["image/webp", "image/webp"],
  ["image/bmp", "image/bmp"],
]);

export interface XmlRpcRuntime {
  db: D1DatabaseLike;
  bucket: R2BucketLike;
  siteUrl: string;
}

export interface XmlRpcDependencies {
  verifyCredential(
    db: D1DatabaseLike,
    username: string,
    secret: string,
    requiredScope?: string,
  ): Promise<{ id: string } | null>;
  createContent(db: D1DatabaseLike, input: ContentWriteInput, source?: string): Promise<Pick<ContentRecord, "id">>;
  storeMedia(db: D1DatabaseLike, bucket: R2BucketLike, input: StoreMediaInput): Promise<Pick<MediaRecord, "id">>;
  slugExists(db: D1DatabaseLike, slug: string): Promise<boolean>;
}

const defaultDependencies: XmlRpcDependencies = {
  verifyCredential: verifyStoredCredential,
  createContent: createStoredContent,
  storeMedia: storeStoredMedia,
  async slugExists(db, slug) {
    const row = await db.prepare("SELECT id FROM content WHERE type = 'article' AND slug = ? LIMIT 1").bind(slug).first();
    return Boolean(row);
  },
};

function expectString(value: XmlRpcValue | undefined, label: string): string {
  if (typeof value !== "string") throw new XmlRpcFault(-32602, `${label} 必须是字符串。`);
  return value;
}

function expectStruct(value: XmlRpcValue | undefined, label: string): XmlRpcStruct {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) {
    throw new XmlRpcFault(-32602, `${label} 必须是 struct。`);
  }
  return value;
}

async function authenticate(
  runtime: XmlRpcRuntime,
  dependencies: XmlRpcDependencies,
  usernameValue: XmlRpcValue | undefined,
  passwordValue: XmlRpcValue | undefined,
): Promise<{ id: string }> {
  const username = expectString(usernameValue, "username").trim();
  const password = expectString(passwordValue, "password");
  if (!username || !password) throw new XmlRpcFault(403, "用户名或应用密码无效。");
  const credential = await dependencies.verifyCredential(runtime.db, username, password, "xmlrpc:write");
  if (!credential) throw new XmlRpcFault(403, "用户名或应用密码无效，或凭据已被撤销。");
  return credential;
}

function normalizedSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

async function availableSlug(db: D1DatabaseLike, title: string, dependencies: XmlRpcDependencies): Promise<string> {
  const base = normalizeSlug(title) || "article";
  for (let suffix = 1; suffix <= 1_000; suffix += 1) {
    const ending = suffix === 1 ? "" : `-${suffix}`;
    const candidate = `${base.slice(0, 160 - ending.length)}${ending}`;
    if (!await dependencies.slugExists(db, candidate)) return candidate;
  }
  return `article-${crypto.randomUUID().slice(0, 12)}`;
}

function cleanFileName(value: string): string {
  const leaf = value.replace(/\\/g, "/").split("/").pop()?.replace(/\u0000/g, "").trim() ?? "";
  if (!leaf) throw new XmlRpcFault(-32602, "上传文件名不能为空。");
  return leaf.slice(0, 255);
}

async function getUsersBlogs(
  call: XmlRpcCall,
  runtime: XmlRpcRuntime,
  dependencies: XmlRpcDependencies,
): Promise<XmlRpcValue> {
  await authenticate(runtime, dependencies, call.params[0], call.params[1]);
  const siteUrl = normalizedSiteUrl(runtime.siteUrl);
  return [{
    isAdmin: true,
    url: `${siteUrl}/`,
    blogid: "1",
    blogName: "ZWAWA",
    xmlrpc: `${siteUrl}/xmlrpc.php`,
  }];
}

async function newPost(
  call: XmlRpcCall,
  runtime: XmlRpcRuntime,
  dependencies: XmlRpcDependencies,
): Promise<XmlRpcValue> {
  const credential = await authenticate(runtime, dependencies, call.params[1], call.params[2]);
  const post = expectStruct(call.params[3], "post");
  const title = expectString(post.post_title, "post_title").normalize("NFKC").trim();
  if (!title) throw new XmlRpcFault(-32602, "post_title 不能为空。");
  if (title.length > 200) throw new XmlRpcFault(-32602, "post_title 不能超过 200 个字符。");
  const sourceHtml = expectString(post.post_content, "post_content");
  if (sourceHtml.length > MAX_POST_HTML_LENGTH) throw new XmlRpcFault(413, "文章正文不能超过 2 MB。");
  const postType = post.post_type == null ? "post" : expectString(post.post_type, "post_type");
  if (postType !== "post") throw new XmlRpcFault(-32602, "仅支持 post 类型的内容。");

  const markdown = htmlToSafeMarkdown(sourceHtml);
  if (markdown.length > MAX_POST_HTML_LENGTH) throw new XmlRpcFault(413, "转换后的 Markdown 正文不能超过 2 MB。");
  const requestedStatus = typeof post.post_status === "string" ? post.post_status.slice(0, 40) : "draft";
  const input: ContentWriteInput = {
    type: "article",
    status: "draft",
    title,
    slug: await availableSlug(runtime.db, title, dependencies),
    summary: extractExcerpt(markdown, { maxLength: 240, suffix: "..." }),
    bodyMarkdown: markdown,
    locale: "zh-CN",
    translationGroup: null,
    coverMediaId: null,
    metadata: {
      importedVia: "xmlrpc",
      credentialId: credential.id,
      requestedStatus,
      postType,
    },
    tags: [],
    publishedAt: null,
  };
  const created = await dependencies.createContent(runtime.db, input, "xmlrpc");
  return created.id;
}

async function uploadFile(
  call: XmlRpcCall,
  runtime: XmlRpcRuntime,
  dependencies: XmlRpcDependencies,
): Promise<XmlRpcValue> {
  const credential = await authenticate(runtime, dependencies, call.params[1], call.params[2]);
  const file = expectStruct(call.params[3], "file");
  const fileName = cleanFileName(expectString(file.name, "file.name"));
  const requestedMime = expectString(file.type, "file.type").trim().toLowerCase();
  const mimeType = IMAGE_MIME_TYPES.get(requestedMime);
  if (!mimeType) {
    throw new XmlRpcFault(415, "仅支持 JPEG、PNG、GIF、WebP 和 BMP 图片；不接受 SVG 或其他可执行格式。");
  }
  if (!(file.bits instanceof Uint8Array)) throw new XmlRpcFault(-32602, "file.bits 必须是 Base64 数据。");
  if (file.bits.byteLength === 0) throw new XmlRpcFault(-32602, "不能上传空文件。");
  if (file.bits.byteLength > MAX_XMLRPC_UPLOAD_BYTES) throw new XmlRpcFault(413, "单张图片不能超过 25 MB。");

  const media = await dependencies.storeMedia(runtime.db, runtime.bucket, {
    fileName,
    mimeType,
    byteSize: file.bits.byteLength,
    body: file.bits,
    metadata: { importedVia: "xmlrpc", credentialId: credential.id },
  });
  const url = new URL(`/media/${encodeURIComponent(media.id)}`, `${normalizedSiteUrl(runtime.siteUrl)}/`).toString();
  return { id: media.id, file: fileName, url, type: mimeType };
}

export async function dispatchXmlRpcCall(
  call: XmlRpcCall,
  runtime: XmlRpcRuntime,
  dependencies: XmlRpcDependencies = defaultDependencies,
): Promise<XmlRpcValue> {
  switch (call.methodName) {
    case "wp.getUsersBlogs":
      return getUsersBlogs(call, runtime, dependencies);
    case "wp.newPost":
      return newPost(call, runtime, dependencies);
    case "wp.uploadFile":
      return uploadFile(call, runtime, dependencies);
    default:
      throw new XmlRpcFault(-32601, `不支持 XML-RPC 方法 ${call.methodName}。`);
  }
}
