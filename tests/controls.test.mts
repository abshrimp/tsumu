import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { shorthandSide, parseColor, composeColor } from "../components/controls";
import { cssValueParts } from "../lib/css-value-parts";
import { getProp, clearedValue, resolveStyles } from "../lib/style";
import { makeBox, makeSwitch } from "../lib/presets";
import { flowMode } from "../components/style-panel/PositionSec";
import * as React from "react";
import { parseGradient } from "../components/style-panel/BackgroundSec";
import { parseShadow, serializeShadow } from "../components/style-panel/EffectsSec";

describe("inline-grid-layout", () => {
  function render(section: "BoxSec" | "LayoutSec", styles: Record<string, string>) {
    const writes: any[] = [];
    const node = { ...makeBox(), styles: { base: { default: styles } } };
    const path = resolve(`components/style-panel/${section}.tsx`);
    const require = createRequire(path);
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ breakpoint: "base" }) };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => getProp(node, "base", "default", p), cleared: () => null, set: (v: any) => writes.push(v) }),
        shorthandSide, Grp: "Grp", NumField: "NumField", Seg: "Seg", PropNum: "PropNum", PropSeg: "PropSeg", PropSelect: "PropSelect",
      };
      if (id === "./PositionSec") return { ...require(id), useParentFlexDir: () => null, useHiddenState: () => "" };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    const elements = flatten(section === "BoxSec" ? mod.exports.SpacingSec() : mod.exports.LayoutSec());
    const target = elements.find(e => typeof e.type === "function" && (section === "BoxSec" ? e.props.shorthand === "padding" : e.type.name === "GridGap"));
    return { elements, gap: target, writes };
  }

  test("inline-grid exposes the same grid controls as grid without changing display", () => {
    const view = render("LayoutSec", { display: "inline-grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" });
    assert.ok(view.gap, "grid gap controls must be available");
    const flow = view.elements.find(e => e.type === "Seg");
    assert.equal(flow.props.value, "grid");
    assert.deepEqual(view.writes, []);
    const columns = view.elements.find(e => e.type === "NumField" && e.props.value === "3");
    assert.ok(columns);
    columns.props.onChange("4");
    assert.equal(view.writes.at(-1).gridTemplateColumns, "repeat(4, 1fr)");
    assert.equal(Object.hasOwn(view.writes.at(-1), "display"), false);
  });
  test("flow mode recognizes inline-grid as grid", () => {
    assert.equal(flowMode("inline-grid", undefined), "grid");
  });
});

describe("spacing-shorthand-preservation", () => {
  function render(section: "BoxSec" | "LayoutSec", styles: Record<string, string>) {
    const writes: any[] = [];
    const node = { ...makeBox(), styles: { base: { default: styles } } };
    const path = resolve(`components/style-panel/${section}.tsx`);
    const require = createRequire(path);
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ breakpoint: "base" }) };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => getProp(node, "base", "default", p), cleared: () => null, set: (v: any) => writes.push(v) }),
        shorthandSide, Grp: "Grp", NumField: "NumField", Seg: "Seg", PropNum: "PropNum", PropSeg: "PropSeg", PropSelect: "PropSelect",
      };
      if (id === "./PositionSec") return { ...require(id), useParentFlexDir: () => null, useHiddenState: () => "" };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    const elements = flatten(section === "BoxSec" ? mod.exports.SpacingSec() : mod.exports.LayoutSec());
    const target = elements.find(e => typeof e.type === "function" && (section === "BoxSec" ? e.props.shorthand === "padding" : e.type.name === "GridGap"));
    return { fields: flatten(target.type(target.props)), writes };
  }
  test("changing horizontal padding keeps existing top/bottom longhand overrides", () => {
    const view = render("BoxSec", { padding: "10px", paddingTop: "25px", paddingBottom: "30px" });
    view.fields.find(e => e.type === "NumField" && e.props.title === "Left & right").props.onChange("5px");
    assert.deepEqual(view.writes.at(-1), { padding: null, paddingTop: "25px", paddingRight: "5px", paddingBottom: "30px", paddingLeft: "5px" });
  });
  test("padding shorthand math survives editing another axis", () => {
    const view = render("BoxSec", { padding: "calc(1rem + 2px) 4px" });
    view.fields.find(e => e.type === "NumField" && e.props.title === "Left & right").props.onChange("5px");
    assert.equal(view.writes.at(-1).paddingTop, "calc(1rem + 2px)");
    assert.equal(view.writes.at(-1).paddingBottom, "calc(1rem + 2px)");
  });
  test("grid gap math is displayed and preserved when editing the other axis", () => {
    const view = render("LayoutSec", { display: "grid", gap: "calc(1rem + 2px) min(3vw, 20px)" });
    const fields = view.fields.filter(e => e.type === "NumField");
    assert.deepEqual(fields.map(e => e.props.value), ["min(3vw, 20px)", "calc(1rem + 2px)"]);
    fields[0].props.onChange("5px");
    assert.equal(view.writes.at(-1).rowGap, "calc(1rem + 2px)");
    assert.equal(view.writes.at(-1).columnGap, "5px");
  });
  test("shorthand splitter keeps nested, quoted, and commented function tokens intact", () => {
    assert.deepEqual(cssValueParts('calc(1px + var(--x, 2px)) /* gap */ "a b"'), ['calc(1px + var(--x, 2px))', '"a b"']);
    assert.equal(shorthandSide("calc(2px + 1vw) 3px 4px", 3), "3px");
  });
});

