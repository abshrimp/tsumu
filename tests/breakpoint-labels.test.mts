import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { loadDicts, translate } from "../lib/i18n";

const prototypeNames = ["__proto__", "constructor", "toString", "hasOwnProperty"];

test("translation falls back to literal labels for inherited dictionary names", async () => {
  const dictionaries = await loadDicts("en");
  for (const label of prototypeNames) {
    assert.equal(translate("en", dictionaries, label), label);
    assert.equal(translate("en", dictionaries, label, {}), label);
  }
});

test("translation uses only own entries while retaining dictionary priority and interpolation", () => {
  const primary = Object.assign(Object.create({ inherited: "Not a translation" }), {
    greeting: "Hello {name}",
  });
  const fallback = JSON.parse('{"inherited":"Fallback","constructor":"Own translation"}');
  assert.equal(translate("en", [primary, fallback], "inherited"), "Fallback");
  assert.equal(translate("en", [primary, fallback], "constructor"), "Own translation");
  assert.equal(translate("en", [primary, { greeting: "Fallback" }], "greeting", { name: "Tsumu" }), "Hello Tsumu");
  assert.equal(translate("en", [primary], "Missing {name}", { name: "Tsumu" }), "Missing Tsumu");
});

for (const lang of ["ja", "en"]) {
  test(`${lang}: custom breakpoint labels remain renderable after editing and document reload`, () => {
    // Locale detection and translated constants run at module initialization.
    // Use a fresh process for each supported editor language, as a reload does.
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      globalThis.window = { localStorage: { getItem: () => ${JSON.stringify(lang)} } };
      const { loadLocale } = await import("./lib/i18n.ts");
      await loadLocale();
      const { applyBreakpoints, BP_INFO } = await import("./lib/style.ts");
      const { updateBreakpoint } = await import("./lib/breakpoints.ts");
      const { createInitialDoc } = await import("./lib/presets.ts");
      const { validSiteDoc } = await import("./lib/doc-tree.ts");
      const doc = createInitialDoc();
      for (const label of ${JSON.stringify([...prototypeNames, "Custom width"])}) {
        updateBreakpoint(doc, "md", { label });
        const restored = JSON.parse(JSON.stringify(doc));
        assert.equal(validSiteDoc(restored), true);
        applyBreakpoints(restored);
        assert.equal(BP_INFO.md.label, label);
        assert.equal(BP_INFO.md.short, label);
        assert.equal(renderToStaticMarkup(createElement("button", { title: BP_INFO.md.label }, BP_INFO.md.short)),
          '<button title="' + label + '">' + label + '</button>');
        assert.ok(BP_INFO.lg.scope.includes(label));
      }
      applyBreakpoints(undefined);
      assert.equal(BP_INFO.md.label, ${JSON.stringify(lang === "ja" ? "スマホ横向き" : "Phone (landscape)")});
      assert.equal(typeof BP_INFO.md.short, "string");
      assert.ok(BP_INFO.md.short.length > 0);
    `], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
