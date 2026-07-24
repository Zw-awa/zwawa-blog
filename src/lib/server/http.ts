import type { APIContext } from "astro";
import { AppError, toAppError } from "./errors";

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function ok(data: unknown, meta?: unknown, init: ResponseInit = {}): Response {
  return json(meta === undefined ? { data } : { data, meta }, init);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export async function readJson<T = unknown>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError(415, "unsupported_media_type", "请求必须使用 application/json。" );
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new AppError(413, "payload_too_large", "请求内容超过允许大小。" );
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new AppError(413, "payload_too_large", "请求内容超过允许大小。" );
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "invalid_json", "请求正文不是有效 JSON。" );
  }
}

export function getPagination(url: URL, defaultLimit = 20, maxLimit = 100): { page: number; limit: number } {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit;
  return { page, limit: Math.max(1, Math.min(maxLimit, requested)) };
}

export type ApiHandler = (context: APIContext) => Response | Promise<Response>;

export function apiHandler(handler: ApiHandler): ApiHandler {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = toAppError(error);
      if (normalized.status >= 500) console.error(error);
      return json(
        {
          error: {
            code: normalized.code,
            message: normalized.message,
            ...(normalized.details === undefined ? {} : { details: normalized.details })
          }
        },
        { status: normalized.status }
      );
    }
  };
}