describe("color-hex-alpha", () => {
  for (const [value, hex, alpha] of [
    ["#1234", "#112233", 68 / 255],
    ["#12345678", "#123456", 120 / 255],
    [" #AbCf ", "#AAbbCC", 1],
    ["#ff880000", "#ff8800", 0],
  ] as const) {
    test(`opacity edits retain RGB from ${value}`, () => {
      const parsed = parseColor(value);
      assert.deepEqual(parsed, { hex, alpha });
      // FillControl の不透明度の欄は、読み取った RGB と新しいアルファ値を組み合わせる。
      assert.equal(composeColor(parsed.hex, 0.5),
        `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.5)`);
    });
  }

  test("ordinary hex colors retain their opaque defaults", () => {
    assert.deepEqual(parseColor("#abc"), { hex: "#aabbcc", alpha: 1 });
    assert.deepEqual(parseColor("#123456"), { hex: "#123456", alpha: 1 });
    assert.deepEqual(parseColor("rgba(12, 34, 56, 0.5)"), { hex: "#0c2238", alpha: 0.5 });
  });

  test("non-hex CSS colors use the browser's canonical color before an opacity edit", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    const colors = new Map([
      ["red", "#ff0000"], ["transparent", "rgba(0, 0, 0, 0)"],
      ["hsl(120 100% 50% / 0.5)", "rgba(0, 255, 0, 0.5)"],
      ["rgb(100% 0% 0% / 50%)", "rgba(255, 0, 0, 0.5)"],
    ]);
    let created = 0;
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      createElement(tag: string) {
        assert.equal(tag, "canvas");
        created++;
        return { getContext: () => {
          let color = "#000000";
          return { set fillStyle(value: string) { color = colors.get(value) ?? value; }, get fillStyle() { return color; } };
        } };
      },
    } });
    try {
      assert.deepEqual(parseColor("rgba(12, 34, 56, 0.5)"), { hex: "#0c2238", alpha: 0.5 });
      assert.equal(created, 0);
      assert.deepEqual(parseColor("red"), { hex: "#ff0000", alpha: 1 });
      assert.deepEqual(parseColor("transparent"), { hex: "#000000", alpha: 0 });
      assert.deepEqual(parseColor("hsl(120 100% 50% / 0.5)"), { hex: "#00ff00", alpha: 0.5 });
      const color = parseColor("rgb(100% 0% 0% / 50%)");
      assert.equal(composeColor(color.hex, 0.25), "rgba(255, 0, 0, 0.25)");
      assert.equal(created, 1);
      const isolated = new Function("__name", `return (${parseColor.toString()})`)((fn: unknown) => fn) as typeof parseColor;
      assert.deepEqual(isolated("hsl(120 100% 50% / 0.5)"), { hex: "#00ff00", alpha: 0.5 });
      assert.equal(created, 1);
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });
});

