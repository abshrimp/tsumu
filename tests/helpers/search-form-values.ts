import { build } from "esbuild";
import { SEARCH_FORM_COMPONENT } from "../../lib/generator/templates";
import { REACT_SEARCH_FORM } from "../../lib/generator/react-form";

export const searchFormValuesHtml = `
  <input id="q" name="q" value="seed">
  <textarea id="note" name="note">initial note</textarea>
  <input id="tag-a" type="checkbox" name="tag" value="a" checked>
  <input id="tag-b" type="checkbox" name="tag" value="b">
  <input id="tag-on" type="checkbox" name="tag">
  <input id="size-s" type="radio" name="size" value="S">
  <input id="size-m" type="radio" name="size" value="M" checked>
  <select id="color" name="color" multiple>
    <option value="red" selected>Red</option><option value="green">Green</option><option value="blue">Blue</option>
  </select>
  <select id="sort" name="sort"><option value="">Any</option><option value="B" selected>B</option></select>
  <input id="disabled" name="disabled" value="excluded" disabled>
  <fieldset disabled><input name="fieldset-disabled" value="excluded"></fieldset>
  <input id="upload" type="file" name="upload">
  <input value="unnamed">
  <button id="submit" type="submit">Search</button>`;

/** 生成したフォームだけを実際の React と DOM に載せ、外部への通信は行わない。 */
export async function searchFormValuesBundle(format: "nextjs" | "react") {
  const result = await build({
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: {
      contents: `
import { createRoot } from "react-dom/client";
import SearchForm from "fixture-form";
createRoot(document.getElementById("app")).render(
  <SearchForm id="search-form"><div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(searchFormValuesHtml)} }} /></SearchForm>
);
`, loader: "tsx", resolveDir: process.cwd(),
    },
    plugins: [{ name: "generated-search-form", setup(builder) {
      builder.onResolve({ filter: /^(fixture-form|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        loader: "tsx", resolveDir: process.cwd(), contents: args.path === "fixture-form"
          ? format === "nextjs" ? SEARCH_FORM_COMPONENT : REACT_SEARCH_FORM
          : `
import { useSyncExternalStore } from "react";
const subscribe = (callback) => { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); };
export const usePathname = () => window.location.pathname;
export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search));
export const useRouter = () => ({ replace(url) { window.history.replaceState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); } });
`,
      }));
    } }],
  });
  return result.outputFiles[0].text;
}
