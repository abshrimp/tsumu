import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { showAlert, showConfirm, showPrompt, useDialogs } from "../lib/dialog";
import * as dialogs from "../lib/dialog";

// Run the production component/effects and real dialog queue. Only React's
// renderer and DOM focus/default Tab traversal are modeled here; the matching
// Playwright suite verifies native focus, propagation and accessible names.
function mount() {
  useDialogs.setState({ queue: [] });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { activeElement: null as Target | null });
  class Target {
    isConnected = true;
    disabled = false;
    selected = false;
    constructor(readonly name: string) {}
    focus() { if (this.isConnected && !this.disabled) doc.activeElement = this; }
    select() { this.selected = true; }
  }
  const opener = new Target("opener"), background = new Target("background");
  opener.focus();
  let cursor = 0;
  let cells: any[] = [];
  let effects: (() => void)[] = [];
  let nodes: any[] = [];
  let currentId: number | undefined;
  const targets = new Map<string, Target>();
  const hooks = {
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = initial;
      return [cells[i], (value: unknown) => { cells[i] = value; }];
    },
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useEffect(run: () => void | (() => void), deps: unknown[]) {
      const i = cursor++;
      if (!cells[i] || deps.some((dep, j) => !Object.is(dep, cells[i].deps[j]))) {
        effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: run() }; });
      }
    },
  };
  const path = resolve("components/DialogHost.tsx");
  const require = createRequire(path);
  const module = { exports: {} as any };
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", "window", "document", "HTMLElement", code)(
    (id: string) => id === "react" ? hooks : id === "react-dom" ? { createPortal: (child: any) => child } :
      id === "../lib/dialog" ? { ...dialogs, useDialogs: (select: any) => select(useDialogs.getState()) } : require(id),
    module, module.exports, win, doc, Target,
  );
  const flatten = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
  function unmount() {
    for (const target of targets.values()) target.isConnected = false;
    if ([...targets.values()].includes(doc.activeElement!)) doc.activeElement = null;
    for (const cell of cells) cell?.cleanup?.();
    cells = []; targets.clear(); nodes = []; currentId = undefined;
  }
  function render() {
    const req = useDialogs.getState().queue[0];
    if (req?.id !== currentId) unmount();
    if (!req) return;
    currentId = req.id; cursor = 0; effects = [];
    const child = module.exports.default();
    nodes = flatten(child.type(child.props));
    for (const node of nodes.filter(node => node.type === "input" || node.type === "button")) {
      const name = node.type === "input" ? "input" : node.props.className.includes("btn-primary") ? "ok" : "cancel";
      const target = targets.get(name) ?? new Target(name);
      target.disabled = !!node.props.disabled;
      targets.set(name, target);
      if (node.props.ref) node.props.ref.current = target;
    }
    for (const effect of effects) effect();
  }
  function key(key: string, init: { shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {}) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ...init });
    win.dispatchEvent(event);
    // Native Tab leaves a portal for the background unless its default is prevented.
    if (key === "Tab" && !event.defaultPrevented) {
      const order = [opener, background, ...targets.values()].filter(target => target.isConnected && !target.disabled);
      const i = order.indexOf(doc.activeElement!);
      order[(i + (init.shiftKey ? -1 : 1) + order.length) % order.length]?.focus();
    }
    return event;
  }
  return {
    opener, background, render, unmount, key,
    focused: () => doc.activeElement?.name,
    focus: (name: string) => targets.get(name)!.focus(),
    input: (value: string) => { nodes.find(n => n.type === "input").props.onChange({ target: { value } }); render(); },
    click: (name: "ok" | "cancel") => {
      const node = nodes.find(n => n.type === "button" && (name === "ok" ? n.props.className.includes("btn-primary") : !n.props.className.includes("btn-primary")));
      assert.ok(!node.props.disabled); node.props.onClick(); render();
    },
    nodes: () => nodes,
    strictReplay() {
      const mountedEffects = cells.filter(cell => cell?.deps);
      for (const cell of mountedEffects) cell.cleanup?.();
      cells = cells.map(cell => cell?.deps ? undefined : cell);
      render();
    },
  };
}