describe("opacity-control", () => {
  const boxSecPath = resolve("components/style-panel/BoxSec.tsx");
  const boxSecRequire = createRequire(boxSecPath);
  const boxSecCode = transformSync(readFileSync(boxSecPath, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;

  function renderAppearance(node: any, bp = "base", state = "default") {
    const writes: any[] = [];
    const doc = { nodes: { [node.id]: node }, pages: {}, pageOrder: [] };
    const mod = { exports: {} as any };
    new Function("require", "module", "exports", boxSecCode)((id: string) => {
      if (id === "react") return { ...boxSecRequire(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }), findParentOf: () => null, ancestorsOf: () => [] };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => getProp(node, bp as any, state as any, p), cleared: (p: string) => clearedValue(node, bp as any, state as any, p),
          set: (v: any) => writes.push(v) }),
        Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect", PropNum: "PropNum", PropSeg: "PropSeg", PropFill: "PropFill", Seg: "Seg",
      };
      if (id === "./PositionSec") return { useHiddenState: () => "" };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return boxSecRequire(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    return { fields: flatten(mod.exports.AppearanceSec()), writes };
  }

  for (const value of ["50%", ".5", "0.5"]) test(`opacity display uses CSS numeric semantics: ${value}`, () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: value } } } };
    const view = renderAppearance(node);
    assert.equal(view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.value, "50%");
  });
  test("hover can explicitly become fully opaque despite a translucent default", () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: ".5" } } } };
    const view = renderAppearance(node, "base", "hover");
    view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
    const patch = Object.fromEntries(Object.entries(view.writes.at(-1)).filter(([, v]) => v !== null));
    const next = { ...node, styles: { base: { ...node.styles.base, hover: patch } } };
    assert.equal(resolveStyles(next as any, "base", "hover").opacity, "1");
  });
  for (const [value, expected] of [["12.5%", "12.5%"], ["1.25e-1", "12.5%"], ["150%", "100%"], ["-0.1", "0%"]]) test(`opacity ${value} displays ${expected}`, () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: value } } } };
    assert.equal(renderAppearance(node).fields.find(e => e.type === "NumField" && e.props.max === 100).props.value, expected);
  });
  test("fully opaque base value remains removable without forcing an unnecessary override", () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: ".5" } } } };
    const view = renderAppearance(node);
    view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
    assert.deepEqual(view.writes.at(-1), { opacity: null });
  });
  test("smaller breakpoint can explicitly become fully opaque", () => {
    const node = { ...makeBox(), styles: { base: { default: { opacity: "50%" } } } };
    const view = renderAppearance(node, "sm");
    view.fields.find(e => e.type === "NumField" && e.props.max === 100).props.onChange("100%");
    assert.deepEqual(view.writes.at(-1), { opacity: "1" });
  });

  for (const angle of [-45, 22.5, -0.5, 0, 180, 360]) {
    test(`gradient controls retain ${angle} degree angles and both colors`, () => {
      const c1 = "rgba(12, 34, 56, 0.5)", c2 = "#123456";
      const value = `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`;
      const parsed = parseGradient(value);
      assert.deepEqual(parsed, { angle, c1, c2 });
      assert.deepEqual(parseGradient(`linear-gradient(${parsed.angle}deg, #abcdef 0%, ${parsed.c2} 100%)`),
        { angle, c1: "#abcdef", c2 });
    });
  }
  test("gradient controls preserve defaults for unset or unsupported backgrounds", () => {
    for (const value of [undefined, "none", 'url("photo.png")']) {
      assert.deepEqual(parseGradient(value), { angle: 180, c1: "#ffffff", c2: "#e4e4e7" });
    }
  });

  test("the built-in switch shadow survives an opacity/color-only edit", () => {
    const preset = makeSwitch();
    const shadows = Object.values(preset.nodes).map(n => n.styles.base?.default?.boxShadow).filter(Boolean) as string[];
    assert.equal(shadows.length, 2);
    for (const value of shadows) {
      const parsed = parseShadow(value);
      assert.deepEqual(parsed, { inset: false, x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.25)" });
      assert.equal(serializeShadow({ ...parsed, color: "#123456" }), "0px 1px 2px 0px #123456");
    }
  });
  for (const value of ["0 0 red", "red 0px 0", "inset 0 0 0 0 red"]) test(`zero lengths and omitted blur are preserved: ${value}`, () => {
    assert.deepEqual(parseShadow(value), { inset: value.startsWith("inset"), x: 0, y: 0, blur: 0, spread: 0, color: "red" });
  });
  test("functional color channels are not mistaken for lengths", () => {
    assert.deepEqual(parseShadow("-1px 2px 3px 4px rgb(0 20 30 / 0.5) inset"), {
      inset: true, x: -1, y: 2, blur: 3, spread: 4, color: "rgb(0 20 30 / 0.5)",
    });
  });
  test("omitted shadow color uses CSS currentColor, without inventing opacity", () => {
    assert.deepEqual(parseShadow("0 1px"), { inset: false, x: 0, y: 1, blur: 0, spread: 0, color: "currentColor" });
  });
  test("nested color functions remain a single token", () => {
    assert.equal(parseShadow("0 0 2px var(--shadow, rgb(0 0 0))").color, "var(--shadow, rgb(0 0 0))");
  });

  {
    let values: Record<string, string> = {}, zWrites: Record<string, string | null>[] = [];
    const posRequire = createRequire(resolve("components/style-panel/PositionSec.tsx"));
    const posMod = { exports: {} as any };
    const posSource = transformSync(readFileSync("components/style-panel/PositionSec.tsx", "utf8") + "\nexport { ZIndexControl };", { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", posSource)((id: string) => {
      if (id === "../controls") return { ...posRequire(id), useInspector: () => ({ get: (prop: string) => ({ value: values[prop] }), set: (props: any) => zWrites.push(props) }) };
      return posRequire(id);
    }, posMod, posMod.exports);
    for (const position of [undefined, "static", "relative", "absolute", "fixed", "sticky"]) {
      test(`front/back controls respect ${position ?? "unset"} positioning`, () => {
        values = position ? { position, zIndex: "3" } : { zIndex: "3" }; zWrites = [];
        const tree = posMod.exports.ZIndexControl();
        const buttons = React.Children.toArray(tree.props.children).filter((el: any) => el.type === "button") as any[];
        buttons[0].props.onClick(); buttons[1].props.onClick();
        const patch = position === undefined || position === "static" ? { position: "relative" } : {};
        assert.deepEqual(zWrites, [{ zIndex: "2", ...patch }, { zIndex: "4", ...patch }]);
      });
    }
  }
});

