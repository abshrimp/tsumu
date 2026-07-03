import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際のダイアログ・ストア・コピー処理を、合成データだけで動かす。 */
export async function copySiteStorageBundle() {
  return (await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import CopyToSite from "./components/CopyToSite";
      import { useEditor } from "./lib/store";
      const root = createRoot(document.getElementById("app"));
      window.closeCopy = () => root.unmount();
      root.render(<CopyToSite pageIds={useEditor.getState().doc.pageOrder} onClose={window.closeCopy} />);
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
