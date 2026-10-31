"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import { isEscapeKey } from "../lib/keys";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  Globe,
  HardDrive,
  FileUp,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import BrandMark from "./BrandMark";
import DialogHost from "./DialogHost";
import { showAlert, showPrompt } from "../lib/dialog";
import { tr } from "../lib/i18n";
import type { PublishProvider } from "../lib/publish-provider";
import { readNetlifySite } from "../lib/browser-netlify";
import LanguageSelector from "./LanguageSelector";
import { relativeTime } from "../lib/time";
import AllowedAccounts from "./AllowedAccounts";
import SiteMembers from "./SiteMembers";
import { useServerStatus } from "../lib/status";
import { installNoDblClickSelect } from "../lib/no-dblclick-select";
import { createInitialDoc } from "../lib/presets";
import { createLocalBrowserSite } from "../lib/browser-site-create";
import { resolveMcpEndpoint } from "../lib/external-edit/config";
import { createBrowserDoc, deleteBrowserDoc, readBrowserDoc } from "../lib/browser-doc-storage";
import { siteThumbnailImages, type SiteThumbnailImage } from "../lib/site-thumbnail";
import type { SiteDoc } from "../lib/types";
import {
  SITE_SCOPED_KEYS,
  emptyDest,
  deleteLocalSite,
  loadLocalSites,
  localSiteIdInUse,
  withLocalSiteListLock,
  saveLocalSites,
  siteKey,
  sitePath,
} from "../lib/site";
import {
  newSiteId,
  normalizeSiteInput,
  type SiteDest,
  type SiteInput,
  type SiteRecord,
} from "../lib/sites";

/** サイトの一覧をどこに保存しているか（server = D1、local = このブラウザ） */
type Store = "server" | "local";

/* ---------- 保存先とのやりとり ---------- */

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? tr("Request failed ({status})", { status: res.status }));
  return data as T;
}

/** 新しいサイトの最初の編集データを、エディタが読み込む場所に置いておく（サイト名を反映するため） */
async function seedDoc(id: string, name: string): Promise<boolean> {
  const doc = createInitialDoc();
  doc.siteName = name;
  return createBrowserDoc(id, JSON.stringify(doc));
}

function localSaveError() {
  return new Error(tr("Could not save changes in this browser. Check your browser's storage space and settings, then try again."));
}

function localDuplicateError() {
  return new Error(tr("Could not duplicate the site. Check your browser's storage space and settings, then try again."));
}

/** サイトの編集データ（ブラウザ内の保存）を新しいサイトへ写す。元に無ければ、新しいサイトと同じく作る */
async function copyLocalDoc(from: string, to: string, name: string): Promise<void> {
  const raw = await readBrowserDoc(from);
  let data = raw;
  if (data === null) {
    const doc = createInitialDoc();
    doc.siteName = name;
    data = JSON.stringify(doc);
  }
  if (!await createBrowserDoc(to, data)) throw localDuplicateError();
}

/** サイトを削除したときに、このブラウザに残っている保存も消す */
async function forgetLocal(id: string): Promise<void> {
  await deleteBrowserDoc(id);
  for (const key of SITE_SCOPED_KEYS) {
    try {
      window.localStorage.removeItem(siteKey(key, id));
    } catch {
      // 文書の削除は確定している。画面の設定の後片付けは、できる範囲で行えばよい。
    }
  }
}

/* ---------- 表示の部品 ---------- */

