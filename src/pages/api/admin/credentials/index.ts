import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { createCredential, listCredentials } from "../../../../lib/server/credentials-repository";
import { getDb } from "../../../../lib/server/env";
import { apiHandler, ok, readJson } from "../../../../lib/server/http";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  return ok(await listCredentials(getDb(context.locals)));
});

export const POST: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const payload = await readJson<{ name: string; username: string; scopes?: string[] }>(context.request, 20_000);
  const created = await createCredential(getDb(context.locals), payload);
  return ok({ ...created.credential, token: created.secret }, undefined, {
    status: 201,
    headers: { "cache-control": "no-store" }
  });
});
