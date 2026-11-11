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
  tr("⌘-click to select the innermost element directly."),
  tr("Press ⇧Enter to select the parent of the current element."),
  tr("Press ⌘D to duplicate everything you've selected."),
  tr("Press ⌘[ and ⌘] to show or hide the left and right panels."),
  tr("How items are arranged is set on the box around them, not on the items themselves."),
  tr("Set widths in % and add a Max width so layouts hold up on any screen."),
  tr("Changes made in the phone view apply to phones only."),
  tr("Right-click a highlighted property name to undo its change for this screen size."),
  tr("Turn a header used on every page into a component (right-click) so one edit updates them all."),
  tr("You can roll back to any published version from the publish history."),
  tr("Press ? to open Help and search by what you want to do."),
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
        <strong>{tip !== null && tr("Preparing the editor")}</strong>
        <div className="boot-bar">
          <span />
        </div>
        <p className="boot-tip">
          {tip !== null && (
            <>
              <span>{tr("Tip")}</span>
              {glyphs(tip)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