/** カードの「…」メニュー（エディタの部品を読み込まないよう、ホーム用に小さく作ったもの） */
function CardMenu({ items }: { items: { label: string; icon: ReactNode; danger?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEscapeKey(e)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="home-card-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? " is-open" : ""}`}
        aria-label={tr("Site actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="home-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "is-danger" : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SiteThumbnail({ site, store }: { site: SiteRecord; store: Store | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [images, setImages] = useState<SiteThumbnailImage[]>([]);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    if (!store) return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      if (store === "local") {
        const raw = await readBrowserDoc(site.id);
        return raw ? siteThumbnailImages(JSON.parse(raw) as SiteDoc, site.id) : [];
      }
      const res = await fetch(`/api/doc?site=${encodeURIComponent(site.id)}&thumbnail=1`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = await res.json() as { images?: SiteThumbnailImage[] };
      return Array.isArray(data.images) ? data.images : [];
    };
    const start = () => {
      void load().then(found => {
        if (active) {
          setImages(found);
          setImageIndex(0);
        }
      }).catch(() => {});
    };
    // Avoid reading every site's document when only a few cards are on screen.
    let observer: IntersectionObserver | undefined;
    if (ref.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          start();
        }
      }, { rootMargin: "250px" });
      observer.observe(ref.current);
    } else {
      start();
    }
    return () => {
      active = false;
      controller.abort();
      observer?.disconnect();
    };
  }, [site.id, store]);

  const image = images[imageIndex];
  return (
    <span className="home-card-thumb" ref={ref} aria-hidden>
      {image ? (
        image.kind === "ogp" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.src} alt="" loading="lazy" decoding="async" onError={() => setImageIndex(i => i + 1)} />
        ) : (
          <span className="home-card-thumb-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.src} alt="" loading="lazy" decoding="async" onError={() => setImageIndex(i => i + 1)} />
          </span>
        )
      ) : (
        <span>{Array.from(site.name)[0]?.toUpperCase() ?? "S"}</span>
      )}
    </span>
  );
}

