import assert from "node:assert/strict";
import { test } from "node:test";
import { renderLeafNode } from "../components/canvas/render";
import { EXPORT_FRAMEWORK_OPTIONS, generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { DocNode, SiteDoc } from "../lib/types";

function submit(disabled?: boolean): DocNode {
  return { ...makeBox(), id: "send", attrId: "send", type: "field",
    field: { kind: "submit", label: "Send", disabled } };
}
function document(disabled?: boolean): SiteDoc {
  return { schemaVersion: 1, siteName: "Submit", assets: {}, nodes: { send: submit(disabled) },
    pageOrder: ["home"], pages: { home: { id: "home", name: "Home", slug: "", title: "Home",
      description: "", children: ["send"] } } };
}

for (const disabled of [true, false, undefined]) {
  for (const interactive of [true, false]) {
    test(`canvas submit disabled=${disabled} interactive=${interactive}`, () => {
      const button = renderLeafNode(submit(disabled), {}, { interactive }) as any;
      assert.equal(button.type, "button");
      assert.equal(button.props.disabled, disabled || undefined);
    });
  }
  for (const { value: framework } of EXPORT_FRAMEWORK_OPTIONS) {
    test(`${framework} preserves submit disabled=${disabled}`, () => {
      const { files } = generateExportProject(document(disabled), framework);
      const buttons = Object.values(files).flatMap((source) => [...source.matchAll(/<button\b[^>]*>/g)])
        .map((match) => match[0]).filter((tag) => /\bid=(?:"send"|\{"send"\})/.test(tag));
      assert.ok(buttons.length, "export includes the send button");
      for (const button of buttons) assert.equal(/\sdisabled(?:\s|=|>)/.test(button), disabled === true, button);
    });
  }
}

test("enabled submit keeps existing click and repeated refresh callbacks in order", () => {
  const calls: string[] = [];
  const button = renderLeafNode(submit(false), { onClick: () => calls.push("common") },
    { interactive: true, onSubmit: () => calls.push("refresh") }) as any;
  button.props.onClick({});
  button.props.onClick({});
  assert.deepEqual(calls, ["common", "refresh", "common", "refresh"]);
});
