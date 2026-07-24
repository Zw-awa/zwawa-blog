import type { APIContext } from "astro";
import { getRuntimeEnv } from "./env";
import { AppError } from "./errors";

export interface AdminIdentity {
  source: "middleware" | "cloudflare-access" | "development-token";
  email?: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return mismatch === 0;
}

/**
 * One authorization boundary for every admin API. A later session middleware can
 * set `locals.admin = { authenticated: true, email }` without changing routes.
 */
export function requireAdmin(context: Pick<APIContext, "request" | "locals">): AdminIdentity {
  const localState = context.locals as unknown as {
    admin?: { authenticated?: boolean; email?: string } | boolean;
    user?: { authenticated?: boolean; email?: string };
  };
  if (localState.admin === true) return { source: "middleware" };
  if (localState.admin && typeof localState.admin === "object" && localState.admin.authenticated) {
    return { source: "middleware", email: localState.admin.email };
  }
  if (localState.user?.authenticated) return { source: "middleware", email: localState.user.email };

  const env = getRuntimeEnv(context.locals);
  const accessEmail = context.request.headers.get("cf-access-authenticated-user-email")?.trim();
  if (accessEmail && env.ENVIRONMENT === "production") {
    return { source: "cloudflare-access", email: accessEmail };
  }

  const configuredToken = [env.ADMIN_DEV_TOKEN, env.ADMIN_API_KEY].find(
    (value): value is string => typeof value === "string" && value.length >= 16
  );
  const authorization = context.request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const providedToken = context.request.headers.get("x-admin-key") ?? bearer;
  if (configuredToken && providedToken && constantTimeEqual(configuredToken, providedToken)) {
    return { source: "development-token" };
  }

  throw new AppError(
    401,
    "authentication_required",
    configuredToken
      ? "需要有效的管理会话或本地管理密钥。"
      : "管理认证尚未配置。请设置 ADMIN_DEV_TOKEN 或通过 Cloudflare Access 访问。"
  );
}
