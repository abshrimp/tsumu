"use client";

import { useEffect } from "react";
import { tr } from "../lib/i18n";

/** レイアウトごと表示できないときの画面（globals.css も読めないため、最低限のスタイルで表示する） */
export default function GlobalError({ error }: { error: Error }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#18181b",
          background: "#fafafa",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{tr("Something went wrong")}</h1>
          <p style={{ fontSize: 14, color: "#52525b", margin: "0 0 16px" }}>
            {tr("Your work has been saved. Reload the page.")}
          </p>
          <button
            onClick={() => location.reload()}
            style={{
              padding: "8px 16px",
              border: "1px solid #d4d4d8",
              borderRadius: 8,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            {tr("Reload")}
          </button>
        </div>
      </body>
    </html>
  );
}
