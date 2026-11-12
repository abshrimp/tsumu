import type { DefaultTreeAdapterTypes as Html } from "parse5";
import type { GeneratedProject } from "../generator";
import type { ExportFormat } from "../export-formats";

/**
 * TypeScript から JavaScript への変換は、正規表現で取り除くのではなく、実際の構文の変換で行う。
 * コンパイラは、書き出しの画面で JavaScript を選んだときだけ読み込む。
 */
export async function toJavaScriptProject(
  project: GeneratedProject,
  framework: ExportFormat,
): Promise<GeneratedProject> {
  const { default: ts } = await import("@typescript/typescript6");
  const files: Record<string, string> = {};
  for (const [path, source] of Object.entries(project.files)) {
    if (!/\.(?:tsx?|mts|cts)$/.test(path)) {
      files[path] = source;
      continue;
    }
    const jsx = /\.tsx$/.test(path);
    const result = ts.transpileModule(source, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        isolatedModules: true,
        removeComments: false,
      },
    });
    const failures = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (failures.length) {
      throw new Error("JavaScript export failed for " + path + ": " +
        failures.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; "));
    }
    const ext = jsx ? ".jsx" : ".js";
    const outPath = path.replace(/\.(?:tsx?|mts|cts)$/, ext);
    files[outPath] = result.outputText;
  }

  // 元のフレームワークのツールは残し、ソースの言語の設定だけを置き換える。
  if (files["tsconfig.json"]) {
    const tsconfig = JSON.parse(files["tsconfig.json"]) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = tsconfig.compilerOptions?.paths;
    files["jsconfig.json"] = JSON.stringify({
      compilerOptions: {
        ...(paths ? { baseUrl: ".", paths } : {}),
        checkJs: false,
      },
      exclude: ["node_modules", ".next", "dist", "out"],
    }, null, 2) + "\n";
    delete files["tsconfig.json"];
  }
  const pkg = JSON.parse(files["package.json"]) as {
    scripts: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (framework === "react") {
    // Vite はこの入口を index.html から読む。main.tsx を main.jsx に変換して
    // 入口を書き換えなければ、ビルドできない ZIP になってしまう。
    if (files["index.html"]) {
      const { parse } = await import("parse5");
      const html = files["index.html"];
      const document = parse(html, { sourceCodeLocationInfo: true });
      const entries: { startOffset: number; endOffset: number; src: string }[] = [];
      const pending: Html.Node[] = [document];
      while (pending.length) {
        const node = pending.pop()!;
        if ("tagName" in node && node.tagName === "script" &&
          node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
          node.attrs.some(attr => attr.name === "type" && attr.value === "module") &&
          !node.attrs.some(attr => attr.name === "vite-ignore")) {
          const src = node.attrs.find(attr => attr.name === "src")?.value;
          const location = node.sourceCodeLocation?.attrs?.src;
          // 実行される参照は、すべて名前を変えたファイルに合わせる。コメント、
          // スクリプトの本文、動作しないテンプレートの中身は、決して書き換えない。
          // Vite のローカルの入力は index.html を基準に解決され、base 要素の影響を受けない。
          // パスの書き方とクエリ・フラグメントは保ち、外部の URL には手を付けない。
          // vite-ignore の参照は Vite の入力ではないため、ブラウザーには元の URL を渡す。
          if (location && src && /^(?:\/|\.\/)?src\/main\.tsx(?:[?#]|$)/.test(src)) {
            entries.push({ ...location, src: src.replace(/\.tsx(?=[?#]|$)/, ".jsx") });
          }
        }
        if ("childNodes" in node) pending.push(...node.childNodes);
      }
      let rewritten = html;
      for (const entry of entries.sort((a, b) => b.startOffset - a.startOffset)) {
        // parse5 がデコードした属性の値を、二重引用符付きの HTML の属性として安全に戻す。
        const escaped = entry.src.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
        rewritten = rewritten.slice(0, entry.startOffset) +
          'src="' + escaped + '"' + rewritten.slice(entry.endOffset);
      }
      files["index.html"] = rewritten;
    }
    pkg.scripts.build = "vite build";
    delete pkg.devDependencies?.typescript;
    delete pkg.devDependencies?.["@types/react"];
    delete pkg.devDependencies?.["@types/react-dom"];
    delete pkg.devDependencies?.["@types/node"];
  }
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  files["README.md"] += "\nJavaScript source files (.js/.jsx) are provided instead of TypeScript (.ts/.tsx).\n";
  return { ...project, files };
}
