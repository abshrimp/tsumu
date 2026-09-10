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
      <h1>{tr("Something went wrong")}</h1>
      <p>{tr("Your work has been saved. Try again, or reload the page.")}</p>
      <div className="safe-fallback-actions">
        <button className="btn" onClick={reset}>
          {tr("Try again")}
        </button>
        <button className="btn" onClick={() => location.reload()}>
          {tr("Reload")}
        </button>
      </div>
    </div>
  );
}
