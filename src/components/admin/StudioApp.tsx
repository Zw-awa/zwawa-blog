import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileText,
  Gamepad2,
  Image,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { jsonBody, studioRequest } from "./api";
import type { ContentRecord, ContentStatus, ContentType, MediaRecord, PageResult } from "./types";

const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

export type StudioView = "dashboard" | "content" | "media" | "stats" | "integrations" | "settings";

interface Props {
  initialView?: StudioView;
  initialContentId?: string;
}

const NAV_ITEMS: Array<{ id: StudioView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "总览", icon: LayoutDashboard },
  { id: "content", label: "内容", icon: BookOpenText },
  { id: "media", label: "媒体", icon: Image },
  { id: "stats", label: "统计", icon: BarChart3 },
  { id: "integrations", label: "连接", icon: Link2 },
  { id: "settings", label: "设置", icon: Settings },
];

const TYPE_LABELS: Record<ContentType, string> = { article: "文章", game: "游戏", artwork: "画作", photo: "摄影" };
const STATUS_LABELS: Record<ContentStatus, string> = { draft: "草稿", published: "已发布", archived: "已归档" };

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function metricDisplay(value: unknown): string {
  if (typeof value === "number") return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value);
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "-";
  const record = value as Record<string, unknown>;
  const preferred = ["pageViews", "totalPulls", "followers", "itemCount", "requests", "publicRepos", "repositories"];
  for (const key of preferred) {
    if (typeof record[key] === "number") return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(record[key]);
  }
  return "已连接";
}

function asItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "items" in value && Array.isArray((value as { items: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

function StatusBadge({ status }: { status: ContentStatus }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

function EmptyState({ icon: Icon = FileText, title, action }: { icon?: typeof FileText; title: string; action?: React.ReactNode }) {
  return <div className="studio-empty"><Icon /><strong>{title}</strong>{action}</div>;
}

function DashboardView({ onEdit, onNavigate }: { onEdit: (id?: string) => void; onNavigate: (view: StudioView) => void }) {
  const [content, setContent] = useState<ContentRecord[]>([]);
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      studioRequest<PageResult<ContentRecord>>("/api/admin/content?limit=6"),
      studioRequest<Record<string, unknown>>("/api/admin/stats").catch(() => ({})),
    ]).then(([contentPage, nextStats]) => {
      setContent(contentPage.items || []);
      setStats(nextStats);
    }).finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const rows = asItems<{ status?: string; count?: number }>(stats.contentCounts);
    const countStatus = (value: string) => rows.filter((row) => row.status === value).reduce((sum, row) => sum + Number(row.count || 0), 0);
    const links = asItems<{ is_healthy?: number; isHealthy?: boolean }>(stats.linkChecks);
    return {
      total: rows.length ? rows.reduce((sum, row) => sum + Number(row.count || 0), 0) : content.length,
      published: rows.length ? countStatus("published") : content.filter((item) => item.status === "published").length,
      draft: rows.length ? countStatus("draft") : content.filter((item) => item.status === "draft").length,
      links: links.filter((item) => item.isHealthy === true || item.is_healthy === 1).length,
    };
  }, [content, stats]);

  if (loading) return <div className="studio-loading"><LoaderCircle className="spin" /> 正在汇总数据</div>;

  return <div className="studio-view">
    <header className="view-heading"><div><span className="view-kicker">Studio</span><h1>内容总览</h1></div><button className="primary-button" onClick={() => onEdit()}><Plus />新建内容</button></header>
    <div className="metric-grid">
      <button onClick={() => onNavigate("content")}><span>全部内容</span><strong>{counts.total}</strong><FileText /></button>
      <button onClick={() => onNavigate("content")}><span>已发布</span><strong>{counts.published}</strong><CheckCircle2 /></button>
      <button onClick={() => onNavigate("content")}><span>待完善草稿</span><strong>{counts.draft}</strong><Pencil /></button>
      <button onClick={() => onNavigate("stats")}><span>健康链接</span><strong>{counts.links || "-"}</strong><Activity /></button>
    </div>
    <section className="studio-section">
      <div className="section-title-row"><div><span>最近更新</span><h2>继续上次的工作</h2></div><button className="text-button" onClick={() => onNavigate("content")}>查看全部<ChevronRight /></button></div>
      {content.length ? <div className="recent-list">{content.map((item) => <button key={item.id} onClick={() => onEdit(item.id)}>
        <span className={`content-type-icon type-${item.type}`}>{item.type === "game" ? <Gamepad2 /> : item.type === "artwork" ? <Palette /> : item.type === "photo" ? <Image /> : <FileText />}</span>
        <span className="recent-copy"><strong>{item.title}</strong><small>{TYPE_LABELS[item.type]} · {formatDate(item.updatedAt)}</small></span>
        <StatusBadge status={item.status} /><ChevronRight />
      </button>)}</div> : <EmptyState title="还没有内容" action={<button className="primary-button" onClick={() => onEdit()}><Plus />创建第一条内容</button>} />}
    </section>
  </div>;
}