for (const kind of ["alert", "confirm", "danger", "prompt"] as const) {
  test(`${kind}: Tab and Shift+Tab stay inside the modal`, () => {
    const f = mount();
    try {
      if (kind === "alert") void showAlert("Notice");
      else if (kind === "prompt") void showPrompt("Type a name");
      else void showConfirm("Continue?", { danger: kind === "danger" });
      f.render();
      assert.equal(f.focused(), kind === "prompt" ? "input" : kind === "danger" ? "cancel" : "ok");
      f.focus("ok"); f.key("Tab");
      assert.equal(f.focused(), kind === "prompt" ? "input" : kind === "alert" ? "ok" : "cancel");
      f.key("Tab", { shiftKey: true }); assert.equal(f.focused(), "ok");
      f.background.focus(); f.key("Tab");
      assert.notEqual(f.focused(), "opener"); assert.notEqual(f.focused(), "background");
    } finally { f.unmount(); }
  });
}

test("prompt Tab order follows whether the expected text enables OK", () => {
  const f = mount();
  try {
    void showPrompt("Type DELETE", { expect: "DELETE" }); f.render();
    f.key("Tab"); assert.equal(f.focused(), "cancel");
    f.key("Tab"); assert.equal(f.focused(), "input");
    f.key("Tab", { shiftKey: true }); assert.equal(f.focused(), "cancel");
    f.input("DELETE"); f.key("Tab"); assert.equal(f.focused(), "ok");
    f.key("Tab"); assert.equal(f.focused(), "input");
    f.input("unfinished"); f.key("Tab", { shiftKey: true }); assert.equal(f.focused(), "cancel");
  } finally { f.unmount(); }
});

for (const close of ["ok", "cancel", "Escape"] as const) test(`${close} restores the trigger and resolves the same result`, async () => {
  const f = mount();
  try {
    const result = showConfirm("Continue?"); f.render();
    if (close === "Escape") { f.key(close); f.render(); } else f.click(close);
    assert.equal(await result, close === "ok");
    assert.equal(f.focused(), "opener");
  } finally { f.unmount(); }
});

test("queued dialogs retain the original trigger, including Strict Mode effect replay", async () => {
  const f = mount();
  try {
    const first = showConfirm("First?"); const second = showAlert("Second");
    f.render(); f.strictReplay(); assert.equal(f.focused(), "ok");
    f.click("cancel"); assert.equal(await first, false); assert.equal(f.focused(), "ok");
    f.key("Tab"); assert.equal(f.focused(), "ok");
    f.click("ok"); await second; assert.equal(f.focused(), "opener");
  } finally { f.unmount(); }
});

test("unmount does not focus a removed trigger", () => {
  const f = mount(); void showAlert("Notice"); f.render();
  f.opener.isConnected = false;
  f.unmount(); assert.notEqual(f.focused(), "opener");
});

test("IME Escape is not cancellation and prompt text is preserved", async () => {
  const f = mount();
  try {
    const result = showPrompt("Name"); f.render(); f.input("日本語");
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(f.key("Escape", init).defaultPrevented, false);
      assert.equal(useDialogs.getState().queue.length, 1); assert.equal(f.focused(), "input");
    }
    f.click("ok"); assert.equal(await result, "日本語");
  } finally { f.unmount(); }
});

test("prompt input has a persistent name and instructions even without a placeholder", () => {
  const f = mount();
  try {
    void showPrompt("Enter the site name", { title: "Rename site" }); f.render();
    const input = f.nodes().find(n => n.type === "input");
    for (const [attribute, text] of [["aria-labelledby", "Rename site"], ["aria-describedby", "Enter the site name"]]) {
      const id = input.props[attribute]; assert.ok(id, attribute);
      assert.equal(f.nodes().find(n => n.props.id === id)?.props.children, text);
    }
  } finally { f.unmount(); }
});
