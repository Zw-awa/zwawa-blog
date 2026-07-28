import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  Archive,
  Bold,
  Check,
  Code2,
  Download,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link,
  List,
  LoaderCircle,
  PanelLeftClose,
  Quote,
  Save,
  Send,
  Upload,
} from "lucide-react";
import { renderMarkdown } from "../../lib/server/markdown";
import { jsonBody, studioRequest } from "./api";
import { EMPTY_DRAFT, type ContentMediaItem, type ContentRecord, type EditorDraft, type MediaRecord } from "./types";

interface Props {
  contentId?: string;
  onClose: () => void;
  onSaved?: (record: ContentRecord) => void;
}

interface EditorViewLike {
  state: { selection: { main: { from: number; to: number } }; doc: { sliceString(from: number, to: number): string } };
  dispatch(transaction: unknown): void;
  focus(): void;
}

const TYPE_LABELS = {
  article: "文章",
  game: "游戏专题",
  artwork: "画作",
  photo: "摄影",
} as const;

function fromRecord(record: ContentRecord): EditorDraft {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    title: record.title,
    slug: record.slug,
    summary: record.summary,
    bodyMarkdown: record.bodyMarkdown,
    locale: record.locale,
    tags: record.tags,
    coverMediaId: record.coverMediaId,
    metadata: Object.fromEntries(Object.entries(record.metadata || {}).map(([key, value]) => [key, String(value ?? "")])),
    media: record.media || [],
    publishedAt: record.publishedAt,
  };
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function metadataFields(type: EditorDraft["type"]): Array<{ key: string; label: string; placeholder: string }> {
  if (type === "game") {
    return [
      { key: "game", label: "游戏", placeholder: "Terraria / Minecraft / Starbound" },
      { key: "entryType", label: "记录类型", placeholder: "攻略、联机日志、模组笔记" },
    ];
  }
  if (type === "artwork") {
    return [
      { key: "medium", label: "媒介", placeholder: "数位绘画、铅笔、水彩" },
      { key: "series", label: "系列", placeholder: "作品系列" },
      { key: "year", label: "年份", placeholder: "2026" },
    ];
  }
  if (type === "photo") {
    return [
      { key: "location", label: "地点", placeholder: "拍摄地点（可选）" },
      { key: "camera", label: "设备", placeholder: "相机或镜头（可选）" },
      { key: "takenAt", label: "拍摄日期", placeholder: "2026-07-23" },
    ];
  }
  return [];
}

