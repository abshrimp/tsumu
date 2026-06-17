"use client";

import { useEffect } from "react";
import { tr } from "../lib/i18n";

/** ページ内で起きた表示エラーの代わりに出す画面（エラーの中身は出さない） */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="safe-page">
      <h1>{tr("画面を表示できませんでした")}</h1>
      <p>{tr("編集中のデータは保存されています。もう一度表示するか、ページを再読み込みしてください。")}</p>
      <div className="safe-fallback-actions">
        <button className="btn" onClick={reset}>
          {tr("もう一度表示する")}
        </button>
        <button className="btn" onClick={() => location.reload()}>
          {tr("再読み込み")}
        </button>
      </div>
    </div>
  );
}
