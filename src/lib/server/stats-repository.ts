import { AppError } from "./errors";
import type { AppRuntimeEnv, D1DatabaseLike, JsonObject, JsonValue } from "./types";
import { parseJsonObject } from "./validation";

export interface ExternalPlatform {
  id: string;
  platform: string;
  label: string;
  profileUrl: string;
  handle: string;
  feedUrl: string;
  config: JsonObject;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MetricSnapshot {
  id: string;
  source: string;
  metricKey: string;
  value: JsonValue;
  collectionMode: "automatic" | "manual" | "unavailable";
  collectedAt: string;
  staleAfter: string | null;
  errorMessage: string | null;
}

interface PlatformRow {
  id: string;
  platform: string;
  label: string;
  profile_url: string;
  handle: string;
  feed_url: string;
  config_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function platformFromRow(row: PlatformRow): ExternalPlatform {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    profileUrl: row.profile_url,
    handle: row.handle,
    feedUrl: row.feed_url,
    config: parseJsonObject(row.config_json),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listPlatforms(db: D1DatabaseLike): Promise<ExternalPlatform[]> {
  const result = await db.prepare(`
    SELECT id, platform, label, profile_url, handle, feed_url, config_json,
      enabled, created_at, updated_at
    FROM external_platforms ORDER BY label COLLATE NOCASE
  `).all<PlatformRow>();
  return (result.results ?? []).map(platformFromRow);
}

export async function savePlatform(db: D1DatabaseLike, value: Partial<ExternalPlatform>): Promise<ExternalPlatform> {
  const platform = typeof value.platform === "string" ? value.platform.trim().toLowerCase() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const handle = typeof value.handle === "string" ? value.handle.trim() : "";
  if (!/^[\p{Letter}\p{Number}_-]{1,50}$/u.test(platform)) {
    throw new AppError(422, "validation_error", "平台标识无效。" );
  }
  if (!label || label.length > 100) throw new AppError(422, "validation_error", "平台名称无效。" );
  const profileUrl = validateOptionalUrl(value.profileUrl, "profileUrl");
  const feedUrl = validateOptionalUrl(value.feedUrl, "feedUrl");
  const config = value.config && typeof value.config === "object" && !Array.isArray(value.config) ? value.config : {};
  const id = typeof value.id === "string" && value.id ? value.id : crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO external_platforms(
      id, platform, label, profile_url, handle, feed_url, config_json,
      enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, label = excluded.label,
      profile_url = excluded.profile_url, handle = excluded.handle, feed_url = excluded.feed_url,
      config_json = excluded.config_json, enabled = excluded.enabled, updated_at = excluded.updated_at
  `).bind(
    id, platform, label, profileUrl, handle, feedUrl, JSON.stringify(config),
    value.enabled === false ? 0 : 1, now, now
  ).run();
  const row = await db.prepare(`
    SELECT id, platform, label, profile_url, handle, feed_url, config_json,
      enabled, created_at, updated_at FROM external_platforms WHERE id = ?
  `).bind(id).first<PlatformRow>();
  if (!row) throw new AppError(500, "platform_save_failed", "外部平台保存失败。" );
  return platformFromRow(row);
}

export async function replacePlatforms(
  db: D1DatabaseLike,
  values: Partial<ExternalPlatform>[]
): Promise<ExternalPlatform[]> {
  const saved: ExternalPlatform[] = [];
  for (const value of values) saved.push(await savePlatform(db, value));
  if (saved.length === 0) {
    await db.prepare("DELETE FROM external_platforms").run();
  } else {
    const placeholders = saved.map(() => "?").join(", ");
    await db.prepare(`DELETE FROM external_platforms WHERE id NOT IN (${placeholders})`)
      .bind(...saved.map((platform) => platform.id))
      .run();
  }
  return saved;
}

function validateOptionalUrl(value: unknown, field: string): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 2_000) {
    throw new AppError(422, "validation_error", `${field} 无效。`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
    if (isPrivateHostname(url.hostname)) throw new Error("private address");
    return url.toString();
  } catch {
    throw new AppError(422, "validation_error", `${field} 必须是公开的 HTTP(S) 地址。`);
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^169\.254\./.test(host) || /^fc/i.test(host) || /^fd/i.test(host) || /^fe8/i.test(host)) return true;
  return false;
}

export async function saveMetric(
  db: D1DatabaseLike,
  source: string,
  metricKey: string,
  value: JsonValue,
  options: {
    mode?: MetricSnapshot["collectionMode"];
    staleAfter?: string | null;
    errorMessage?: string | null;
  } = {}
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO metric_snapshots(
      id, source, metric_key, value_json, collection_mode, collected_at, stale_after, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, metric_key) DO UPDATE SET value_json = excluded.value_json,
      collection_mode = excluded.collection_mode, collected_at = excluded.collected_at,
      stale_after = excluded.stale_after, error_message = excluded.error_message
  `).bind(
    crypto.randomUUID(), source, metricKey, JSON.stringify(value), options.mode ?? "automatic",
    now, options.staleAfter ?? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    options.errorMessage ?? null
  ).run();
}

async function markMetricError(db: D1DatabaseLike, source: string, metricKey: string, message: string): Promise<void> {
  const existing = await db.prepare(`
    SELECT value_json FROM metric_snapshots WHERE source = ? AND metric_key = ?
  `).bind(source, metricKey).first<{ value_json: string }>();
  let value: JsonValue = null;
  if (existing?.value_json) {
    try { value = JSON.parse(existing.value_json) as JsonValue; } catch { value = null; }
  }
  await saveMetric(db, source, metricKey, value, { errorMessage: message.slice(0, 500) });
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "ZWAWA-Studio/1.0" },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function refreshPlatform(db: D1DatabaseLike, platform: ExternalPlatform): Promise<void> {
  const source = platform.platform;
  try {
    if (source === "github" && platform.handle) {
      const data = await fetchJson(`https://api.github.com/users/${encodeURIComponent(platform.handle)}`);
      await saveMetric(db, source, "profile", {
        followers: Number(data.followers ?? 0),
        publicRepos: Number(data.public_repos ?? 0),
        publicGists: Number(data.public_gists ?? 0),
        updatedAt: typeof data.updated_at === "string" ? data.updated_at : null
      });
      return;
    }
    if ((source === "docker" || source === "dockerhub") && platform.handle) {
      const [data, repositories] = await Promise.all([
        fetchJson(`https://hub.docker.com/v2/users/${encodeURIComponent(platform.handle)}/`),
        fetchJson(`https://hub.docker.com/v2/repositories/${encodeURIComponent(platform.handle)}/?page_size=100`)
      ]);
      const images = Array.isArray(repositories.results) ? repositories.results as Array<Record<string, unknown>> : [];
      await saveMetric(db, "dockerhub", "profile", {
        username: typeof data.username === "string" ? data.username : platform.handle,
        fullName: typeof data.full_name === "string" ? data.full_name : "",
        joinedAt: typeof data.date_joined === "string" ? data.date_joined : null,
        repositories: Number(repositories.count ?? images.length),
        totalPulls: images.reduce((sum, item) => sum + Number(item.pull_count ?? 0), 0),
        totalStars: images.reduce((sum, item) => sum + Number(item.star_count ?? 0), 0)
      });
      return;
    }
    if (platform.feedUrl) {
      const response = await fetch(platform.feedUrl, {
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const entries = [...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0, 10);
      await saveMetric(db, source, "feed", {
        itemCount: entries.length,
        fetchedBytes: xml.length,
        feedUrl: platform.feedUrl
      });
      return;
    }
    await saveMetric(db, source, "profile", null, { mode: "unavailable", errorMessage: "没有可用的自动统计配置。" });
  } catch (error) {
    await markMetricError(db, source, platform.feedUrl ? "feed" : "profile", error instanceof Error ? error.message : String(error));
  }
}

async function checkLink(db: D1DatabaseLike, label: string, value: string): Promise<void> {
  const url = validateOptionalUrl(value, "url");
  if (!url) return;
  const started = Date.now();
  let statusCode: number | null = null;
  let healthy = false;
  let errorMessage: string | null = null;
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (response.status === 405) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8_000) });
      await response.body?.cancel();
    }
    statusCode = response.status;
    healthy = response.ok || (response.status >= 300 && response.status < 400);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO link_checks(
      id, url, label, status_code, is_healthy, response_ms, checked_at,
      error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET label = excluded.label, status_code = excluded.status_code,
      is_healthy = excluded.is_healthy, response_ms = excluded.response_ms,
      checked_at = excluded.checked_at, error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `).bind(
    crypto.randomUUID(), url, label, statusCode, healthy ? 1 : 0, Date.now() - started,
    now, errorMessage, now, now
  ).run();
}

async function refreshCloudflareAnalytics(db: D1DatabaseLike, env: AppRuntimeEnv): Promise<void> {
  const token = typeof env.CLOUDFLARE_API_TOKEN === "string" ? env.CLOUDFLARE_API_TOKEN.trim() : "";
  const zoneId = typeof env.CLOUDFLARE_ZONE_ID === "string" ? env.CLOUDFLARE_ZONE_ID.trim() : "";
  if (!token || !zoneId) {
    await saveMetric(db, "cloudflare", "site-traffic", null, {
      mode: "unavailable",
      staleAfter: null,
      errorMessage: "尚未配置 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ZONE_ID。"
    });
    return;
  }
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: `query SiteTraffic($zone: string!, $since: Date!) { viewer { zones(filter: { zoneTag: $zone }) { httpRequests1dGroups(limit: 8, filter: { date_geq: $since }, orderBy: [date_ASC]) { dimensions { date } sum { requests bytes pageViews } uniq { uniques } } } } }`,
        variables: { zone: zoneId, since }
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || Array.isArray(payload.errors)) throw new Error(`Cloudflare GraphQL HTTP ${response.status}`);
    const viewer = (payload.data as Record<string, unknown> | undefined)?.viewer as Record<string, unknown> | undefined;
    const zones = Array.isArray(viewer?.zones) ? viewer.zones as Array<Record<string, unknown>> : [];
    const groups = Array.isArray(zones[0]?.httpRequests1dGroups)
      ? zones[0].httpRequests1dGroups as Array<Record<string, unknown>>
      : [];
    const days = groups.map((group) => {
      const dimensions = group.dimensions as Record<string, unknown> | undefined;
      const sum = group.sum as Record<string, unknown> | undefined;
      const uniq = group.uniq as Record<string, unknown> | undefined;
      return {
        date: String(dimensions?.date ?? ""),
        requests: Number(sum?.requests ?? 0),
        pageViews: Number(sum?.pageViews ?? 0),
        bytes: Number(sum?.bytes ?? 0),
        uniques: Number(uniq?.uniques ?? 0)
      };
    });
    await saveMetric(db, "cloudflare", "site-traffic", {
      days,
      requests: days.reduce((sum, day) => sum + day.requests, 0),
      pageViews: days.reduce((sum, day) => sum + day.pageViews, 0),
      bytes: days.reduce((sum, day) => sum + day.bytes, 0),
      uniques: days.reduce((sum, day) => sum + day.uniques, 0)
    });
  } catch (error) {
    await markMetricError(db, "cloudflare", "site-traffic", error instanceof Error ? error.message : String(error));
  }
}

export async function refreshStatistics(db: D1DatabaseLike, env: AppRuntimeEnv = {}): Promise<void> {
  await refreshCloudflareAnalytics(db, env);
  const platforms = (await listPlatforms(db)).filter((platform) => platform.enabled).slice(0, 20);
  for (const platform of platforms) await refreshPlatform(db, platform);
  for (const platform of platforms.slice(0, 15)) {
    if (platform.profileUrl) await checkLink(db, platform.label, platform.profileUrl);
  }
}

export async function getStatsDashboard(db: D1DatabaseLike) {
  const [counts, media, snapshots, links] = await Promise.all([
    db.prepare(`
      SELECT type, status, COUNT(*) AS count FROM content GROUP BY type, status ORDER BY type, status
    `).all<{ type: string; status: string; count: number }>(),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM media")
      .first<{ count: number; bytes: number }>(),
    db.prepare(`
      SELECT id, source, metric_key, value_json, collection_mode, collected_at, stale_after, error_message
      FROM metric_snapshots ORDER BY source, metric_key
    `).all<{
      id: string; source: string; metric_key: string; value_json: string;
      collection_mode: MetricSnapshot["collectionMode"]; collected_at: string;
      stale_after: string | null; error_message: string | null;
    }>(),
    db.prepare(`
      SELECT id, url, label, status_code, is_healthy, response_ms, checked_at, error_message
      FROM link_checks ORDER BY checked_at DESC LIMIT 100
    `).all<Record<string, unknown>>()
  ]);
  const metrics: MetricSnapshot[] = (snapshots.results ?? []).map((row) => {
    let value: JsonValue = null;
    try { value = JSON.parse(row.value_json) as JsonValue; } catch { value = null; }
    return {
      id: row.id,
      source: row.source,
      metricKey: row.metric_key,
      value,
      collectionMode: row.collection_mode,
      collectedAt: row.collected_at,
      staleAfter: row.stale_after,
      errorMessage: row.error_message
    };
  });
  return {
    contentCounts: counts.results ?? [],
    media: { count: Number(media?.count ?? 0), bytes: Number(media?.bytes ?? 0) },
    metrics,
    linkChecks: links.results ?? [],
    platforms: await listPlatforms(db)
  };
}