export default function MarkdownEditor({ contentId, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<EditorDraft>({ ...EMPTY_DRAFT, metadata: {}, media: [] });
  const [loading, setLoading] = useState(Boolean(contentId));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(true);
  const editorRef = useRef<EditorViewLike | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!contentId) return;
    setLoading(true);
    studioRequest<ContentRecord>(`/api/admin/content/${contentId}`)
      .then((record) => setDraft(fromRecord(record)))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [contentId]);

  const update = useCallback(<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }, []);

  const payload = useCallback(
    (status = draft.status) => ({
      type: draft.type,
      status,
      title: draft.title.trim(),
      slug: draft.slug.trim() || slugify(draft.title),
      summary: draft.summary.trim(),
      bodyMarkdown: draft.bodyMarkdown,
      locale: draft.locale,
      translationGroup: null,
      coverMediaId: draft.coverMediaId,
      metadata: Object.fromEntries(Object.entries(draft.metadata).filter(([, value]) => value !== "")),
      tags: draft.tags,
      publishedAt: status === "published" ? draft.publishedAt : null,
    }),
    [draft],
  );

  const save = useCallback(
    async (quiet = false): Promise<ContentRecord | null> => {
      if (savingRef.current || !draft.title.trim()) return null;
      savingRef.current = true;
      setSaving(true);
      if (!quiet) setError("");
      try {
        const record = draft.id
          ? await studioRequest<ContentRecord>(`/api/admin/content/${draft.id}`, {
              method: "PATCH",
              ...jsonBody(payload()),
            })
          : await studioRequest<ContentRecord>("/api/admin/content", {
              method: "POST",
              ...jsonBody(payload("draft")),
            });
        setDraft(fromRecord(record));
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
        onSaved?.(record);
        return record;
      } catch (reason) {
        if (!quiet) setError(reason instanceof Error ? reason.message : "保存失败");
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [draft, onSaved, payload],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirty && draft.id && !savingRef.current) void save(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [dirty, draft.id, save]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const changeStatus = async (action: "publish" | "unpublish" | "archive") => {
    const saved = await save();
    const id = saved?.id || draft.id;
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      const path = action === "archive" ? `/api/admin/content/${id}` : `/api/admin/content/${id}/${action}`;
      const record = await studioRequest<ContentRecord>(
        path,
        action === "archive"
          ? { method: "PATCH", ...jsonBody({ status: "archived" }) }
          : { method: "POST" },
      );
      setDraft(fromRecord(record));
      onSaved?.(record);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "状态更新失败");
    } finally {
      setSaving(false);
    }
  };

  const wrapSelection = (before: string, after = before, placeholder = "文字") => {
    const view = editorRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.doc.sliceString(from, to) || placeholder;
    const insert = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
    view.focus();
  };

  const insertLine = (prefix: string, placeholder: string) => wrapSelection(prefix, "", placeholder);

  const uploadImage = async (file: File) => {
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("altText", file.name.replace(/\.[^.]+$/, ""));
      const media = await studioRequest<MediaRecord>("/api/admin/media", { method: "POST", body: form });
      const url = media.url || `/media/${encodeURIComponent(media.id)}`;
      wrapSelection(`![${media.altText || "图片"}](`, ")", url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片上传失败");
    } finally {
      setSaving(false);
    }
  };

  const persistMedia = async (contentId: string, media: ContentMediaItem[], coverMediaId: string | null) => {
    const relations = media.map((item, index) => ({
      mediaId: item.mediaId,
      role: item.mediaId === coverMediaId ? "cover" : item.role === "cover" ? "gallery" : item.role,
      sortOrder: index,
      caption: item.caption,
    }));
    await studioRequest(`/api/admin/content/${contentId}/media`, { method: "PUT", ...jsonBody({ media: relations }) });
    const record = await studioRequest<ContentRecord>(`/api/admin/content/${contentId}`, {
      method: "PATCH",
      ...jsonBody({ coverMediaId }),
    });
    setDraft(fromRecord(record));
    setDirty(false);
    onSaved?.(record);
  };

  const uploadGallery = async (files: FileList) => {
    setSaving(true);
    setError("");
    try {
      const existing = draft.id ? null : await save();
      const contentId = draft.id || existing?.id;
      if (!contentId) throw new Error("请先填写标题，再上传作品图片。");
      const additions: ContentMediaItem[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        form.set("altText", file.name.replace(/\.[^.]+$/, ""));
        const media = await studioRequest<MediaRecord>("/api/admin/media", { method: "POST", body: form });
        additions.push({
          mediaId: media.id,
          role: "gallery",
          sortOrder: draft.media.length + additions.length,
          caption: "",
          fileName: media.fileName,
          mimeType: media.mimeType,
          mediaKind: media.mediaKind,
          byteSize: media.byteSize,
          width: media.width,
          height: media.height,
          altText: media.altText,
          url: media.url || `/media/${encodeURIComponent(media.id)}`,
        });
      }
      const next = [...draft.media, ...additions];
      const cover = draft.coverMediaId || next[0]?.mediaId || null;
      await persistMedia(contentId, next, cover);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作品图片上传失败");
    } finally {
      setSaving(false);
      if (galleryRef.current) galleryRef.current.value = "";
    }
  };

  const updateGallery = async (media: ContentMediaItem[], coverMediaId = draft.coverMediaId) => {
    if (!draft.id) return;
    setSaving(true);
    setError("");
    try { await persistMedia(draft.id, media, coverMediaId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "图集更新失败"); }
    finally { setSaving(false); }
  };

  const importMarkdown = async (file: File) => {
    setSaving(true);
    setError("");
    try {
      const markdownText = await file.text();
      const result = await studioRequest<ContentRecord | { content: ContentRecord }>("/api/admin/import", {
        method: "POST",
        ...jsonBody({ markdown: markdownText, commit: true, confirm: true }),
      });
      const record = "content" in result ? result.content : result;
      setDraft(fromRecord(record));
      setDirty(false);
      onSaved?.(record);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Markdown 导入失败");
    } finally {
      setSaving(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const previewHtml = useMemo(() => renderMarkdown(draft.bodyMarkdown, { headingIds: true }), [draft.bodyMarkdown]);

  if (loading) {
    return <div className="studio-loading"><LoaderCircle className="spin" /> 正在读取内容</div>;
  }

  return (
    <section className="editor-screen">
      <header className="editor-topbar">
        <button className="icon-button" type="button" onClick={onClose} title="返回内容列表"><PanelLeftClose /></button>
        <div className="editor-title-state">
          <strong>{draft.id ? draft.title || "未命名内容" : "新建内容"}</strong>
          <span>{saving ? "正在保存" : dirty ? "有未保存修改" : savedAt ? `${savedAt} 已保存` : "尚未修改"}</span>
        </div>
        <div className="editor-actions">
          <input ref={importRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={(event) => event.target.files?.[0] && void importMarkdown(event.target.files[0])} />
          <button className="secondary-button" type="button" onClick={() => importRef.current?.click()}><Upload />导入</button>
          {draft.id && <a className="secondary-button" href={`/api/admin/content/${draft.id}/export`}><Download />导出</a>}
          <button className="secondary-button" type="button" disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Save />}保存</button>
          {draft.status === "published" ? (
            <button className="primary-button" type="button" onClick={() => void changeStatus("unpublish")}><Check />已发布 · 撤回</button>
          ) : (
            <button className="primary-button" type="button" disabled={!draft.title.trim()} onClick={() => void changeStatus("publish")}><Send />发布</button>
          )}
          {draft.id && <button className="icon-button danger" type="button" onClick={() => void changeStatus("archive")} title="归档"><Archive /></button>}
        </div>
      </header>

      {error && <div className="studio-alert" role="alert">{error}</div>}

      <div className="editor-meta-grid">
        <label className="field field-wide"><span>标题</span><input value={draft.title} maxLength={200} onChange={(event) => {
          const title = event.target.value;
          setDraft((current) => ({ ...current, title, slug: current.slug || slugify(title) }));
          setDirty(true);
        }} placeholder="内容标题" /></label>
        <label className="field"><span>类型</span><select value={draft.type} onChange={(event) => update("type", event.target.value as EditorDraft["type"])}>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="field"><span>地址标识</span><input value={draft.slug} maxLength={160} onChange={(event) => update("slug", slugify(event.target.value))} placeholder="article-slug" /></label>
        <label className="field field-wide"><span>摘要</span><textarea rows={2} maxLength={500} value={draft.summary} onChange={(event) => update("summary", event.target.value)} placeholder="用于列表与搜索结果的简短说明" /></label>
        <label className="field"><span>标签</span><input value={draft.tags.join(", ")} onChange={(event) => update("tags", event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))} placeholder="Astro, Cloudflare" /></label>
        <label className="field"><span>语言</span><select value={draft.locale} onChange={(event) => update("locale", event.target.value)}><option value="zh-CN">简体中文</option><option value="en">English（预留）</option></select></label>
        {metadataFields(draft.type).map((item) => <label className="field" key={item.key}><span>{item.label}</span><input value={draft.metadata[item.key] || ""} onChange={(event) => {
          setDraft((current) => ({ ...current, metadata: { ...current.metadata, [item.key]: event.target.value } }));
          setDirty(true);
        }} placeholder={item.placeholder} /></label>)}
      </div>

      <section className="editor-media-strip">
        <div className="editor-media-heading">
          <div><strong>封面与图集</strong><span>{draft.media.length ? `${draft.media.length} 张图片` : "为内容添加封面或作品图片"}</span></div>
          <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && void uploadGallery(event.target.files)} />
          <button className="secondary-button" type="button" onClick={() => galleryRef.current?.click()}><ImagePlus />添加图片</button>
        </div>
        {draft.media.length > 0 && <div className="editor-media-list">{draft.media.map((item, index) => <article key={`${item.mediaId}-${item.role}`}>
          <img src={item.url || `/media/${encodeURIComponent(item.mediaId)}`} alt={item.altText || item.fileName} />
          <div><strong>{item.fileName}</strong><span>{item.mediaId === draft.coverMediaId ? "当前封面" : `图集 ${index + 1}`}</span></div>
          {item.mediaId !== draft.coverMediaId && <button type="button" onClick={() => void updateGallery(draft.media, item.mediaId)}>设为封面</button>}
          <button className="danger" type="button" onClick={() => void updateGallery(draft.media.filter((media) => media.mediaId !== item.mediaId), item.mediaId === draft.coverMediaId ? draft.media.find((media) => media.mediaId !== item.mediaId)?.mediaId || null : draft.coverMediaId)}>移除</button>
        </article>)}</div>}
      </section>

      <div className="editor-toolbar" aria-label="Markdown 格式工具栏">
        <button type="button" title="二级标题" onClick={() => insertLine("## ", "标题")}><Heading2 /></button>
        <button type="button" title="粗体" onClick={() => wrapSelection("**", "**")}><Bold /></button>
        <button type="button" title="斜体" onClick={() => wrapSelection("*", "*")}><Italic /></button>
        <button type="button" title="链接" onClick={() => wrapSelection("[", "](https://)", "链接文字")}><Link /></button>
        <button type="button" title="行内代码" onClick={() => wrapSelection("`", "`", "code")}><Code2 /></button>
        <button type="button" title="列表" onClick={() => insertLine("- ", "列表项")}><List /></button>
        <button type="button" title="引用" onClick={() => insertLine("> ", "引用内容")}><Quote /></button>
        <input ref={imageRef} type="file" accept="image/*" hidden onChange={(event) => event.target.files?.[0] && void uploadImage(event.target.files[0])} />
        <button type="button" title="上传图片" onClick={() => imageRef.current?.click()}><ImagePlus /></button>
        <span className="toolbar-spacer" />
        <button className={previewOpen ? "active" : ""} type="button" title="切换预览" onClick={() => setPreviewOpen((value) => !value)}><Eye /></button>
      </div>

      <div className={`markdown-workspace ${previewOpen ? "with-preview" : ""}`}>
        <div className="markdown-source" aria-label="Markdown 编辑区">
          <CodeMirror
            value={draft.bodyMarkdown}
            height="100%"
            minHeight="520px"
            extensions={[markdown()]}
            onCreateEditor={(view) => { editorRef.current = view as unknown as EditorViewLike; }}
            onChange={(value) => update("bodyMarkdown", value)}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          />
        </div>
        {previewOpen && <article className="markdown-preview prose" dangerouslySetInnerHTML={{ __html: previewHtml || "<p class=\"empty-copy\">预览将在这里显示。</p>" }} />}
      </div>
    </section>
  );
}
