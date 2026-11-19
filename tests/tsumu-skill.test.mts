import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inflateRawSync, crc32 } from "node:zlib";
import { test } from "node:test";
import { validateImportedDoc } from "../lib/site-import-format";

const read = (relative: string) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");

test("the English AI Skill type reference matches the current SiteDoc model", () => {
  const snapshot = read("skills/tsumu/references/types.ts");
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
  const doc = JSON.parse(read("skills/tsumu/references/minimal-site.json"));
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
  const skill = read("skills/tsumu/SKILL.md");
  assert.match(skill, /^---\nname: tsumu\n/);
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
  assert.match(skill, /do \*\*not\*\* stop/);
  const openai = read("skills/tsumu/agents/openai.yaml");
  assert.match(openai, /display_name: "Create a Tsumu Site"/);
  assert.match(openai, /default_prompt:.*\$tsumu/);
  assert.match(openai, /allow_implicit_invocation: true/);
});

test("standalone Tsumu Skill contains a valid fallback SiteDoc without external references", () => {
  const skill = read("skills/tsumu/SKILL.md");
  const match = skill.match(/### Offline SiteDoc starter[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert.ok(match, "Inline offline SiteDoc must be present");
  const doc = JSON.parse(match[1]);
  assert.equal(validateImportedDoc(doc), doc);
  assert.ok(doc.pageOrder.length > 0);
  assert.ok(Object.keys(doc.nodes).length >= 6);
  assert.ok(Object.values(doc.nodes).some((node: any) => node.text?.heading === 1));
  assert.match(skill, /do \*\*not\*\* stop/);
});

test("Claude skill ZIP contains the tsumu directory and all references", () => {
  const directory = mkdtempSync(join(tmpdir(), "tsumu-skill-"));
  try {
    const destination = join(directory, "tsumu-skill.zip");
    execFileSync(process.execPath, ["scripts/package-tsumu-skill.mjs", destination], {
      cwd: new URL("../", import.meta.url),
    });
    const zip = readFileSync(destination);
    const members = new Map<string, string>();
    let offset = 0;
    while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
      assert.equal(zip.readUInt16LE(offset + 8), 8, "ZIP entry must use deflate");
      const compressedSize = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
      const start = offset + 30 + nameLength + extraLength;
      const raw = inflateRawSync(zip.subarray(start, start + compressedSize));
      assert.equal(raw.length, zip.readUInt32LE(offset + 22));
      assert.equal(crc32(raw), zip.readUInt32LE(offset + 14));
      assert.ok(!members.has(name), "Duplicate ZIP entry: " + name);
      members.set(name, raw.toString("utf8"));
      offset = start + compressedSize;
    }
    const expected = ["SKILL.md", "agents/openai.yaml", "references/minimal-site.json",
      "references/script-model/compose.ts", "references/site-doc.md", "references/types.ts"].map(p => "tsumu/" + p).sort();
    assert.deepEqual([...members.keys()].sort(), expected);
    for (const entry of expected) assert.equal(members.get(entry), read("skills/" + entry));
    assert.match(members.get("tsumu/SKILL.md")!, /^---\nname: tsumu\n/);
    assert.equal(validateImportedDoc(JSON.parse(members.get("tsumu/references/minimal-site.json")!)).schemaVersion, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
