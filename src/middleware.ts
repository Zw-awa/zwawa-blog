import { defineMiddleware } from "astro:middleware";
import { getRuntimeEnv } from "./lib/server/env";
import { STUDIO_COOKIE, verifyStudioSession } from "./lib/server/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const env = getRuntimeEnv(context.locals) as Record<string, unknown>;
  const production = env.ENVIRONMENT === "production";
  const accessEmail = context.request.headers.get("cf-access-authenticated-user-email")?.trim();
  const sessionValid = !production && await verifyStudioSession(context.cookies.get(STUDIO_COOKIE)?.value, context.locals);

  if ((production && accessEmail) || sessionValid) {
    (context.locals as unknown as { admin: { authenticated: boolean; email?: string } }).admin = {
      authenticated: true,
      ...(accessEmail ? { email: accessEmail } : {}),
    };
  }

  if (path.startsWith("/api/admin/") && !SAFE_METHODS.has(context.request.method)) {
    const origin = context.request.headers.get("origin");
    if (origin && origin !== context.url.origin) {
      return new Response(JSON.stringify({ error: { code: "invalid_origin", message: "拒绝跨站管理请求。" } }), {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  }

  if (path.startsWith("/studio") && path !== "/studio/login" && !(context.locals as unknown as { admin?: unknown }).admin) {
    const returnTo = `${path}${context.url.search}`;
    return context.redirect(`/studio/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
  }

  if (path === "/studio/login" && (context.locals as unknown as { admin?: unknown }).admin) {
    return context.redirect("/studio", 302);
  }

  return next();
});
