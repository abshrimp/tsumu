import { generateProject } from "../../lib/generator";
import { makeBox } from "../../lib/presets";
import type { DocNode, FieldContent, SiteDoc } from "../../lib/types";

export const firstSearch = "?tab=products&q=first&note=one&stock=true&size=S&sort=C";
export const nextSearch = "?tab=products&q=next&note=two&size=M&sort=A";
export const defaultSearch = "?tab=products&seed=changed";

/** 公開用の実際のファイルを使う。取得先はfixture内の関数で置き換え、外部へ通信しない。 */
export function searchFormFiles() {
  const field = (id: string, content: FieldContent): DocNode => ({
    ...makeBox(), id, attrId: id, type: "field", field: content,
  });
  const fields = [
    field("q", { kind: "input", inputType: "search", defaultValue: "{seed}" }),
    field("note", { kind: "textarea", defaultValue: "{seed} note" }),
    field("stock", { kind: "checkbox", label: "In stock", checked: true }),
    field("small", { kind: "radio", label: "S", group: "size" }),
    field("medium", { kind: "radio", label: "M", group: "size", checked: true }),
    field("sort", { kind: "select", options: ["A", "B", "C"], defaultValue: "B" }),
    field("upload", { kind: "file" }),
    field("submit", { kind: "submit", label: "Search" }),
  ];
  const form: DocNode = { ...makeBox(), id: "form", attrId: "search-form", semantic: "form", children: fields.map((n) => n.id) };
  const link = (id: string, href: string): DocNode => ({
    ...makeBox(), id, attrId: id, text: { content: id, heading: 0 }, link: { kind: "url", url: href },
  });
  const links = [link("first-link", `/search${firstSearch}`), link("next-link", `/search${nextSearch}`), link("defaults-link", `/search${defaultSearch}`)];
  const result: DocNode = { ...makeBox(), id: "result", attrId: "result", text: { content: "API: {response.q}", heading: 0 } };
  const revision: DocNode = { ...makeBox(), id: "revision", attrId: "render-revision", text: { content: "{response.revision}", heading: 0 } };
  const staticInput = field("static-input", { kind: "input", defaultValue: "Static form" });
  const staticForm: DocNode = { ...makeBox(), id: "static-form", attrId: "static-form", semantic: "form", children: [staticInput.id] };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Search navigation fixture", assets: {}, pageOrder: ["static", "search"],
    pages: {
      static: { id: "static", name: "Static", slug: "", title: "Static", description: "", children: [staticForm.id, ...links.map((n) => n.id)] },
      search: { id: "search", name: "Search", slug: "search", title: "Search", description: "", children: [form.id, result.id, revision.id, ...links.map((n) => n.id)], pageScripts: [{
        id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
          { id: "fetch", kind: "fetch", url: "https://example.com/search?q={q}", as: "response" },
        ],
      }] },
    },
    nodes: Object.fromEntries([...fields, form, ...links, result, revision, staticInput, staticForm].map((n) => [n.id, n])),
  };
  const { files } = generateProject(doc);
  files["lib/safe-fetch.ts"] = `
let revision = 0;
export async function fetchPublic(url: string, _init?: unknown) {
  return new Response(JSON.stringify({ q: new URL(url).searchParams.get("q"), revision: String(++revision) }));
}
export async function readTextLimited(response: Response, _limit?: number) { return response.text(); }
`;
  return files;
}
