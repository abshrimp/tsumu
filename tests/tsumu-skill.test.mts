import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateImportedDoc } from "../lib/site-import-format";

const read = (relative: string) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");

test("the English AI Skill type reference matches the current SiteDoc model", () => {
  const snapshot = read("skills/tsumu-site/references/types.ts");
  const current = read("lib/types.ts");
  // スナップショットとソースの違いは、コメントだけ。その性質を確かめるのに、Node.js のテストの
  // ワーカーでのコンパイラーのモジュールの相互運用に頼らない。
  const normalized = (source: string) => {
    let out = "";
    let i = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === "/" && source[i + 1] === "/") {
        const end = source.indexOf("\n", i + 2);
        i = end < 0 ? source.length : end;
      } else if (c === "/" && source[i + 1] === "*") {
        const end = source.indexOf("*/", i + 2);
        assert.notEqual(end, -1, "Unterminated TypeScript comment");
        i = end + 2;
      } else if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        out += c;
        i++;
        let closed = false;
        while (i < source.length) {
          const current = source[i++];
          out += current;
          if (current === "\\") {
            if (i < source.length) out += source[i++];
          } else if (current === quote) {
            closed = true;
            break;
          }
        }
        assert.ok(closed, "Unterminated TypeScript string");
      } else if (/\s/.test(c)) {
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  };
  assert.equal(normalized(snapshot), normalized(current),
    "Update the AI Skill TypeScript snapshot when lib/types.ts changes.");
  assert.doesNotMatch(snapshot, /[\u3040-\u30ff\u3400-\u9fff]/,
    "The AI Skill TypeScript documentation should be in English.");
});

test("the AI skill example imports as a valid editable site with resolved references", () => {
  const doc = JSON.parse(read("skills/tsumu-site/references/minimal-site.json"));
  assert.equal(validateImportedDoc(doc), doc);
  assert.ok(doc.pageOrder.length > 0);
  for (const id of doc.pageOrder) {
    const page = doc.pages[id];
    assert.equal(page.id, id);
    for (const child of page.children) assert.ok(doc.nodes[child], "Missing page child " + child);
  }
  for (const [id, node] of Object.entries(doc.nodes) as [string, { id: string; children: string[] }][]) {
    assert.equal(node.id, id);
    for (const child of node.children) assert.ok(doc.nodes[child], "Missing node child " + child);
  }
});

test("the Tsumu site skill declares when to activate and handles MCP import links safely", () => {
  const skill = read("skills/tsumu-site/SKILL.md");
  assert.match(skill, /^---\nname: tsumu-site\n/);
  assert.match(skill, /^description: Create a NEW editable website.*in Tsumu\./m);
  assert.match(skill, /^license: MIT$/m);
  assert.match(skill, /^compatibility: .*MCP.*offline/m);
  assert.match(skill, /metadata:\n  author: abshrimp/);
  assert.match(skill, /get_site_doc_spec/);
  assert.match(skill, /stage_site_doc/);
  assert.match(skill, /importUrl/);
  assert.match(skill, /one hour/);
  assert.match(skill, /Never invent an import link/);
  assert.match(skill, /No staging tool or no authorization/);
  const openai = read("skills/tsumu-site/agents/openai.yaml");
  assert.match(openai, /display_name: "Create a Tsumu Site"/);
  assert.match(openai, /default_prompt:.*\$tsumu-site/);
  assert.match(openai, /allow_implicit_invocation: true/);
});
