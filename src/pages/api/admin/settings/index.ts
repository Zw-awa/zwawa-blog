import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { getDb } from "../../../../lib/server/env";
import { AppError } from "../../../../lib/server/errors";
import { apiHandler, ok, readJson } from "../../../../lib/server/http";
import { listSettings, saveSettings } from "../../../../lib/server/settings-repository";
import type { JsonValue } from "../../../../lib/server/types";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const settings = await listSettings(getDb(context.locals));
  return ok(Object.fromEntries(settings.map((item) => [item.key, item.value])));
});

export const PUT: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const body = await readJson<{
    settings?: Array<{ key?: unknown; value?: JsonValue; isPublic?: unknown }>;
    key?: unknown;
    value?: JsonValue;
    isPublic?: unknown;
    [key: string]: unknown;
  }>(context.request, 250_000);
  const source = Array.isArray(body.settings)
    ? body.settings
    : typeof body.key === "string"
      ? [body]
      : Object.entries(body).map(([key, value]) => ({
          key,
          value: value as JsonValue,
          isPublic: key === "site.identity" || key === "site.links" || key === "site.features" || key === "site.assets"
        }));
  const values = source.map((item) => {
    if (typeof item.key !== "string") throw new AppError(422, "validation_error", "每项设置都必须包含 key。" );
    return { key: item.key, value: item.value ?? null, isPublic: item.isPublic === true };
  });
  return ok(await saveSettings(getDb(context.locals), values));
});

export const POST = PUT;
