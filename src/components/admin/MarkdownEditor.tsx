import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
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
  X,
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
  posAtCoords(coords: { x: number; y: number }): number | null;
}

interface ImageEditState {
  start: number;
  end: number;
  baseSource: string;
  url: string;
  alt: string;
  width: number;
  crop: PercentCrop;
  imageRatio: number;
}

function imageSettings(source: string): Pick<ImageEditState, "baseSource" | "width" | "crop" | "imageRatio"> {
  const attributes = source.match(/\{([^{}]+)\}$/);
  const values = Object.fromEntries((attributes?.[1] || "").split(/\s+/).map((token) => token.split("=")).filter((pair) => pair.length === 2));
  const width = Number(values.width);
  const cropValues = (values.crop || "").split(",").map(Number);
  const crop: PercentCrop = cropValues.length === 4 && cropValues.every(Number.isFinite)
    ? { unit: "%", x: cropValues[0], y: cropValues[1], width: cropValues[2], height: cropValues[3] }
    : { unit: "%", x: 0, y: 0, width: 100, height: 100 };
  return {
    baseSource: attributes ? source.slice(0, -attributes[0].length) : source,
    width: Number.isFinite(width) && width >= 20 && width <= 100 ? width : 100,
    crop,
    imageRatio: Number(values.ratio) || 1,
  };
}

