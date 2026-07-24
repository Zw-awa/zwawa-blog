import type { ApiEnvelope } from "./types";

export class StudioApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
  }
}
function messageFrom(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as Record<string, unknown>;
  if (typeof value.error === "string") return value.error;
  if (value.error && typeof value.error === "object") {
    const error = value.error as Record<string, unknown>;
    if (typeof error.message === "string") return error.message;
  }
  if (typeof value.message === "string") return value.message;
  return fallback;
}

export async function studioRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/studio/login");
    throw new StudioApiError(messageFrom(payload, `请求失败 (${response.status})`), response.status);
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
}

export function jsonBody(value: unknown): RequestInit {
  return { body: JSON.stringify(value) };
}
