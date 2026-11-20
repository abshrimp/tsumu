"use client";

import { useEffect, useState } from "react";
import { loadLocalSites, sitePath } from "../../../lib/site";
import type { SiteRecord } from "../../../lib/site-model";
import { isOfficialEditorOrigin } from "../../../lib/external-edit/official.mjs";

/**
 * The official site picker runs on the editor's own origin, where the user
 * can see locally stored sites. The MCP OAuth server never receives an
 * unapproved site list, browser-storage access, or login cookies.
 */
type SelectableSite = Pick<SiteRecord, "id" | "name"> & { accessRole?: SiteRecord["accessRole"] };
const INVITE = /^#invite=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export default function McpSiteChooser() {
  const [sites, setSites] = useState<SelectableSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [allowEdit, setAllowEdit] = useState(true);
  const [invite, setInvite] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!isOfficialEditorOrigin(window.location.origin)) return;
    const match = INVITE.exec(window.location.hash);
    if (!match) {
      setError("有効なサイト追加リンクから開いてください。");
      setLoading(false);
      return;
    }
    setInvite(match[1] + "." + match[2]);
    window.history.replaceState(window.history.state, "",
      window.location.pathname + window.location.search);
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/sites", { cache: "no-store" });
        let items: SelectableSite[];
        if (response.status === 503) {
          items = loadLocalSites();
        } else if (response.ok) {
          const body = await response.json() as { sites?: SiteRecord[] };
          if (!Array.isArray(body.sites)) throw new Error("サイト一覧を取得できませんでした。");
          items = body.sites;
        } else {
          throw new Error(response.status === 401 ?
            "Tsumuにログインし直してから接続してください。" : "サイト一覧を取得できませんでした。");
        }
        if (alive) setSites(items);
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : "サイト一覧を取得できませんでした。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== selectedWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== "tsumu-mcp-site-ready") return;
      selectedWindow = null;
      if (data.ok !== true) {
        setPending(null);
        setError(typeof data.error === "string" ? data.error : "接続できませんでした。");
        return;
      }
      setAdded(true);
      setPending(null);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [invite]);

  const select = (site: SelectableSite) => {
    if (pending) return;
    if (!invite) {
      setError("有効なサイト追加リンクから開いてください。");
      return;
    }
    const permission = allowEdit && site.accessRole !== "viewer" ? "1" : "0";
    const url = sitePath(site.id) +
      "#mcp-join=" + encodeURIComponent(invite) + "&edit=" + permission;
    selectedWindow = window.open(url, "_blank");
    if (!selectedWindow) {
      setError("ポップアップを許可してから、もう一度お試しください。");
      return;
    }
    setPending(site.id);
    setError("");
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f6f8fb", color: "#202630", padding: "48px 18px",
      fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <section style={{ maxWidth: 610, margin: "0 auto", background: "white", padding: 32,
        border: "1px solid #e3e8ef", borderRadius: 16 }}>
        <h1 style={{ fontSize: 22, marginTop: 0 }}>AIに接続するサイトを選択</h1>
        <p style={{ color: "#5d6775", fontSize: 14 }}>
          AIアプリに追加で許可するサイトを選択してください。
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 0" }}>
          <input type="checkbox" checked={allowEdit} onChange={event => setAllowEdit(event.target.checked)} />
          編集を許可する（公開・アセット削除は不可）
        </label>
        {loading ? <p role="status">サイトを読み込んでいます…</p> :
          sites.length === 0 ? <p>接続できるサイトがありません。</p> :
            <div style={{ display: "grid", gap: 10 }}>
              {sites.map(site => (
                <button key={site.id} type="button" onClick={() => select(site)}
                  disabled={!!pending || added}
                  style={{ textAlign: "left", background: "white", padding: 16,
                    border: "1px solid #dce4ef", borderRadius: 10, cursor: "pointer" }}>
                  <strong>{site.name}</strong>
                  <span style={{ display: "block", fontSize: 12, color: "#5d6775" }}>
                    {pending === site.id ? "接続しています…" :
                      site.accessRole === "viewer" ? "閲覧のみ" : allowEdit ? "読み取り・編集" : "読み取り専用"}
                  </span>
                </button>
              ))}
            </div>}
        {error && <p role="alert" style={{ color: "#af2533" }}>{error}</p>}
        {added && <p role="status">サイトへのアクセスを追加しました。AIアプリに戻ってください。</p>}
      </section>
    </main>
  );
}

let selectedWindow: Window | null = null;
