"use client";

import { type ComponentType, useEffect, useState } from "react";
import BrandMark from "../../../components/BrandMark";
import { glyphs } from "../../../components/Glyph";
import { loadLocale, tr } from "../../../lib/i18n";
import { currentSiteId, loadLocalSites } from "../../../lib/site";

/**
 * 読み込み中に出すヒント。知っていると手早くなる操作を中心に、エディタの考え方を少し混ぜる。
 * 一目で読めるよう1文に収め、キーは Mac の記号で書く（Mac 以外では glyphs が Ctrl などに直す）
 */
const tips = () => [
  tr("⌘ を押しながらクリックすると、いちばん奥の要素を直接選べます。"),
  tr("⇧Enter で、選んでいる要素の親を選べます。"),
  tr("⌘D で、選んでいる要素をまとめて複製できます。"),
  tr("⌘[ と ⌘] で、左右のパネルを開け閉めできます。"),
  tr("並べ方は、並べたい要素ではなく、それを囲む親のボックスで決めます。"),
  tr("幅を % で決めて「最大幅」を付けると、どの画面でも崩れにくくなります。"),
  tr("スマホ表示で変えた設定は、スマホにだけ効きます。"),
  tr("色の付いた項目名を右クリックすると、その画面幅での変更を取り消せます。"),
  tr("どのページにも置くヘッダーは、右クリックから「コンポーネント化」すると1か所の修正で済みます。"),
  tr("公開した版は、公開履歴からいつでも戻せます。"),
  tr("? キーでヘルプを開くと、やりたいことから操作を探せます。"),
];

/** エディタ本体を読み込んでいる間の画面（エディタと同じ配置の骨組みを出す） */
function EditorLoading() {
  // 文言は言語の辞書を読み込んでから出す（サーバーとブラウザで食い違わないよう、表示後に選ぶ）。
  // コツは表示のたびに違うものを出す
  const [tip, setTip] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadLocale().then(() => {
      const list = tips();
      if (alive) setTip(list[Math.floor(Math.random() * list.length)]);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot-skel" aria-hidden>
        <div className="boot-hdr">
          <span className="is-page" />
          <span className="is-mid" />
          <span className="is-btn" />
        </div>
        <div className="boot-main">
          <div className="boot-panel">
            {Array.from({ length: 9 }, (_, i) => (
              <b key={i} style={{ width: `${[60, 72, 48, 66, 54, 70, 44, 62, 50][i]}%` }} />
            ))}
          </div>
          <div className="boot-canvas">
            <div className="boot-page">
              <b className="is-nav" />
              <b className="is-title" />
              <b className="is-text" />
              <div className="boot-cards">
                <b />
                <b />
                <b />
              </div>
            </div>
          </div>
          <div className="boot-panel is-right">
            {Array.from({ length: 6 }, (_, i) => (
              <b key={i} className={i % 2 ? "is-field" : "is-label"} />
            ))}
          </div>
        </div>
      </div>
      <div className="boot-card">
        <BrandMark size={40} />
        <strong>{tip !== null && tr("エディタを準備しています")}</strong>
        <div className="boot-bar">
          <span />
        </div>
        <p className="boot-tip">
          {tip !== null && (
            <>
              <span>{tr("ヒント")}</span>
              {glyphs(tip)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

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
  | { kind: "ok"; Editor: ComponentType }
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
  if (state.kind === "checking") return <EditorLoading />;
  if (state.kind === "missing") return <SiteNotFound />;
  if (state.kind === "failed") throw state.error;
  return <state.Editor />;
}
