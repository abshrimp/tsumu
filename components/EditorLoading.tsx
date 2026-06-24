"use client";

import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";
import { glyphs } from "./Glyph";
import { loadLocale, tr } from "../lib/i18n";

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
export default function EditorLoading() {
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

