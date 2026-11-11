import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

function fixture() {
  const path = resolve("components/AllowedAccounts.tsx"), require = createRequire(path);
  const cells: any[] = [], cleanups: any[] = [], calls: any[] = [], confirmations: any[] = [];
  let cursor = 0;
  const react = {
    useState(initial: any) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], (v: any) => { cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
    useRef(initial: any) { const i = cursor++; return cells[i] ??= { current: initial }; },
    useEffect(effect: any) { const i = cursor++; if (!(i in cells)) { cells[i] = true; cleanups.push(effect()); } },
  };
  const users = { me: "me@example.com", fixed: [], extra: ["other@example.com"] };
  const fetch = (url: string, init?: any) => {
    if (!init) return Promise.resolve({ ok: true, json: async () => users });
    return new Promise(resolve => calls.push({ url, init, resolve: () => resolve({ ok: true, json: async () => users }) }));
  };
  const mod = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", "fetch", code)((id: string) => id === "react" ? react :
    id === "../lib/dialog" ? { showConfirm: () => new Promise(resolve => confirmations.push(resolve)) } :
    id === "../lib/i18n" ? { tr: (v: string) => v } : require(id), mod, mod.exports, fetch);
  const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
  const render = () => { cursor = 0; const items = flatten(mod.exports.default()); return {
    input: items.find(e => e.type === "input"), add: items.find(e => e.type === "button" && e.props.children === "Add"),
    remove: items.find(e => e.type === "button" && e.props["aria-label"] === "Remove sign-in access"),
  }; };
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { calls, confirmations, render, settle, unmount: () => cleanups.forEach(fn => fn?.()) };
}
test("dismissed account settings cannot revoke a login after its confirmation resolves", async () => {
  const f = fixture(); f.render(); await f.settle();
  f.render().remove.props.onClick(); f.unmount(); f.confirmations[0](true); await f.settle();
  assert.equal(f.calls.length, 0);
});
test("pending revocation owns the operation before its confirmation, including stale callbacks", async () => {
  const f = fixture(); f.render(); await f.settle();
  const row = f.render().remove; row.props.onClick(); row.props.onClick();
  assert.equal(f.confirmations.length, 1);
  f.confirmations[0](false); await f.settle();
  assert.equal(f.render().remove.props.disabled, false);
});
test("account additions preserve text typed while the preceding request is pending", async () => {
  const f = fixture(); f.render(); await f.settle();
  f.render().input.props.onChange({ target: { value: "first@example.com" } });
  const add = f.render().add; add.props.onClick(); add.props.onClick();
  assert.equal(f.calls.length, 1);
  f.render().input.props.onChange({ target: { value: "next@example.com" } });
  f.calls[0].resolve(); await f.settle();
  assert.equal(f.render().input.props.value, "next@example.com");
  assert.equal(f.render().add.props.disabled, false);
});
