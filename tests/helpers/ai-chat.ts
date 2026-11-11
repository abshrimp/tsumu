import { build, transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function aiChatDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "AI history", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "P", description: "", children: ["a"] },
      q: { id: "q", name: "Q", slug: "q", title: "Q", description: "", children: ["b"] },
    },
    nodes: { a: { ...makeText("Original A"), id: "a" }, b: { ...makeText("Original B"), id: "b" } },
  };
}

/** 非公開の送信入口だけを公開し、通信以外は実際のチャット・編集・履歴処理を使う。 */
export function aiChatFixture() {
  const source = readFileSync("components/AiChat.tsx", "utf8") + "\nexport { ask as askForTest }; export const cancelForTest = () => pendingRequest?.abort();";
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)(createRequire(resolve("components/AiChat.tsx")), module, module.exports);
  return module.exports;
}

export async function aiChatBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";


import { useEditor } from "./lib/store";
import { makeText } from "./lib/presets";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: AiChat, useAi } = await import("./components/AiChat");
  const { NumField } = await import("./components/controls");
const doc = ${JSON.stringify(aiChatDoc())};
useEditor.getState().replaceDoc(doc);
useEditor.getState().setActivePage("p");
useAi.setState({ open: true });
window.aiHistoryEditor = useEditor;
window.aiHistoryChat = useAi;
window.fetch = () => new Promise((resolve) => { window.finishAiHistory = (operations) => resolve(new Response(
  JSON.stringify({ type: "result", result: { reply: "Done", operations } }) + "\\n",
  { headers: { "content-type": "application/x-ndjson" } }
)); });
function Fixture() {
  const value = useEditor((s) => s.doc.nodes.b.styles.base?.default?.fontSize);
  return <><AiChat /><NumField pre="Q size" value={value ?? "20px"}
    onChange={(value) => useEditor.getState().setStyleProps("b", { fontSize: value })} /></>;
}
createRoot(document.getElementById("app")).render(<Fixture />);

});
`, loader: "tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
