import type { APIRoute } from "astro";
import { getRuntimeEnv } from "../../../lib/server/env";
import { apiHandler, ok, readJson } from "../../../lib/server/http";
import { AppError } from "../../../lib/server/errors";
import { constantTimeTextEqual, createStudioSession, STUDIO_COOKIE, studioCookieOptions } from "../../../lib/server/session";

export const POST: APIRoute = apiHandler(async (context) => {
  const env = getRuntimeEnv(context.locals) as Record<string, unknown>;
  const production = env.ENVIRONMENT === "production";
  if (production) throw new AppError(404, "not_found", "生产环境使用 Cloudflare Access 登录。");

  const configured = typeof env.ADMIN_DEV_PASSWORD === "string" ? env.ADMIN_DEV_PASSWORD : "";
  if (configured.length < 16) {
    throw new AppError(503, "authentication_unavailable", "请在 .dev.vars 中配置至少 16 位的 ADMIN_DEV_PASSWORD。");
  }
  const body = await readJson<{ password?: unknown; returnTo?: unknown }>(context.request, 10_000);
  const password = typeof body.password === "string" ? body.password : "";
  if (!constantTimeTextEqual(configured, password)) throw new AppError(401, "invalid_credentials", "开发口令不正确。");

  const token = await createStudioSession(context.locals);
  context.cookies.set(STUDIO_COOKIE, token, studioCookieOptions(false));
  const requested = typeof body.returnTo === "string" ? body.returnTo : "/studio";
  const returnTo = requested.startsWith("/studio") && !requested.startsWith("//") ? requested : "/studio";
  return ok({ returnTo });
});
