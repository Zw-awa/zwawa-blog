import type { APIRoute } from "astro";
import { getDb } from "../../../lib/server/env";
import { apiHandler, ok } from "../../../lib/server/http";
import { listSettings } from "../../../lib/server/settings-repository";

export const prerender = false;

export const GET: APIRoute = apiHandler(async ({ locals }) => {
  const settings = await listSettings(getDb(locals), true);
  const response = ok(Object.fromEntries(settings.map((item) => [item.key, item.value])));
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300");
  return response;
});