function SiteCard({
  site,
  store,
  onSettings,
  onMembers,
  onDuplicate,
  onDelete,
  readOnly,
  provider,
}: {
  site: SiteRecord;
  store: Store | null;
  readOnly: boolean;
  provider: PublishProvider | null;
  onSettings: () => void;
  onMembers: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const edited = site.savedAt ?? site.updatedAt;
  const liveUrl = site.siteUrl ||
    (store === "local" && provider === "netlify"
      ? readNetlifySite(site.id)?.production?.url || null : null);
  return (
    <article className="home-card">
      <a className="home-card-link" href={sitePath(site.id)} aria-label={tr("Open {name}", { name: site.name })}>
        <SiteThumbnail site={site} store={store} />
      </a>
      <div className="home-card-body">
        <a className="home-card-name" href={sitePath(site.id)}>
          {site.name}
        </a>
        <div className="home-card-meta">
          {provider === "github" ? (
            site.repo ? (
              <span className="home-card-repo" title={site.repo}>
                <GitBranch size={12} />
                <span>{site.repo}</span>
              </span>
            ) : (
              <span className="home-card-repo is-unset">
                <GitBranch size={12} />
                <span>{tr("No publish target")}</span>
              </span>
            )
          ) : provider ? (
            <span className="home-card-repo">
              <Globe size={12} />
              <span>{provider === "netlify" ? "Netlify" : "Cloudflare Pages"}</span>
            </span>
          ) : null}
          {edited ? <span className="home-card-time">{tr("Edited {time}", { time: relativeTime(edited) })}</span> : null}
        </div>
      </div>
      {!readOnly && <CardMenu
        items={[
          { label: tr("Settings"), icon: <Settings size={14} />, onSelect: onSettings },
          ...(site.accessRole === "owner" ? [{ label: tr("Members and permissions"), icon: <Users size={14} />, onSelect: onMembers }] : []),
          { label: tr("Duplicate"), icon: <Copy size={14} />, onSelect: onDuplicate },
          ...(liveUrl
            ? [
                {
                  label: tr("Open live site"),
                  icon: <ExternalLink size={14} />,
                  onSelect: () => window.open(liveUrl, "_blank", "noopener"),
                },
              ]
            : []),
          ...(site.accessRole === "viewer" || site.accessRole === "editor" ? [] : [{ label: tr("Delete"), icon: <Trash2 size={14} />, danger: true, onSelect: onDelete }]),
        ]}
      />}
    </article>
  );
}

/* ---------- サイトの作成・設定 ---------- */

type FormValue = { name: string } & { [K in keyof SiteDest]: string };

function toForm(site: SiteRecord | null): FormValue {
  const d = site ?? { name: "", ...emptyDest() };
  return {
    name: d.name,
    repo: d.repo ?? "",
    branch: d.branch,
    previewBranch: d.previewBranch,
    siteUrl: d.siteUrl ?? "",
    previewUrl: d.previewUrl ?? "",
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="home-field">
      <span className="home-field-label">{label}</span>
      {children}
      {hint && <span className="home-field-hint">{hint}</span>}
    </label>
  );
}

function SiteDialog({
  site,
  copyOf,
  provider,
  onClose,
  onSave,
}: {
  /** null = 新しく作る */
  site: SiteRecord | null;
  /** 複製するサイト（site が null のとき） */
  copyOf?: SiteRecord;
  provider: PublishProvider | null;
  onClose: () => void;
  onSave: (input: SiteInput) => Promise<void>;
}) {
  // 複製では公開先を写さない（2つのサイトから同じリポジトリへ公開してしまわないため）
  const [form, setForm] = useState<FormValue>(() =>
    copyOf ? { ...toForm(null), name: tr("{name} copy", { name: copyOf.name }) } : toForm(site)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destination = useRef<HTMLDetailsElement>(null);
  const set = (k: keyof FormValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEscapeKey(e) && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // 送る前に、サーバーと同じ規則で確かめる（サーバーでも確かめ直す）
    const checked = normalizeSiteInput(form, { name: "", ...emptyDest() });
    if (!checked.ok) {
      setError(tr(checked.error));
      if (destination.current && !["Enter a site name", "Site names can be up to 100 characters"].includes(checked.error)) {
        destination.current.open = true;
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(checked.value);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <form className="modal home-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{site ? tr("Site settings (menu)") : copyOf ? tr("Duplicate site") : tr("New site")}</h2>
        <p className="modal-desc">
          {site
            ? provider === "github"
              ? tr("Change the site name and the GitHub repository it publishes to.")
              : tr("Change the site name and optional published site URLs.")
            : copyOf
              ? tr("Creates a new site with the same pages, elements and settings as “{name}”. The publishing destination isn't copied, so set one if you need it.", { name: copyOf.name })
              : tr("Creates an empty site and opens it in the editor.")}
        </p>

        <Field label={tr("Site name")}>
          <input className="input" value={form.name} onChange={set("name")} autoFocus maxLength={100} required />
        </Field>

        <details
          className="home-dest"
          ref={destination}
          open={!!site}
          onInvalidCapture={(e) => { e.currentTarget.open = true; }}
        >
          <summary className="home-dest-head">
            <ChevronRight size={14} />
            <span>{tr("Publish target")}</span>
            <span className="home-dest-sub">{tr("You can set this later")}</span>
          </summary>
          <div className="home-dest-body">
            {provider === "github" && (<>
            <Field
              label={tr("GitHub repository")}
              hint={tr("Enter as owner/name. You can edit without it, but you can't publish.")}
            >
              <input
                className="input mono"
                value={form.repo}
                onChange={set("repo")}
                placeholder="owner/site-repo"
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
            <div className="home-field-row">
              <Field label={tr("Production branch")}>
                <input className="input mono" value={form.branch} onChange={set("branch")} placeholder="main" spellCheck={false} />
              </Field>
              <Field label={tr("Test branch")} hint={tr("Leave empty to turn off test publishing")}>
                <input
                  className="input mono"
                  value={form.previewBranch}
                  onChange={set("previewBranch")}
                  placeholder="preview"
                  spellCheck={false}
                />
              </Field>
            </div>
            </>)}
            {provider !== "github" && (
              <p className="hint">{provider === "netlify"
                ? tr("Netlify is connected when you publish. Your account and project links remain in this browser.")
                : tr("Hosting provider and credentials are set on the server. A separate hosting project is created automatically for every site.")}</p>
            )}
            <div className="home-field-row">
              <Field label={tr("Live site URL")}>
                <input className="input" value={form.siteUrl} onChange={set("siteUrl")} placeholder="https://example.com" type="url" />
              </Field>
              <Field label={tr("Test site URL")}>
                <input
                  className="input"
                  value={form.previewUrl}
                  onChange={set("previewUrl")}
                  placeholder="https://preview.example.com"
                  type="url"
                />
              </Field>
            </div>
          </div>
        </details>

        {error && (
          <p className="home-dialog-error">
            <TriangleAlert size={13} />
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <LoaderCircle size={13} className="spin" />}
            {site ? tr("save") : copyOf ? tr("Duplicate") : tr("Create and open")}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- 全体の設定（表示言語・ログインできるアカウント） ---------- */

function AppSettings({ auth, onClose }: { auth: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 確認ダイアログを開いている間は、そちらを先に閉じる
      if (isEscapeKey(e) && !document.querySelector(".modal.dialog")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal home-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("Settings")}</h2>
        <p className="modal-desc">{tr("These settings apply to all sites.")}</p>

        <section className="home-set-sec">
          <h3>{tr("Language (display)")}</h3>
          <LanguageSelector />
          <p className="home-field-hint">{tr("The editor reloads when you switch. Your site's content isn't changed.")}</p>
        </section>

        {auth && (
          <section className="home-set-sec">
            <h3>{tr("Accounts with access")}</h3>
            <p className="home-field-hint">{tr("Email addresses that can sign in to this editor with Google.")}</p>
            <AllowedAccounts />
          </section>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {tr("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 本体 ---------- */

export default function Home() {
  const status = useServerStatus();
  const readOnly = status?.role !== "editor";
  const [provider, setProvider] = useState<PublishProvider | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [sites, setSites] = useState<SiteRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** 開いているダイアログ（"new" = 新しいサイト、サイト = その設定、copy = そのサイトの複製） */
  const [dialog, setDialog] = useState<"new" | SiteRecord | { copy: SiteRecord } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersSite, setMembersSite] = useState<SiteRecord | null>(null);
  const importFileInput = useRef<HTMLInputElement>(null);
  const importActive = useRef(false);
  const pendingDraft = useRef<{ id: string; secret: string } | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [importStatus, setImportStatus] = useState<
    { kind: "loading"; message: string; source?: "remote" } |
    { kind: "error"; message: string; source?: "remote" } | null
  >(() => typeof window !== "undefined" && /^#tsumu-import=([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,64})$/.test(window.location.hash)
    ? { kind: "loading", message: tr("Reading edit data…"), source: "remote" } : null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/sites");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 503) {
        setStore("local");
        setSites(loadLocalSites());
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.sites) throw new Error(data?.error ?? tr("Couldn't load"));
      setStore("server");
      setSites(data.sites);
    } catch (e) {
      setLoadError((e as Error).message);
      setSites((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/publish/provider")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { provider?: PublishProvider } | null) => {
        if (mounted && (data?.provider === "github" || data?.provider === "netlify" || data?.provider === "cloudflare")) {
          setProvider(data.provider);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => installNoDblClickSelect(), []);

  const runFileImport = useCallback(async (file: File, notifyOnConversion = false) => {
    if (!store || importActive.current || readOnly) return;
    importActive.current = true;
    setImportStatus({ kind: "loading", message: tr("Reading edit data…") });
    try {
      const { createSiteFromFile } = await import("../lib/import-site-file");
      const { id } = await createSiteFromFile(file, store,
        (message) => setImportStatus({ kind: "loading", message }),
        notifyOnConversion ? () => showAlert(tr("No editing data was found in the ZIP. The HTML will be converted and imported.")) : undefined);
      window.location.assign(sitePath(id));
    } catch (error) {
      setImportStatus({ kind: "error", message: error instanceof Error
        ? tr(error.message) : tr("Could not restore the site.") });
    } finally {
      importActive.current = false;
    }
  }, [store, readOnly]);

  // Reuse the existing importer: the temporary URL never writes into an existing site.
  const runRemoteImport = useCallback(async (draft: { id: string; secret: string }) => {
    if (!store || importActive.current) return;
    if (readOnly) {
      setImportStatus({ kind: "error", source: "remote", message: tr("Could not restore the site.") });
      return;
    }
    importActive.current = true;
    setImportStatus({ kind: "loading", message: tr("Reading edit data…"), source: "remote" });
    const url = resolveMcpEndpoint(process.env.NEXT_PUBLIC_TSUMU_MCP_URL) +
      "/drafts/" + encodeURIComponent(draft.id);
    try {
      const claim = await fetch(url + "/claim", {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { Authorization: "Bearer " + draft.secret },
      });
      if (!claim.ok) throw new Error((await claim.json().catch(() => null))?.error ?? String(claim.status));
      const result = await claim.json() as { doc?: unknown; receipt?: unknown };
      if (typeof result.doc !== "string" || typeof result.receipt !== "string") throw new Error("Invalid draft response");
      const file = new File([result.doc], "doc.json", { type: "application/json" });
      const { createSiteFromFile } = await import("../lib/import-site-file");
      const { id } = await createSiteFromFile(file, store,
        message => setImportStatus({ kind: "loading", message, source: "remote" }));
      // Acknowledge removal only after the editor confirms a successful save.
      try {
        const complete = await fetch(url + "/complete", {
          method: "POST", redirect: "error", cache: "no-store",
          headers: { Authorization: "Bearer " + draft.secret, "Content-Type": "application/json" },
          body: JSON.stringify({ receipt: result.receipt }),
        });
        if (!complete.ok) console.warn("Temporary Tsumu draft cleanup was not confirmed:", complete.status);
      } catch (error) {
        // The server expiry alarm will clean up if the acknowledgement is lost.
        console.warn("Temporary Tsumu draft cleanup failed:", error);
      }
      pendingDraft.current = null;
      window.location.assign(sitePath(id));
    } catch (error) {
      setImportStatus({ kind: "error", source: "remote",
        message: tr("Could not restore the site.") + ": " + (error instanceof Error ? error.message : String(error)) });
    } finally {
      importActive.current = false;
    }
  }, [store, readOnly]);

  useEffect(() => {
    // Wait for storage mode and permissions; React Strict Mode must not claim twice.
    if (!store || !status) return;
    const match = /^#tsumu-import=([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,64})$/.exec(window.location.hash);
    if (!match) return;
    pendingDraft.current = { id: match[1], secret: match[2] };
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void runRemoteImport(pendingDraft.current);
  }, [store, status, runRemoteImport]);

  // ホーム画面のどこにドロップしても受け取る。通常のテキストやリンクのドラッグは妨げない。
  useEffect(() => {
    // ドラッグ＆ドロップはブラウザ専用。テスト用の簡易な window には EventTarget が無い場合がある。
    if (typeof window.addEventListener !== "function" || typeof window.removeEventListener !== "function") return;
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      !!event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
    const clear = () => {
      depth = 0;
      setDraggingFile(false);
    };
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      if (store && !importActive.current) setDraggingFile(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const canImport = !!store && !importActive.current;
      if (event.dataTransfer) event.dataTransfer.dropEffect = canImport ? "copy" : "none";
      if (depth === 0) depth = 1;
      if (canImport) setDraggingFile(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDraggingFile(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); // 未対応のファイルでも、ブラウザがファイルを表示するページへ移らないようにする
      const file = event.dataTransfer?.files[0];
      clear();
      if (file && store && !importActive.current) void runFileImport(file, true);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("blur", clear);
    };
  }, [store, runFileImport]);

  // エディタの「サイトの設定を開く」から来たときは、そのサイトの設定を開く
  useEffect(() => {
    if (!sites) return;
    const id = new URLSearchParams(window.location.search).get("settings");
    if (!id) return;
    const site = sites.find((s) => s.id === id);
    if (site) setDialog(site);
    window.history.replaceState(null, "", "/");
  }, [sites]);

  const create = async (input: SiteInput) => {
    let id: string;
    const name = input.name ?? "";
    if (store === "server") {
      const data = await api<{ site: SiteRecord }>("/api/sites", { method: "POST", body: JSON.stringify(input) });
      id = data.site.id;
      // サーバーには登録済みのため、ブラウザに置けなくても、エディタで初期データを作れる。
      await seedDoc(id, name).catch(() => false);
    } else {
      id = (await createLocalBrowserSite(input)).id;
    }
    window.location.href = sitePath(id);
  };

  /** サイトを複製する（開かずに、一覧の先頭に追加する） */
  const duplicate = async (src: SiteRecord, input: SiteInput) => {
    let site: SiteRecord;
    let localSites: SiteRecord[] | undefined;
    if (store === "server") {
      const data = await api<{ site: SiteRecord }>("/api/sites", {
        method: "POST",
        body: JSON.stringify({ ...input, copyFrom: src.id }),
      });
      site = data.site;
    } else {
      const now = Date.now();
      site = { ...emptyDest(), ...input, name: input.name ?? "", id: newSiteId(), createdAt: now, updatedAt: now } as SiteRecord;
      let copied = false;
      try {
        await copyLocalDoc(src.id, site.id, site.name);
        copied = true;
        await withLocalSiteListLock(() => {
          const list = loadLocalSites({ strict: true });
          if (!list.some((s) => s.id === src.id)) throw new Error(tr("Site not found"));
          if (localSiteIdInUse(site.id, list)) throw localDuplicateError();
          localSites = [site, ...list];
          if (!saveLocalSites(localSites)) throw localDuplicateError();
        });
      } catch {
        if (copied) await forgetLocal(site.id).catch(() => {});
        throw localDuplicateError();
      }
    }
    setSites((list) => localSites ?? [site, ...(list ?? [])]);
    setDialog(null);
  };

  const update = async (site: SiteRecord, input: SiteInput) => {
    if (store === "server") {
      const data = await api<{ site: SiteRecord }>(`/api/sites/${encodeURIComponent(site.id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      setSites((list) => list?.map((s) => (s.id === site.id ? data.site : s)) ?? null);
    } else {
      await withLocalSiteListLock(() => {
        let list: SiteRecord[];
        try {
          list = loadLocalSites({ strict: true });
        } catch {
          throw localSaveError();
        }
        if (!list.some((s) => s.id === site.id)) throw new Error(tr("Site not found"));
        const next = list.map((s) => (s.id === site.id ? { ...s, ...input, updatedAt: Date.now() } : s));
        if (!saveLocalSites(next)) throw localSaveError();
        setSites(next);
      });
    }
    setDialog(null);
  };

  const remove = async (site: SiteRecord) => {
    const typed = await showPrompt(
      tr("This deletes the editing data and automatic backups of \"{name}\". This can't be undone.\nThe published website stays as it is.\n\nType the site name to confirm.", {
        name: site.name,
      }),
      { title: tr("Delete site"), okLabel: tr("Delete"), danger: true, expect: site.name, placeholder: site.name }
    );
    if (typed === null) return;
    try {
      if (store === "server") {
        await api(`/api/sites/${encodeURIComponent(site.id)}`, { method: "DELETE" });
      } else {
        try {
          // 削除の記録を保存できるまでは、一覧も内容も変更しない。確定した後の片付けは、失敗しても取り消さない。
          await withLocalSiteListLock(() => deleteLocalSite(site.id));
        } catch {
          throw localSaveError();
        }
      }
      await forgetLocal(site.id);
      setSites((list) => list?.filter((s) => s.id !== site.id) ?? null);
    } catch (e) {
      await showAlert((e as Error).message, { title: tr("Couldn't delete") });
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !sites) return sites;
    return sites.filter((s) => s.name.toLowerCase().includes(q) || s.repo?.toLowerCase().includes(q));
  }, [sites, query]);

  return (
    <div className="home">
      {importStatus?.kind === "loading" && importStatus.source === "remote" && (
        <div className="home-import-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="home-import-skeleton" aria-hidden="true">
            <header className="home-top">
              <div className="home-brand">
                <BrandMark size={28} />
                <strong>Tsumu</strong>
              </div>
            </header>
            <main className="home-main">
              <div className="home-import-skeleton-heading">
                <span />
                <span />
              </div>
              <div className="home-grid">
                {[0, 1, 2].map((i) => <div key={i} className="home-card is-skeleton" />)}
              </div>
            </main>
          </div>
          <div className="boot-card home-import-overlay-content">
            <BrandMark size={40} />
            <strong>{tr("Importing site")}</strong>
            <div className="boot-bar" aria-hidden="true"><span /></div>
            <p className="boot-tip">{importStatus.message}</p>
          </div>
        </div>
      )}
      <header className="home-top">
        <div className="home-brand">
          <BrandMark size={28} />
          <strong>Tsumu</strong>
        </div>
        <div className="home-top-actions">
          <button type="button" className="btn btn-ghost home-top-btn" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} />
            {tr("Settings")}
          </button>
          {status?.auth && (
            <button
              type="button"
              className="btn btn-ghost home-top-btn"
              onClick={() => void signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={14} />
              {tr("Sign out")}
            </button>
          )}
        </div>
      </header>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h1>{tr("Site")}</h1>
            {sites && sites.length > 0 && <p>{tr("{n} sites", { n: sites.length })}</p>}
          </div>
          <div className="home-head-actions">
            {sites && sites.length > 3 && (
              <label className="home-search">
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("Search sites")}
                  aria-label={tr("Search sites")}
                />
              </label>
            )}
            {!readOnly && <button type="button" className="btn home-new" onClick={() => importFileInput.current?.click()} disabled={!store || importActive.current}>
              <FileUp size={14} />
              {tr("Import")}
            </button>}
            <input
              ref={importFileInput}
              type="file"
              accept=".zip,.json,.html,.htm,application/zip,application/json,text/html"
              aria-label={tr("Choose a ZIP, doc.json, or HTML file")}
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void runFileImport(file);
              }}
            />
            {!readOnly && <button type="button" className="btn btn-primary home-new" onClick={() => setDialog("new")} disabled={!store}>
              <Plus size={14} />
              {tr("New site")}
            </button>}
          </div>
        </div>

        {importStatus && (
          <div className={`home-notice${importStatus.kind === "error" ? " is-error" : ""}`}
            role={importStatus.kind === "error" ? "alert" : "status"}>
            {importStatus.kind === "error"
              ? <TriangleAlert size={14} />
              : <LoaderCircle size={14} className="spin" />}
            <p>{importStatus.message}</p>
            {importStatus.kind === "error" && (
              <button type="button" className="btn btn-sm" onClick={() => {
                if (importStatus.source === "remote" && pendingDraft.current) void runRemoteImport(pendingDraft.current);
                else importFileInput.current?.click();
              }}>
                {importStatus.source === "remote" ? tr("Retry") : tr("Choose another file")}
              </button>
            )}
          </div>
        )}

        {store === "local" && (
          <div className="home-notice">
            <HardDrive size={14} />
            <p>
              {tr("No server storage is set up, so sites and edits are saved in this browser. They won't appear in other browsers or devices.")}
            </p>
          </div>
        )}

        {loadError && (
          <div className="home-notice is-error">
            <TriangleAlert size={14} />
            <p>{loadError}</p>
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              {tr("Reload")}
            </button>
          </div>
        )}

        {shown === null ? (
          <div className="home-grid" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="home-card is-skeleton" />
            ))}
          </div>
        ) : sites && sites.length === 0 && !loadError ? (
          <div className="home-empty">
            <span className="home-empty-icon">
              <LayoutGrid size={22} />
            </span>
            <strong>{tr("No sites yet")}</strong>
            <p>{tr("Create your first site to start editing.")}</p>
            {!readOnly && <button type="button" className="btn btn-primary" onClick={() => setDialog("new")}>
              <Plus size={14} />
              {tr("New site")}
            </button>}
          </div>
        ) : shown.length === 0 ? (
          <p className="home-none">{tr("No sites match \"{q}\".", { q: query.trim() })}</p>
        ) : (
          <div className="home-grid">
            {shown.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                store={store}
                onSettings={() => setDialog(site)}
                onMembers={() => setMembersSite(site)}
                onDuplicate={() => setDialog({ copy: site })}
                onDelete={() => void remove(site)}
                readOnly={readOnly || site.accessRole === "viewer"}
                provider={provider}
              />
            ))}
          </div>
        )}
      </main>

      {dialog && (
        <SiteDialog
          site={dialog === "new" || "copy" in dialog ? null : dialog}
          copyOf={dialog !== "new" && "copy" in dialog ? dialog.copy : undefined}
          provider={provider}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            dialog === "new" ? create(input) : "copy" in dialog ? duplicate(dialog.copy, input) : update(dialog, input)
          }
        />
      )}
      {membersSite && <SiteMembers siteId={membersSite.id} siteName={membersSite.name} onClose={() => setMembersSite(null)} />}
      {settingsOpen && <AppSettings auth={!!status?.auth && !readOnly}
        onClose={() => setSettingsOpen(false)} />}
      <DialogHost />
      {draggingFile && (
        <div className="home-drop-overlay" aria-hidden="true">
          <div className="home-drop-overlay-content">
            <FileUp size={24} />
            <span>{tr("Drop a ZIP, doc.json, or HTML file to import")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