function markdownBlockStarts(markdownText: string): number[] {
  const starts: number[] = [];
  const pattern = /(?:^|\n\s*\n)(?=\S)/g;
  for (const match of markdownText.matchAll(pattern)) starts.push(match.index! + (match[0].startsWith("\n") ? match[0].length : 0));
  return starts.length ? starts : [0];
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

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  const [tagHistory, setTagHistory] = useState<string[]>([]);
  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);
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

  useEffect(() => {
    studioRequest<string[]>("/api/admin/tags").then(setTagHistory).catch(() => undefined);
  }, []);

  const update = useCallback(<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }, []);

  const payload = useCallback(
    (status = draft.status) => ({
      type: draft.type,
      status: status === "published" && draft.publishedAt && Date.parse(draft.publishedAt) > Date.now() ? "scheduled" : status,
      title: draft.title.trim(),
      slug: draft.slug.trim() || slugify(draft.title),
      summary: draft.summary.trim(),
      bodyMarkdown: draft.bodyMarkdown,
      locale: draft.locale,
      translationGroup: null,
      coverMediaId: draft.coverMediaId,
      metadata: Object.fromEntries(Object.entries(draft.metadata).filter(([, value]) => value !== "")),
      tags: draft.tags,
      publishedAt: status === "published" || status === "scheduled" ? draft.publishedAt : null,
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
        setTagHistory((current) => Array.from(new Set([...current, ...record.tags])).sort((a, b) => a.localeCompare(b, "zh-CN")));
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

  const changeStatus = async (action: "publish" | "unpublish" | "archive" | "schedule") => {
    const saved = await save();
    const id = saved?.id || draft.id;
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      const path = action === "archive" || action === "schedule" ? `/api/admin/content/${id}` : `/api/admin/content/${id}/${action}`;
      const record = await studioRequest<ContentRecord>(
        path,
        action === "archive" || action === "schedule"
          ? { method: "PATCH", ...jsonBody(action === "archive" ? { status: "archived" } : { status: "scheduled", publishedAt: draft.publishedAt }) }
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

  const uploadImages = async (files: File[], position?: number) => {
    if (!files.length) return;
    setSaving(true);
    setError("");
    try {
      const markdownImages: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        form.set("altText", file.name.replace(/\.[^.]+$/, ""));
        const media = await studioRequest<MediaRecord>("/api/admin/media", { method: "POST", body: form });
        const url = media.url || `/media/${encodeURIComponent(media.id)}`;
        markdownImages.push(`![${media.altText || "图片"}](${url})`);
      }

      const view = editorRef.current;
      if (!view) return;
      const selection = view.state.selection.main;
      const from = position ?? selection.from;
      const to = position ?? selection.to;
      const insert = markdownImages.join("\n\n");
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      view.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片上传失败");
    } finally {
      setSaving(false);
    }
  };

  const dropImages = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const position = editorRef.current?.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position == null) return;
    event.preventDefault();
    void uploadImages(files, position);
  };

  const openImageEditor = (event: ReactMouseEvent<HTMLElement>) => {
    const image = (event.target as HTMLElement).closest("img[data-markdown-source]") as HTMLImageElement | null;
    if (!image) return;
    const source = image.dataset.markdownSource;
    if (!source) return;
    const matchingImages = Array.from(event.currentTarget.querySelectorAll<HTMLImageElement>("img[data-markdown-source]"))
      .filter((candidate) => candidate.dataset.markdownSource === source);
    const occurrence = matchingImages.indexOf(image);
    let start = -1;
    for (let index = 0, from = 0; index <= occurrence; index += 1) {
      start = draft.bodyMarkdown.indexOf(source, from);
      if (start < 0) return;
      from = start + source.length;
    }
    setImageEdit({
      start,
      end: start + source.length,
      url: image.currentSrc || image.src,
      alt: image.alt,
      ...imageSettings(source),
      imageRatio: image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : imageSettings(source).imageRatio,
    });
  };

  const applyImageEdit = () => {
    if (!imageEdit) return;
    const settings = [
      imageEdit.width < 100 ? `width=${imageEdit.width}` : "",
      imageEdit.crop.width < 99.99 || imageEdit.crop.height < 99.99 || imageEdit.crop.x > 0.01 || imageEdit.crop.y > 0.01
        ? `crop=${[imageEdit.crop.x, imageEdit.crop.y, imageEdit.crop.width, imageEdit.crop.height].map((value) => Number(value.toFixed(2))).join(",")}`
        : "",
      imageEdit.crop.width < 99.99 || imageEdit.crop.height < 99.99 ? `ratio=${Number(((imageEdit.crop.width / imageEdit.crop.height) * imageEdit.imageRatio).toFixed(4))}` : "",
    ].filter(Boolean);
    const replacement = `${imageEdit.baseSource}${settings.length ? `{${settings.join(" ")}}` : ""}`;
    update("bodyMarkdown", `${draft.bodyMarkdown.slice(0, imageEdit.start)}${replacement}${draft.bodyMarkdown.slice(imageEdit.end)}`);
    setImageEdit(null);
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
          {draft.status === "scheduled" ? (
            <button className="primary-button" type="button" onClick={() => void changeStatus("unpublish")}><X />取消定时</button>
          ) : draft.status === "published" ? (
            <button className="primary-button" type="button" onClick={() => void changeStatus("unpublish")}><Check />已发布 · 撤回</button>
          ) : (
            <button className="primary-button" type="button" disabled={!draft.title.trim()} onClick={() => void changeStatus("publish")}><Send />发布</button>
          )}
          {draft.status !== "published" && draft.status !== "scheduled" && <button className="secondary-button" type="button" disabled={!draft.title.trim() || !draft.publishedAt || Date.parse(draft.publishedAt) <= Date.now()} onClick={() => void changeStatus("schedule")} title="设置未来的发布时间"><Send />定时发布</button>}
          {draft.id && <button className="icon-button danger" type="button" onClick={() => void changeStatus("archive")} title="归档"><Archive /></button>}
        </div>
      </header>

      {error && <div className="studio-alert" role="alert">{error}</div>}

      {imageEdit && <div className="image-editor-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setImageEdit(null);
      }}>
        <section className="image-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="image-editor-title">
          <header><div><strong id="image-editor-title">调整图片</strong><span>{imageEdit.alt || "图片"}</span></div><button className="icon-button" type="button" title="关闭" onClick={() => setImageEdit(null)}><X /></button></header>
          <div className="image-editor-sample"><ReactCrop crop={imageEdit.crop} onChange={(_, percentCrop) => setImageEdit((current) => current && ({ ...current, crop: percentCrop }))} minWidth={30} minHeight={30} keepSelection><img src={imageEdit.url} alt="" /></ReactCrop></div>
          <label className="image-editor-range"><span>显示宽度 <strong>{imageEdit.width}%</strong></span><input type="range" min="20" max="100" step="5" value={imageEdit.width} onChange={(event) => setImageEdit((current) => current && ({ ...current, width: Number(event.target.value) }))} /></label>
          <p className="image-editor-help">拖动裁剪框可移动选区，拖动四角或四边可自由改变范围。</p>
          <footer><button className="secondary-button" type="button" onClick={() => setImageEdit(null)}>取消</button><button className="primary-button" type="button" onClick={applyImageEdit}>应用</button></footer>
        </section>
      </div>}

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
        <label className="field"><span>标签</span><input list="tag-history" value={draft.tags.join(", ")} onChange={(event) => update("tags", event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))} placeholder="Astro, Cloudflare" /><datalist id="tag-history">{tagHistory.map((tag) => <option key={tag} value={tag} />)}</datalist></label>
        <label className="field"><span>语言</span><select value={draft.locale} onChange={(event) => update("locale", event.target.value)}><option value="zh-CN">简体中文</option><option value="en">English（预留）</option></select></label>
        <label className="field"><span>发布时间</span><input type="datetime-local" value={toLocalDateTime(draft.publishedAt)} onChange={(event) => update("publishedAt", event.target.value ? new Date(event.target.value).toISOString() : null)} /></label>
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
        <input ref={imageRef} type="file" accept="image/*" hidden onChange={(event) => event.target.files?.[0] && void uploadImages([event.target.files[0]])} />
        <button type="button" title="上传图片" onClick={() => imageRef.current?.click()}><ImagePlus /></button>
        <span className="toolbar-spacer" />
        <button className={previewOpen ? "active" : ""} type="button" title="切换预览" onClick={() => setPreviewOpen((value) => !value)}><Eye /></button>
      </div>

      <div className={`markdown-workspace ${previewOpen ? "with-preview" : ""}`}>
        <div
          className="markdown-source"
          aria-label="Markdown 编辑区"
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/"))) event.preventDefault();
          }}
          onDrop={dropImages}
        >
          <CodeMirror
            value={draft.bodyMarkdown}
            height="100%"
            extensions={[markdown(), EditorView.lineWrapping]}
            onCreateEditor={(view) => { editorRef.current = view as unknown as EditorViewLike; }}
            onChange={(value) => update("bodyMarkdown", value)}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          />
        </div>
        {previewOpen && <article className="markdown-preview prose" title="单击内容可定位源码，双击图片可调整大小和裁剪" onClick={(event) => {
          const block = (event.target as HTMLElement).closest<HTMLElement>("[data-markdown-block]");
          const index = Number(block?.dataset.markdownBlock);
          const position = markdownBlockStarts(draft.bodyMarkdown)[index];
          if (!Number.isFinite(position) || !editorRef.current) return;
          editorRef.current.dispatch({ selection: { anchor: position }, scrollIntoView: true });
          editorRef.current.focus();
        }} onDoubleClick={openImageEditor} dangerouslySetInnerHTML={{ __html: previewHtml || "<p class=\"empty-copy\">预览将在这里显示。</p>" }} />}
      </div>
    </section>
  );
}