function ContentView({ onEdit }: { onEdit: (id?: string) => void }) {
  const [page, setPage] = useState<PageResult<ContentRecord>>({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (pageNumber = 1) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(pageNumber), limit: "20" });
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (query) params.set("search", query);
    try { setPage(await studioRequest<PageResult<ContentRecord>>(`/api/admin/content?${params}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "内容读取失败"); }
    finally { setLoading(false); }
  }, [query, status, type]);

  useEffect(() => { void load(1); }, [load]);

  return <div className="studio-view">
    <header className="view-heading"><div><span className="view-kicker">Library</span><h1>内容管理</h1><p>{page.total} 条内容</p></div><button className="primary-button" onClick={() => onEdit()}><Plus />新建内容</button></header>
    <div className="filter-bar">
      <form className="studio-search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、摘要或正文" /><button type="submit">搜索</button></form>
      <select aria-label="内容类型" value={type} onChange={(event) => setType(event.target.value)}><option value="">全部类型</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="发布状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {error && <div className="studio-alert">{error}</div>}
    <section className="content-table-wrap">
      {loading ? <div className="studio-loading"><LoaderCircle className="spin" /> 正在读取内容</div> : page.items.length ? <table className="content-table"><thead><tr><th>标题</th><th>类型</th><th>状态</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}><td><button className="content-title-button" onClick={() => onEdit(item.id)}><strong>{item.title}</strong><span>/{item.slug}</span></button></td><td>{TYPE_LABELS[item.type]}</td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.updatedAt)}</td><td><button className="icon-button" title="编辑" onClick={() => onEdit(item.id)}><Pencil /></button></td></tr>)}</tbody></table> : <EmptyState title="没有符合条件的内容" />}
    </section>
    {page.totalPages > 1 && <nav className="pagination" aria-label="内容分页"><button disabled={page.page <= 1} onClick={() => void load(page.page - 1)}><ChevronLeft />上一页</button><span>{page.page} / {page.totalPages}</span><button disabled={page.page >= page.totalPages} onClick={() => void load(page.page + 1)}>下一页<ChevronRight /></button></nav>}
  </div>;
}

function MediaView() {
  const [items, setItems] = useState<MediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    studioRequest<PageResult<MediaRecord> | MediaRecord[]>("/api/admin/media?limit=100")
      .then((value) => setItems(asItems<MediaRecord>(value)))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const upload = async (files: FileList) => {
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("file", file); form.set("altText", file.name.replace(/\.[^.]+$/, ""));
        await studioRequest<MediaRecord>("/api/admin/media", { method: "POST", body: form });
      }
      load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "上传失败"); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const remove = async (id: string) => {
    if (!window.confirm("确认删除这项媒体？正在使用的媒体会被拒绝删除。")) return;
    try { await studioRequest(`/api/admin/media/${id}`, { method: "DELETE" }); setItems((current) => current.filter((item) => item.id !== id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
  };

  return <div className="studio-view"><header className="view-heading"><div><span className="view-kicker">Assets</span><h1>媒体库</h1><p>{items.length} 个文件</p></div><input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && void upload(event.target.files)} /><button className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle className="spin" /> : <Upload />}上传图片</button></header>
    {error && <div className="studio-alert">{error}</div>}
    {loading ? <div className="studio-loading"><LoaderCircle className="spin" /> 正在读取媒体</div> : items.length ? <div className="media-grid">{items.map((item) => <article key={item.id}><div className="media-thumb">{item.mimeType.startsWith("image/") ? <img src={item.url || `/media/${encodeURIComponent(item.id)}`} alt={item.altText} loading="lazy" /> : <FileText />}</div><div><strong title={item.fileName}>{item.fileName}</strong><span>{Math.max(1, Math.round(item.byteSize / 1024))} KB</span></div><button className="icon-button danger" onClick={() => void remove(item.id)} title="删除"><Trash2 /></button></article>)}</div> : <EmptyState icon={Image} title="媒体库还是空的" action={<button className="primary-button" onClick={() => inputRef.current?.click()}><Upload />上传第一张图片</button>} />}
  </div>;
}

function StatsView() {
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => { setLoading(true); studioRequest<Record<string, unknown>>("/api/admin/stats").then(setStats).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  useEffect(load, [load]);
  const refresh = async () => { setRefreshing(true); setError(""); try { setStats(await studioRequest<Record<string, unknown>>("/api/admin/stats/refresh", { method: "POST" })); } catch (reason) { setError(reason instanceof Error ? reason.message : "刷新失败"); } finally { setRefreshing(false); } };
  const entries = asItems<Record<string, unknown>>(stats.metrics || []);
  return <div className="studio-view"><header className="view-heading"><div><span className="view-kicker">Signals</span><h1>站点统计</h1><p>外部数据失败时保留最后一次成功结果</p></div><button className="secondary-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <LoaderCircle className="spin" /> : <RefreshCw />}刷新数据</button></header>{error && <div className="studio-alert">{error}</div>}{loading ? <div className="studio-loading"><LoaderCircle className="spin" /> 正在读取统计</div> : entries.length ? <div className="stats-list">{entries.map((entry, index) => <article key={String(entry.id || index)}><div><span>{String(entry.source || "manual")}</span><strong>{String(entry.metricKey || entry.label || "指标")}</strong></div><b>{metricDisplay(entry.value)}</b><small title={String(entry.errorMessage || "")}>{entry.errorMessage ? "不可用" : String(entry.collectionMode || "automatic") === "manual" ? "手工" : "自动"} · {formatDate(String(entry.collectedAt || ""))}</small></article>)}</div> : <EmptyState icon={BarChart3} title="尚未连接统计来源" />}</div>;
}

interface Platform { id?: string; platform: string; label: string; profileUrl: string; handle: string; feedUrl: string; enabled: boolean; }
interface Credential { id: string; name: string; username: string; createdAt: string; lastUsedAt?: string | null; }

function IntegrationsView() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { Promise.all([studioRequest<Platform[] | { items: Platform[] }>("/api/admin/platforms").catch(() => []), studioRequest<Credential[]>("/api/admin/credentials").catch(() => [])]).then(([p, c]) => { setPlatforms(asItems<Platform>(p)); setCredentials(asItems<Credential>(c)); }); }, []);
  const savePlatforms = async () => { setSaving(true); setError(""); try { const value = await studioRequest<Platform[] | { items: Platform[] }>("/api/admin/platforms", { method: "PUT", ...jsonBody({ platforms }) }); setPlatforms(asItems<Platform>(value)); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); } finally { setSaving(false); } };
  const addPlatform = () => setPlatforms((current) => [...current, { platform: "custom", label: "", profileUrl: "", handle: "", feedUrl: "", enabled: true }]);
  const createCredential = async () => { setSaving(true); try { const value = await studioRequest<Credential & { token: string }>("/api/admin/credentials", { method: "POST", ...jsonBody({ name: "Wechatsync", username: "zwawa", scopes: ["xmlrpc:write"] }) }); setCredentials((current) => [value, ...current]); setNewToken(value.token); } catch (reason) { setError(reason instanceof Error ? reason.message : "创建应用密码失败"); } finally { setSaving(false); } };
  const revoke = async (id: string) => { await studioRequest(`/api/admin/credentials/${id}`, { method: "DELETE" }); setCredentials((current) => current.filter((item) => item.id !== id)); };
  return <div className="studio-view"><header className="view-heading"><div><span className="view-kicker">Connections</span><h1>外部连接</h1><p>个人主页、RSS 与 Wechatsync 凭据</p></div><button className="secondary-button" disabled={saving} onClick={() => void savePlatforms()}><CheckCircle2 />保存连接</button></header>{error && <div className="studio-alert">{error}</div>}
    <section className="studio-section">
      <div className="section-title-row"><div><span>Profiles</span><h2>平台与订阅</h2></div><button className="text-button" onClick={addPlatform}><Plus />添加</button></div>
      <div className="platform-editor">{platforms.map((item, index) => <div className="platform-row" key={item.id || index}>
        <select aria-label="平台类型" value={item.platform} onChange={(event) => setPlatforms((current) => current.map((entry, i) => i === index ? { ...entry, platform: event.target.value } : entry))}>
          <option value="github">GitHub</option><option value="dockerhub">Docker Hub</option><option value="rss">RSS / 博客</option><option value="bilibili">B站</option><option value="custom">其他</option>
        </select>
        <input aria-label="平台名称" value={item.label} placeholder="显示名称" onChange={(event) => setPlatforms((current) => current.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} />
        <input aria-label="账号标识" value={item.handle} placeholder="用户名（可选）" onChange={(event) => setPlatforms((current) => current.map((entry, i) => i === index ? { ...entry, handle: event.target.value } : entry))} />
        <input aria-label="主页地址" value={item.profileUrl} placeholder="https://..." onChange={(event) => setPlatforms((current) => current.map((entry, i) => i === index ? { ...entry, profileUrl: event.target.value } : entry))} />
        <input aria-label="RSS 地址" value={item.feedUrl} placeholder="RSS（可选）" onChange={(event) => setPlatforms((current) => current.map((entry, i) => i === index ? { ...entry, feedUrl: event.target.value } : entry))} />
        <label className="platform-enabled"><input type="checkbox" checked={item.enabled} onChange={(event) => setPlatforms((current) => current.map((entry, i) => i === index ? { ...entry, enabled: event.target.checked } : entry))} /><span>启用</span></label>
        <button className="icon-button danger" onClick={() => setPlatforms((current) => current.filter((_, i) => i !== index))} title="移除"><X /></button>
      </div>)}</div>
    </section>
    <section className="studio-section"><div className="section-title-row"><div><span>Application passwords</span><h2>Wechatsync 应用密码</h2></div><button className="text-button" disabled={saving} onClick={() => void createCredential()}><KeyRound />生成密码</button></div>{newToken && <div className="token-reveal"><CircleAlert /><div><strong>这是唯一一次显示完整密码</strong><code>{newToken}</code></div><button className="icon-button" onClick={() => { void navigator.clipboard.writeText(newToken); }} title="复制"><CheckCircle2 /></button></div>}{credentials.length ? <div className="credential-list">{credentials.map((item) => <div key={item.id}><KeyRound /><span><strong>{item.name}</strong><small>{item.username} · 创建于 {formatDate(item.createdAt)}{item.lastUsedAt ? ` · 最近使用 ${formatDate(item.lastUsedAt)}` : ""}</small></span><button className="secondary-button danger" onClick={() => void revoke(item.id)}>撤销</button></div>)}</div> : <EmptyState icon={KeyRound} title="还没有应用密码" />}</section>
  </div>;
}

type SiteAssetKey = "avatar" | "background" | "homeHero" | "studioLogin";
type SiteAssets = Record<SiteAssetKey, string | null>;

const SITE_ASSET_SLOTS: Array<{ key: SiteAssetKey; label: string }> = [
  { key: "avatar", label: "个人头像" },
  { key: "background", label: "全站背景" },
  { key: "homeHero", label: "首页主图" },
  { key: "studioLogin", label: "后台登录图" },
];

function SettingsView() {
  const [identity, setIdentity] = useState({ name: "ZWAWA", tagline: "星夜像素档案馆", description: "技术、游戏与创作的个人档案馆", email: "", locale: "zh-CN" });
  const [assets, setAssets] = useState<SiteAssets>({ avatar: null, background: null, homeHero: null, studioLogin: null });
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    Promise.all([
      studioRequest<Record<string, unknown>>("/api/admin/settings"),
      studioRequest<PageResult<MediaRecord> | MediaRecord[]>("/api/admin/media?kind=image&limit=100"),
    ]).then(([settings, mediaResult]) => {
      const rawIdentity = settings["site.identity"] as Record<string, unknown> | undefined;
      const rawAssets = settings["site.assets"] as Record<string, unknown> | undefined;
      setIdentity((current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(rawIdentity || {}).filter(([, value]) => typeof value === "string")),
      }));
      setAssets((current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(rawAssets || {}).filter(([, value]) => typeof value === "string" || value === null)),
      }));
      setMedia(asItems<MediaRecord>(mediaResult).filter((item) => item.mimeType.startsWith("image/")));
    }).catch((reason) => setNotice(reason instanceof Error ? reason.message : "设置读取失败"));
  }, []);

  const save = async () => {
    setSaving(true);
    setNotice("");
    try {
      await studioRequest("/api/admin/settings", {
        method: "PUT",
        ...jsonBody({ settings: [
          { key: "site.identity", value: identity, isPublic: true },
          { key: "site.assets", value: assets, isPublic: true },
        ] }),
      });
      setNotice("设置已保存");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return <div className="studio-view">
    <header className="view-heading"><div><span className="view-kicker">Configuration</span><h1>站点设置</h1><p>公开身份、默认语言与全站素材</p></div><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <CheckCircle2 />}保存设置</button></header>
    {notice && <div className="studio-notice">{notice}</div>}
    <section className="settings-form">
      <label className="field"><span>站点名称</span><input value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></label>
      <label className="field"><span>站点副标题</span><input value={identity.tagline} onChange={(event) => setIdentity({ ...identity, tagline: event.target.value })} /></label>
      <label className="field field-wide"><span>站点描述</span><textarea rows={3} value={identity.description} onChange={(event) => setIdentity({ ...identity, description: event.target.value })} /></label>
      <label className="field"><span>公开邮箱</span><input type="email" value={identity.email} placeholder="hello@zwawa.dpdns.org" onChange={(event) => setIdentity({ ...identity, email: event.target.value })} /></label>
      <label className="field"><span>默认语言</span><select value={identity.locale} onChange={(event) => setIdentity({ ...identity, locale: event.target.value })}><option value="zh-CN">简体中文</option><option value="en">English（预留）</option></select></label>
    </section>
    <section className="studio-section site-assets-section">
      <div className="section-title-row"><div><span>R2 media</span><h2>全站素材</h2></div></div>
      <div className="site-assets-grid">
        {SITE_ASSET_SLOTS.map((slot) => {
          const selected = media.find((item) => item.id === assets[slot.key]);
          return <label className="site-asset-field" key={slot.key}>
            <span className="site-asset-preview">{selected ? <img src={selected.url || `/media/${encodeURIComponent(selected.id)}`} alt="" /> : <Image />}</span>
            <span className="site-asset-control"><span>{slot.label}</span><select value={assets[slot.key] || ""} onChange={(event) => setAssets((current) => ({ ...current, [slot.key]: event.target.value || null }))}><option value="">不使用图片</option>{media.map((item) => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></span>
          </label>;
        })}
      </div>
    </section>
  </div>;
}

export default function StudioApp({ initialView = "dashboard", initialContentId }: Props) {
  const [view, setView] = useState<StudioView>(initialView);
  const [editingId, setEditingId] = useState<string | undefined>(initialContentId);
  const [editorOpen, setEditorOpen] = useState(Boolean(initialContentId));
  const [navOpen, setNavOpen] = useState(false);

  const navigate = (next: StudioView) => { setView(next); setEditorOpen(false); setEditingId(undefined); setNavOpen(false); window.history.replaceState(null, "", next === "dashboard" ? "/studio" : `/studio?view=${next}`); };
  const edit = (id?: string) => { setEditingId(id); setEditorOpen(true); window.history.replaceState(null, "", id ? `/studio/content/${id}/edit` : "/studio?new=1"); };
  const closeEditor = () => { setEditorOpen(false); setEditingId(undefined); setView("content"); window.history.replaceState(null, "", "/studio?view=content"); };

  if (editorOpen) return <Suspense fallback={<div className="studio-loading"><LoaderCircle className="spin" /> 正在加载编辑器</div>}><MarkdownEditor contentId={editingId} onClose={closeEditor} /></Suspense>;

  return <div className="studio-shell">
    <aside className={navOpen ? "studio-sidebar open" : "studio-sidebar"}>
      <div className="studio-brand"><span>ZW</span><div><strong>ZWAWA</strong><small>创作控制台</small></div><button className="icon-button mobile-only" onClick={() => setNavOpen(false)}><X /></button></div>
      <nav>{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon /><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><a href="/" target="_blank"><ExternalLink />查看网站</a><form method="post" action="/api/auth/logout"><button type="submit"><LogOut />退出</button></form></div>
    </aside>
    <main className="studio-main"><div className="studio-mobile-bar"><button className="icon-button" onClick={() => setNavOpen(true)}><Menu /></button><strong>ZWAWA Studio</strong></div>{view === "dashboard" && <DashboardView onEdit={edit} onNavigate={navigate} />}{view === "content" && <ContentView onEdit={edit} />}{view === "media" && <MediaView />}{view === "stats" && <StatsView />}{view === "integrations" && <IntegrationsView />}{view === "settings" && <SettingsView />}</main>
  </div>;
}
