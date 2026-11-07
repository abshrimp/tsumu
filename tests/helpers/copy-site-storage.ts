import { build } from "./bundle";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

let compiledCopyBundle: Promise<string> | undefined;

/** 実際のダイアログ・ストア・コピーの処理を、合成したデータだけで動かす。 */
export async function copySiteStorageBundle(doc?: SiteDoc) {
  compiledCopyBundle ??= build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { loadLocale } from "./lib/i18n";
      import { useEditor } from "./lib/store";
      void loadLocale().then(async () => {
        const { default: CopyToSite } = await import("./components/CopyToSite");
        if (window.__copySourceDoc) useEditor.getState().replaceDoc(window.__copySourceDoc);
        const root = createRoot(document.getElementById("app"));
        window.closeCopy = () => root.unmount();
        root.render(<CopyToSite pageIds={useEditor.getState().doc.pageOrder} onClose={window.closeCopy} />);
      });
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"development"' },
  }).then(result => result.outputFiles[0].text);
  return (doc ? `window.__copySourceDoc = ${JSON.stringify(doc)};\n` : "window.__copySourceDoc = undefined;\n") + await compiledCopyBundle;
}