describe("position-border-controls", () => {
  function render(file: string, name: string, base: Record<string, string>, props = {}, bp = "base", state = "hover") {
    const node = { ...makeBox(), styles: { base: { default: base } } };
    const writes: any[] = [], path = resolve(`components/style-panel/${file}.tsx`), require = createRequire(path);
    const mod = { exports: {} as any }, doc = { nodes: { [node.id]: node }, assets: {}, pages: {}, pageOrder: [] };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../../lib/store") return { useEditor: (select: any) => select({ doc, breakpoint: bp, styleState: state }) };
      if (id === "../../lib/assets") return { assetSrc: () => "" };
      if (id === "../ImagePicker") return { __esModule: true, default: "ImagePicker" };
      if (id === "../controls") return new Proxy({
        useInspector: () => ({ get: (p: string) => getProp(node, bp, state as any, p), cleared: (p: string) => clearedValue(node, bp, state as any, p), set: (v: any) => writes.push(v) }),
        unitConverter: () => undefined,
      } as any, { get: (o, k) => k in o ? o[k] : k });
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
    const result = () => {
      const patch = Object.fromEntries(Object.entries(writes.at(-1)).filter(([,v]) => v !== null));
      const next = structuredClone(node) as any;
      next.styles[bp] ??= {}; next.styles[bp][state] = patch;
      return resolveStyles(next, bp, state as any);
    };
    return { elements: flatten(mod.exports[name](props)), writes, result };
  }

  test("switching anchor from an automatic inset selects the requested edge", () => {
    const view = render("PositionSec", "PositionSec", { position: "absolute", left: "auto", right: "auto" }, {}, "base", "default");
    view.elements.find(e => e.type === "Seg" && e.props.value === "left").props.onChange("right");
    assert.equal(view.writes.at(-1).right, "0px");
  });
  test("setting hover rotation to zero disables the normal rotation", () => {
    const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg)" });
    view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange("0deg");
    assert.equal(view.result().transform, "none");
  });
  test("setting border width turns an explicitly absent border into a visible line", () => {
    const view = render("BackgroundSec", "BorderSec", { borderStyle: "none", borderWidth: "0px" }, {}, "base", "default");
    view.elements.find(e => e.type === "NumField").props.onChange("2px");
    assert.equal(view.writes.at(-1).borderStyle, "solid");
  });
  test("resetting rotation preserves other transform components", () => {
    const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg) scale(2)" });
    view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange("0deg");
    assert.equal(view.result().transform, "scale(2)");
  });
  test("anchor switching preserves a numeric offset", () => {
    const view = render("PositionSec", "PositionSec", { position: "absolute", left: "30%" });
    view.elements.find(e => e.type === "Seg" && e.props.value === "left").props.onChange("right");
    assert.equal(view.writes.at(-1).right, "30%");
    assert.equal(view.writes.at(-1).left, "auto");
  });
  test("width edits retain existing decorative border style", () => {
    const view = render("BackgroundSec", "BorderSec", { borderStyle: "dashed", borderColor: "red" }, {}, "base", "default");
    view.elements.find(e => e.type === "NumField").props.onChange("2px");
    assert.deepEqual(view.writes.at(-1), { borderWidth: "2px", borderStyle: "dashed", borderColor: "red" });
  });
  test("clearing the hover rotation field keeps its existing reset-to-inherited semantics", () => {
    const view = render("PositionSec", "PositionSec", { transform: "rotate(20deg)" });
    view.elements.find(e => e.type === "NumField" && e.props.units?.[0] === "deg").props.onChange(null);
    assert.equal(view.writes.at(-1).transform, null);
    assert.equal(view.result().transform, "rotate(20deg)");
  });
});

