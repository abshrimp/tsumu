import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

/** 実際のダイアログ・ストア・コピーの処理を、合成したデータだけで動かす。 */
export async function copySiteStorageBundle(doc?: SiteDoc) {
  return (await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { loadLocale } from "./lib/i18n";
      import { useEditor } from "./lib/store";
      void loadLocale().then(async () => {
        const { default: CopyToSite } = await import("./components/CopyToSite");
        ${doc ? `useEditor.getState().replaceDoc(${JSON.stringify(doc)});` : ""}
      const root = createRoot(document.getElementById("app"));
      window.closeCopy = () => root.unmount();
      root.render(<CopyToSite pageIds={useEditor.getState().doc.pageOrder} onClose={window.closeCopy} />);
      });
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
