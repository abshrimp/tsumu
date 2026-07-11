"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  HardDrive,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import BrandMark from "./BrandMark";
import DialogHost from "./DialogHost";
import { showAlert, showPrompt } from "../lib/dialog";
import { getLang, LANGS, setLang, tr } from "../lib/i18n";
import { relativeTime } from "../lib/time";
import AllowedAccounts from "./AllowedAccounts";
import { useServerStatus } from "../lib/status";
import { installNoDblClickSelect } from "../lib/no-dblclick-select";
import { createInitialDoc } from "../lib/presets";
import {
  DOC_STORAGE_KEY,
  SITE_SCOPED_KEYS,
  emptyDest,
  loadLocalSites,
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

/** サイトの一覧をどこに保存しているか（server = D1 / local = このブラウザ） */
type Store = "server" | "local";

/* ---------- 保存先とのやりとり ---------- */

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? tr("通信に失敗しました（{status}）", { status: res.status }));
  return data as T;
}

/** 新しいサイトの最初の編集データを、エディタが読み込む場所に置いておく（サイト名を反映するため） */
function seedDoc(id: string, name: string) {
  try {
    const doc = createInitialDoc();
    doc.siteName = name;
    window.localStorage.setItem(siteKey(DOC_STORAGE_KEY, id), JSON.stringify(doc));
  } catch {
    // 置けなくても、エディタが既定の内容で始める
  }
}

/** サイトの編集データ（ブラウザ保存）を、新しいサイトへ写す。元に無ければ新しいサイトと同じく作る */
function copyLocalDoc(from: string, to: string, name: string) {
  try {
    const raw = window.localStorage.getItem(siteKey(DOC_STORAGE_KEY, from));
    if (raw) {
      window.localStorage.setItem(siteKey(DOC_STORAGE_KEY, to), raw);
      return;
    }
  } catch {
    // 写せなければ、空のサイトとして始める
  }
  seedDoc(to, name);
}

/** サイトを消したときに、このブラウザに残っている保存も消す */
function forgetLocal(id: string) {
  for (const key of SITE_SCOPED_KEYS) {
    try {
      window.localStorage.removeItem(siteKey(key, id));
    } catch {
      // 消せなくても実害はない
    }
  }
}

/* ---------- 表示の部品 ---------- */