describe("shadow-length-units", () => {
  for (const [source, expected] of [
    ["inset .25em -1rem 2vh 0.5vw red", "inset .25em -1rem 2vh 0.5vw blue"],
    ["red 1cm 2mm 3pt 4pc", "1cm 2mm 3pt 4pc blue"],
    ["1dvh 2svw 3cqw 4lh rgb(0 0 0 / .5)", "1dvh 2svw 3cqw 4lh blue"],
    ["calc(1em + 2px) min(1vh, 3px) 2rem black", "calc(1em + 2px) min(1vh, 3px) 2rem 0px blue"],
    ["1e2px 2rem", "1e2px 2rem 0px 0px blue"],
    ["1e-2em 2rem", "1e-2em 2rem 0px 0px blue"],
  ]) test(`color edit preserves CSS shadow length units: ${source}`, () => {
    const parsed = parseShadow(source);
    assert.equal(serializeShadow({ ...parsed, color: "blue" }), expected);
  });

  test("editing one shadow dimension preserves the other dimensions", () => {
    const parsed = parseShadow(".5em 1rem 2vh 3vw #123");
    assert.equal(serializeShadow({ ...parsed, x: 4 }), "4px 1rem 2vh 3vw #123");
  });

  // 実際のカードを動かす。パーサーだけを確かめても、入力欄や、text-shadow の別の直列化で
  // 付く px の接尾辞を見逃してしまう。
  function renderShadow(prop: "boxShadow" | "textShadow") {
    const writes: any[] = [];
    const path = resolve("components/style-panel/EffectsSec.tsx");
    const require = createRequire(path);
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "react") return { ...require(id), useState: (v: any) => [v, () => {}] };
      if (id === "../controls") return {
        useInspector: () => ({ get: (p: string) => ({ value: p === prop ? ".5em 1rem 2vh red" : undefined }), cleared: () => null,
          set: (v: any) => writes.push(v) }),
        Dropdown: "Dropdown", FillControl: "FillControl", Grp: "Grp", InfoTip: "InfoTip", NumField: "NumField", PropSelect: "PropSelect",
      };
      if (id === "./shared") return { Sec: "Sec", I: 12 };
      return require(id);
    }, mod, mod.exports);
    const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
    const card = flatten(mod.exports.EffectsSec()).find(e => typeof e.type === "function" && e.props.shadow);
    return { fields: flatten(card.type(card.props)), writes };
  }
  for (const prop of ["boxShadow", "textShadow"] as const) test(`${prop} controls display and save non-pixel dimensions`, () => {
    const view = renderShadow(prop);
    const x = view.fields.find(e => e.type === "NumField" && e.props.pre === "X");
    assert.equal(x.props.value, ".5em");
    x.props.onChange("2rem");
    assert.equal(view.writes.at(-1)[prop], prop === "boxShadow" ? "2rem 1rem 2vh 0px red" : "2rem 1rem 2vh red");
    view.fields.find(e => e.type === "FillControl").props.onChange("blue");
    assert.equal(view.writes.at(-1)[prop], prop === "boxShadow" ? ".5em 1rem 2vh 0px blue" : ".5em 1rem 2vh blue");
  });
});
