import { env as cloudflareEnv } from "cloudflare:workers";
import { AppError } from "./errors";
import type { AppRuntimeEnv, D1DatabaseLike, R2BucketLike } from "./types";

type RuntimeLocals = {
  env?: AppRuntimeEnv;
};

export function getRuntimeEnv(locals: unknown): AppRuntimeEnv {
  const candidate = (locals ?? {}) as RuntimeLocals;
  // Astro 6+ removed `locals.runtime.env`; Cloudflare bindings now come from
  // the Workers module. The locals fallback keeps unit tests easy to isolate.
  return candidate.env ?? cloudflareEnv as unknown as AppRuntimeEnv;
}

export function getDb(locals: unknown): D1DatabaseLike {
  const db = getRuntimeEnv(locals).DB;
  if (!db || typeof db.prepare !== "function") {
    throw new AppError(
      503,
      "binding_unavailable",
      "D1 绑定 DB 不可用。请通过 Wrangler 启动本地开发环境并执行迁移。"
    );
  }
  return db;
}

export function getMediaBucket(locals: unknown): R2BucketLike {
  const bucket = getRuntimeEnv(locals).MEDIA;
  if (!bucket || typeof bucket.get !== "function") {
    throw new AppError(
      503,
      "binding_unavailable",
      "R2 绑定 MEDIA 不可用。请通过 Wrangler 启动本地开发环境。"
    );
  }
  return bucket;
}

export function getSiteUrl(locals: unknown, requestUrl?: string): string {
  const configured = getRuntimeEnv(locals).SITE_URL;
  if (typeof configured === "string" && configured.trim()) return configured.replace(/\/$/, "");
  return requestUrl ? new URL(requestUrl).origin : "http://localhost:4321";
}