/** カードの「…」メニュー（エディタの部品を読み込まないよう、ホーム用に小さく作る） */
function CardMenu({ items }: { items: { label: string; icon: ReactNode; danger?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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
        aria-label={tr("サイトの操作")}
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

function SiteCard({
  site,
  onSettings,
  onDuplicate,
  onDelete,
}: {
  site: SiteRecord;
  onSettings: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const edited = site.savedAt ?? site.updatedAt;
  return (
    <article className="home-card">
      <a className="home-card-link" href={sitePath(site.id)} aria-label={tr("{name} を開く", { name: site.name })}>
        <span className="home-card-thumb" aria-hidden>
          <span>{Array.from(site.name)[0]?.toUpperCase() ?? "S"}</span>
        </span>
      </a>
      <div className="home-card-body">
        <a className="home-card-name" href={sitePath(site.id)}>
          {site.name}
        </a>
        <div className="home-card-meta">
          {site.repo ? (
            <span className="home-card-repo" title={site.repo}>
              <GitBranch size={12} />
              <span>{site.repo}</span>
            </span>
          ) : (
            <span className="home-card-repo is-unset">
              <GitBranch size={12} />
              <span>{tr("公開先が未設定")}</span>
            </span>
          )}
          {edited ? <span className="home-card-time">{tr("{time}に編集", { time: relativeTime(edited) })}</span> : null}
        </div>
      </div>
      <CardMenu
        items={[
          { label: tr("設定"), icon: <Settings size={14} />, onSelect: onSettings },
          { label: tr("複製"), icon: <Copy size={14} />, onSelect: onDuplicate },
          ...(site.siteUrl
            ? [
                {
                  label: tr("公開サイトを開く"),
                  icon: <ExternalLink size={14} />,
                  onSelect: () => window.open(site.siteUrl!, "_blank", "noopener"),
                },
              ]
            : []),
          { label: tr("削除"), icon: <Trash2 size={14} />, danger: true, onSelect: onDelete },
        ]}
      />
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
  onClose,
  onSave,
}: {
  /** null = 新しく作る */
  site: SiteRecord | null;
  /** 複製するサイト（site が null のとき） */
  copyOf?: SiteRecord;
  onClose: () => void;
  onSave: (input: SiteInput) => Promise<void>;
}) {
  // 複製では公開先を写さない（同じリポジトリへ2つのサイトから公開してしまわないように）
  const [form, setForm] = useState<FormValue>(() =>
    copyOf ? { ...toForm(null), name: tr("{name} のコピー", { name: copyOf.name }) } : toForm(site)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 新規作成では公開先を畳んでおく（あとからでも設定できる）
  const [destOpen, setDestOpen] = useState(!!site);
  const set = (k: keyof FormValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // 送る前に同じ決まりで確かめる（サーバーでも確かめ直す）
    const checked = normalizeSiteInput(form, { name: "", ...emptyDest() });
    if (!checked.ok) {
      setError(tr(checked.error));
      if (!checked.error.includes("サイト名")) setDestOpen(true);
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
        <h2>{site ? tr("サイトの設定") : copyOf ? tr("サイトを複製") : tr("新しいサイト")}</h2>
        <p className="modal-desc">
          {site
            ? tr("サイト名と、公開先のGitHubリポジトリを変更できます。")
            : copyOf
              ? tr("「{name}」のページ・要素・設定をそのまま写した、新しいサイトを作ります。公開先は複製しないので、必要なら設定してください。", { name: copyOf.name })
              : tr("空のサイトを作って、エディタで開きます。")}
        </p>

        <Field label={tr("サイト名")}>
          <input className="input" value={form.name} onChange={set("name")} autoFocus maxLength={100} required />
        </Field>

        <section className={`home-dest${destOpen ? " is-open" : ""}`}>
          <button type="button" className="home-dest-head" onClick={() => setDestOpen((v) => !v)} aria-expanded={destOpen}>
            <ChevronRight size={14} />
            <span>{tr("公開先")}</span>
            {!destOpen && <span className="home-dest-sub">{tr("あとからでも設定できます")}</span>}
          </button>
          {destOpen && (
            <div className="home-dest-body">
              <Field
                label={tr("GitHubリポジトリ")}
                hint={tr("owner/name の形で入力します。空のままでも編集はできます（公開はできません）。")}
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
                <Field label={tr("本番のブランチ")}>
                  <input className="input mono" value={form.branch} onChange={set("branch")} placeholder="main" spellCheck={false} />
                </Field>
                <Field label={tr("テスト公開のブランチ")} hint={tr("空にするとテスト公開を使いません")}>
                  <input
                    className="input mono"
                    value={form.previewBranch}
                    onChange={set("previewBranch")}
                    placeholder="preview"
                    spellCheck={false}
                  />
                </Field>
              </div>
              <div className="home-field-row">
                <Field label={tr("本番サイトのURL")}>
                  <input className="input" value={form.siteUrl} onChange={set("siteUrl")} placeholder="https://example.com" type="url" />
                </Field>
                <Field label={tr("テストサイトのURL")}>
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
          )}
        </section>

        {error && (
          <p className="home-dialog-error">
            <TriangleAlert size={13} />
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {tr("キャンセル")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <LoaderCircle size={13} className="spin" />}
            {site ? tr("保存") : copyOf ? tr("複製") : tr("作成して開く")}
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
      if (e.key === "Escape" && !document.querySelector(".modal.dialog")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const lang = getLang();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal home-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("設定")}</h2>
        <p className="modal-desc">{tr("すべてのサイトに共通の設定です。")}</p>

        <section className="home-set-sec">
          <h3>{tr("表示言語")}</h3>
          <div className="home-seg" role="radiogroup" aria-label={tr("表示言語")}>
            {LANGS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={l.value === lang}
                className={l.value === lang ? "is-on" : ""}
                onClick={() => {
                  if (l.value !== lang) setLang(l.value);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="home-field-hint">{tr("切り替えると画面を読み込み直します。作成中のサイトの内容は変わりません。")}</p>
        </section>

        {auth && (
          <section className="home-set-sec">
            <h3>{tr("ログインできるアカウント")}</h3>
            <p className="home-field-hint">{tr("このエディタにGoogleアカウントでログインできるメールアドレスです。")}</p>
            <AllowedAccounts />
          </section>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {tr("閉じる")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 本体 ---------- */

export default function Home() {
  const status = useServerStatus();
  const [store, setStore] = useState<Store | null>(null);
  const [sites, setSites] = useState<SiteRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** 開いているダイアログ（"new" = 新しいサイト / サイト = その設定 / copy = そのサイトの複製） */
  const [dialog, setDialog] = useState<"new" | SiteRecord | { copy: SiteRecord } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      if (!res.ok || !data?.sites) throw new Error(data?.error ?? tr("読み込めませんでした"));
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

  useEffect(() => installNoDblClickSelect(), []);

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
    } else {
      id = newSiteId();
      const now = Date.now();
      const site = { ...emptyDest(), ...input, name, id, createdAt: now, updatedAt: now } as SiteRecord;
      saveLocalSites([site, ...loadLocalSites()]);
    }
    seedDoc(id, name);
    window.location.href = sitePath(id);
  };

  /** サイトを複製する（開かずに、一覧のいちばん上に足す） */
  const duplicate = async (src: SiteRecord, input: SiteInput) => {
    let site: SiteRecord;
    if (store === "server") {
      const data = await api<{ site: SiteRecord }>("/api/sites", {
        method: "POST",
        body: JSON.stringify({ ...input, copyFrom: src.id }),
      });
      site = data.site;
    } else {
      const now = Date.now();
      site = { ...emptyDest(), ...input, name: input.name ?? "", id: newSiteId(), createdAt: now, updatedAt: now } as SiteRecord;
      copyLocalDoc(src.id, site.id, site.name);
      saveLocalSites([site, ...loadLocalSites()]);
    }
    setSites((list) => [site, ...(list ?? [])]);
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
      const next = loadLocalSites().map((s) => (s.id === site.id ? { ...s, ...input, updatedAt: Date.now() } : s));
      saveLocalSites(next);
      setSites(next);
    }
    setDialog(null);
  };

  const remove = async (site: SiteRecord) => {
    const typed = await showPrompt(
      tr("「{name}」の編集データと自動バックアップを削除します。元に戻せません。\n公開済みのサイト（GitHubリポジトリ）はそのまま残ります。\n\n確認のため、サイト名を入力してください。", {
        name: site.name,
      }),
      { title: tr("サイトを削除"), okLabel: tr("削除"), danger: true, expect: site.name, placeholder: site.name }
    );
    if (typed === null) return;
    try {
      if (store === "server") {
        await api(`/api/sites/${encodeURIComponent(site.id)}`, { method: "DELETE" });
      } else {
        saveLocalSites(loadLocalSites().filter((s) => s.id !== site.id));
      }
      forgetLocal(site.id);
      setSites((list) => list?.filter((s) => s.id !== site.id) ?? null);
    } catch (e) {
      await showAlert((e as Error).message, { title: tr("削除できませんでした") });
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !sites) return sites;
    return sites.filter((s) => s.name.toLowerCase().includes(q) || s.repo?.toLowerCase().includes(q));
  }, [sites, query]);

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <BrandMark size={28} />
          <strong>Tsumu</strong>
        </div>
        <div className="home-top-actions">
          <button type="button" className="btn btn-ghost home-top-btn" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} />
            {tr("設定")}
          </button>
          {status?.auth && (
            <button
              type="button"
              className="btn btn-ghost home-top-btn"
              onClick={() => void signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={14} />
              {tr("ログアウト")}
            </button>
          )}
        </div>
      </header>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h1>{tr("サイト")}</h1>
            {sites && sites.length > 0 && <p>{tr("{n}件のサイト", { n: sites.length })}</p>}
          </div>
          <div className="home-head-actions">
            {sites && sites.length > 3 && (
              <label className="home-search">
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("サイトを探す")}
                  aria-label={tr("サイトを探す")}
                />
              </label>
            )}
            <button type="button" className="btn btn-primary home-new" onClick={() => setDialog("new")} disabled={!store}>
              <Plus size={14} />
              {tr("新しいサイト")}
            </button>
          </div>
        </div>

        {store === "local" && (
          <div className="home-notice">
            <HardDrive size={14} />
            <p>
              {tr("サーバーの保存先が設定されていないため、サイトと編集内容はこのブラウザに保存されます。別のブラウザや端末からは見えません。")}
            </p>
          </div>
        )}

        {loadError && (
          <div className="home-notice is-error">
            <TriangleAlert size={14} />
            <p>{loadError}</p>
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              {tr("再読み込み")}
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
            <strong>{tr("まだサイトがありません")}</strong>
            <p>{tr("最初のサイトを作って、編集を始めましょう。")}</p>
            <button type="button" className="btn btn-primary" onClick={() => setDialog("new")}>
              <Plus size={14} />
              {tr("新しいサイト")}
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="home-none">{tr("「{q}」に当てはまるサイトはありません。", { q: query.trim() })}</p>
        ) : (
          <div className="home-grid">
            {shown.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                onSettings={() => setDialog(site)}
                onDuplicate={() => setDialog({ copy: site })}
                onDelete={() => void remove(site)}
              />
            ))}
          </div>
        )}
      </main>

      {dialog && (
        <SiteDialog
          site={dialog === "new" || "copy" in dialog ? null : dialog}
          copyOf={dialog !== "new" && "copy" in dialog ? dialog.copy : undefined}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            dialog === "new" ? create(input) : "copy" in dialog ? duplicate(dialog.copy, input) : update(dialog, input)
          }
        />
      )}
      {settingsOpen && <AppSettings auth={!!status?.auth} onClose={() => setSettingsOpen(false)} />}
      <DialogHost />
    </div>
  );
}
