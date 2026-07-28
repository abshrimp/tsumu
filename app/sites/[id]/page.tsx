"use client";

import { type ComponentType, useCallback, useEffect, useState } from "react";
import BrandMark from "../../../components/BrandMark";
import type { EditorProps } from "../../../components/Editor";
import EditorLoading from "../../../components/EditorLoading";
import { loadLocale, tr } from "../../../lib/i18n";
import { currentSiteId, loadLocalSites } from "../../../lib/site";

// 文言を作る前に言語の辞書を読み込む（モジュールの読み込み時に訳す文言があるため）
const loadEditor = () => loadLocale().then(() => import("../../../components/Editor"));

/** サイトが見つからないとき（消されたサイト・URLの打ち間違い） */
function SiteNotFound() {
  return (
    <div className="boot">
      <div className="boot-card">
        <BrandMark size={40} />
        <strong>{tr("サイトが見つかりません")}</strong>
        <p className="boot-tip">{tr("削除されたか、URLが間違っている可能性があります。")}</p>
        <a className="btn btn-primary" href="/">
          {tr("サイト一覧へ")}
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
 * 開く前に、サイトがあるか確かめる（無いサイトの編集データを作らないように）。
 * サーバーに一覧が無い（D1 が無い）ときはブラウザ内の一覧を見る。通信の失敗では止めない。
 * エディタ本体は確認と並行して読み込み、両方そろってから開く（読み込み画面を1回で済ませるため）
 */
function useSiteCheck(): SiteState {
  const [state, setState] = useState<SiteState>({ kind: "checking" });
  useEffect(() => {
    let alive = true;
    const id = currentSiteId();
    const editor = loadEditor();
    // サイトが無くて待たなかったときの失敗は捨てる（待つときは下で受け取る）
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
        // 通信できなくても、手元の保存で編集を続けられるようにする
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
        // 読み込めなかったら（デプロイ直後の古いチャンクなど）エラー画面に任せる
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
  // サイト確認・本体の読み込み・最初の文書取得を通して、ヒントと登場アニメーションを保つ。
  return (
    <>
      {!ready && <EditorLoading />}
      {state.kind === "ok" && <state.Editor onReady={onReady} />}
    </>
  );
}
