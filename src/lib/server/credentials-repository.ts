import { AppError } from "./errors";
import type { D1DatabaseLike } from "./types";

export interface ApiCredential {
  id: string;
  name: string;
  username: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface CredentialRow {
  id: string;
  name: string;
  username: string;
  secret_hash: string;
  scopes_json: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function mapCredential(row: CredentialRow): ApiCredential {
  let scopes: string[] = [];
  try {
    const value = JSON.parse(row.scopes_json);
    if (Array.isArray(value)) scopes = value.filter((item): item is string => typeof item === "string");
  } catch { /* keep an empty scope list */ }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    scopes,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function listCredentials(db: D1DatabaseLike): Promise<ApiCredential[]> {
  const result = await db.prepare(`
    SELECT id, name, username, secret_hash, scopes_json, last_used_at, revoked_at, created_at
    FROM api_credentials WHERE revoked_at IS NULL ORDER BY created_at DESC
  `).all<CredentialRow>();
  return (result.results ?? []).map(mapCredential);
}

export async function createCredential(
  db: D1DatabaseLike,
  input: { name: string; username: string; scopes?: string[] }
): Promise<{ credential: ApiCredential; secret: string }> {
  const name = input.name?.trim();
  const username = input.username?.trim();
  if (!name || name.length > 100) throw new AppError(422, "validation_error", "应用密码名称无效。" );
  if (!username || username.length > 100) throw new AppError(422, "validation_error", "应用密码用户名无效。" );
  const scopes = [...new Set(input.scopes ?? ["xmlrpc:write"])];
  if (scopes.some((scope) => !/^[a-z0-9:_-]{1,80}$/.test(scope))) {
    throw new AppError(422, "validation_error", "应用密码权限范围无效。" );
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `zw_${base64Url(bytes)}`;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO api_credentials(
      id, name, username, secret_hash, scopes_json, last_used_at, revoked_at, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
  `).bind(id, name, username, await sha256(secret), JSON.stringify(scopes), now).run();
  const row = await db.prepare(`
    SELECT id, name, username, secret_hash, scopes_json, last_used_at, revoked_at, created_at
    FROM api_credentials WHERE id = ?
  `).bind(id).first<CredentialRow>();
  if (!row) throw new AppError(500, "credential_create_failed", "应用密码创建失败。" );
  return { credential: mapCredential(row), secret };
}

export async function revokeCredential(db: D1DatabaseLike, id: string): Promise<void> {
  const result = await db.prepare(`
    UPDATE api_credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
  `).bind(new Date().toISOString(), id).run();
  const changed = Number(result.meta?.changes ?? 0);
  if (changed === 0) throw new AppError(404, "credential_not_found", "找不到可撤销的应用密码。" );
}

export async function verifyCredential(
  db: D1DatabaseLike,
  username: string,
  secret: string,
  requiredScope?: string
): Promise<ApiCredential | null> {
  if (!username || !secret) return null;
  const digest = await sha256(secret);
  const row = await db.prepare(`
    SELECT id, name, username, secret_hash, scopes_json, last_used_at, revoked_at, created_at
    FROM api_credentials WHERE username = ? AND secret_hash = ? AND revoked_at IS NULL LIMIT 1
  `).bind(username, digest).first<CredentialRow>();
  if (!row) return null;
  const credential = mapCredential(row);
  if (requiredScope && !credential.scopes.includes(requiredScope) && !credential.scopes.includes("*")) return null;
  await db.prepare("UPDATE api_credentials SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id)
    .run();
  return credential;
}
