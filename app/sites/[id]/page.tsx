"use client";

import { type ComponentType, useCallback, useEffect, useState } from "react";
import BrandMark from "../../../components/BrandMark";
import type { EditorProps } from "../../../components/Editor";
import EditorLoading from "../../../components/EditorLoading";
import { loadLocale, tr } from "../../../lib/i18n";
import { currentSiteId, loadLocalSites } from "../../../lib/site";

// 文言を作る前に言語の辞書を読み込む（モジュールを読み込む時点で訳す文言があるため）
const loadEditor = () => loadLocale().then(() => import("../../../components/Editor"));

/** サイトが見つからないときの画面（削除されたサイトや、URL の打ち間違い） */
function SiteNotFound() {
  return (
    <div className="boot">
      <div className="boot-card">
        <BrandMark size={40} />
        <strong>{tr("Site not found")}</strong>
        <p className="boot-tip">{tr("It may have been deleted, or the URL may be wrong.")}</p>
        <a className="btn btn-primary" href="/">
          {tr("Go to sites")}
        </a>
      </div>
    </div>
  );
}

type SiteState =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "ok"; Editor: ComponentType<EditorProps> }
  | { kind: "failed"; error: unknown };

/**
 * 開く前に、サイトがあるかを確かめる（存在しないサイトの編集データを作らないため）。
 * サーバーに一覧が無い（D1 が無い）ときは、ブラウザ内の一覧を見る。通信に失敗しても止めない。
 * エディタの本体は確認と並行して読み込み、両方が揃ってから開く（読み込み画面を1回で済ませるため）
 */
function useSiteCheck(): SiteState {
  const [state, setState] = useState<SiteState>({ kind: "checking" });
  useEffect(() => {
    let alive = true;
    const id = currentSiteId();
    const editor = loadEditor();
    // サイトが無く、本体の読み込みを待たなかった場合の失敗は捨てる（待つ場合は下で受け取る）
    editor.catch(() => {});
    void (async () => {
      let result: "ok" | "missing" = "ok";
      try {
        const res = await fetch(`/api/sites/${encodeURIComponent(id)}`);
        if (res.status === 404 || res.status === 400) result = "missing";
        else if (res.ok) {
          const data = await res.json();
          if (data.site?.name) document.title = `${data.site.name} | Tsumu`;
        } else if (res.status === 503) {
          const site = loadLocalSites().find((s) => s.id === id);
          if (site) document.title = `${site.name} | Tsumu`;
          else result = "missing";
        }
      } catch {
        // 通信できなくても、ブラウザ内の保存で編集を続けられるようにする
      }
      await loadLocale();
      if (result === "missing") {
        if (alive) setState({ kind: "missing" });
        return;
      }
      try {
        const { default: Editor } = await editor;
        if (alive) setState({ kind: "ok", Editor });
      } catch (error) {
        // 読み込めなかった場合（デプロイ直後の古いチャンクなど）は、エラー画面に任せる
        if (alive) setState({ kind: "failed", error });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export default function SitePage() {
  const state = useSiteCheck();
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  if (state.kind === "missing") return <SiteNotFound />;
  if (state.kind === "failed") throw state.error;
  // サイトの確認、本体の読み込み、最初の文書の取得のあいだ、ヒントと登場のアニメーションを保つ。
  return (
    <>
      {!ready && <EditorLoading />}
      {state.kind === "ok" && <state.Editor onReady={onReady} />}
    </>
  );
}
