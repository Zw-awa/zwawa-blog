import type { D1DatabaseLike, JsonValue } from "./types";
import { AppError } from "./errors";

export interface SiteSetting {
  key: string;
  value: JsonValue;
  isPublic: boolean;
  updatedAt: string;
}

interface SettingRow {
  key: string;
  value_json: string;
  is_public: number;
  updated_at: string;
}

function decode(row: SettingRow): SiteSetting {
  let value: JsonValue = null;
  try { value = JSON.parse(row.value_json) as JsonValue; } catch { value = null; }
  return { key: row.key, value, isPublic: Boolean(row.is_public), updatedAt: row.updated_at };
}

export async function listSettings(db: D1DatabaseLike, publicOnly = false): Promise<SiteSetting[]> {
  const result = await db.prepare(`
    SELECT key, value_json, is_public, updated_at
    FROM site_settings ${publicOnly ? "WHERE is_public = 1" : ""} ORDER BY key
  `).all<SettingRow>();
  return (result.results ?? []).map(decode);
}

export async function getSetting(db: D1DatabaseLike, key: string): Promise<SiteSetting | null> {
  const row = await db.prepare(`
    SELECT key, value_json, is_public, updated_at FROM site_settings WHERE key = ?
  `).bind(key).first<SettingRow>();
  return row ? decode(row) : null;
}

export async function saveSetting(
  db: D1DatabaseLike,
  key: string,
  value: JsonValue,
  isPublic = false
): Promise<SiteSetting> {
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) throw new AppError(422, "validation_error", "设置键名无效。" );
  const encoded = JSON.stringify(value);
  if (encoded.length > 200_000) throw new AppError(413, "payload_too_large", "设置内容过大。" );
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO site_settings(key, value_json, is_public, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
      is_public = excluded.is_public, updated_at = excluded.updated_at
  `).bind(key, encoded, isPublic ? 1 : 0, now).run();
  return (await getSetting(db, key)) as SiteSetting;
}

export async function saveSettings(
  db: D1DatabaseLike,
  values: Array<{ key: string; value: JsonValue; isPublic?: boolean }>
): Promise<SiteSetting[]> {
  const result: SiteSetting[] = [];
  for (const item of values) result.push(await saveSetting(db, item.key, item.value, item.isPublic));
  return result;
}
