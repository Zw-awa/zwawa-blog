import { getRuntimeEnv } from "./env";

export const STUDIO_COOKIE = "zwawa_studio";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return mismatch === 0;
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  return constantTimeEqual(encoder.encode(left), encoder.encode(right));
}

function sessionSecret(locals: unknown): string | null {
  const env = getRuntimeEnv(locals) as Record<string, unknown>;
  const value = env.SESSION_SECRET;
  return typeof value === "string" && value.length >= 32 ? value : null;
}

async function signature(payload: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function createStudioSession(locals: unknown): Promise<string> {
  const secret = sessionSecret(locals);
  if (!secret) throw new Error("SESSION_SECRET 必须至少包含 32 个字符。");
  const payload = encode(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })));
  return `${payload}.${encode(await signature(payload, secret))}`;
}

export async function verifyStudioSession(token: string | null | undefined, locals: unknown): Promise<boolean> {
  if (!token) return false;
  const secret = sessionSecret(locals);
  if (!secret) return false;
  const [payload, provided, extra] = token.split(".");
  if (!payload || !provided || extra) return false;
  const providedBytes = decode(provided);
  const payloadBytes = decode(payload);
  if (!providedBytes || !payloadBytes || !constantTimeEqual(providedBytes, await signature(payload, secret))) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: number };
    return typeof parsed.exp === "number" && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function studioCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
