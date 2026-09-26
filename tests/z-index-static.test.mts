import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";

let values: Record<string, string> = {}, writes: Record<string, string | null>[] = [];
const require = createRequire(resolve("components/style-panel/PositionSec.tsx"));
const mod = { exports: {} as any };
const source = transformSync(readFileSync("components/style-panel/PositionSec.tsx", "utf8") + "\nexport { ZIndexControl };", { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
new Function("require", "module", "exports", source)((id: string) => {
  if (id === "../controls") return { ...require(id), useInspector: () => ({ get: (prop: string) => ({ value: values[prop] }), set: (props: any) => writes.push(props) }) };
  return require(id);
}, mod, mod.exports);
for (const position of [undefined, "static", "relative", "absolute", "fixed", "sticky"]) {
  test(`front/back controls respect ${position ?? "unset"} positioning`, () => {
    values = position ? { position, zIndex: "3" } : { zIndex: "3" }; writes = [];
    const tree = mod.exports.ZIndexControl();
    const buttons = React.Children.toArray(tree.props.children).filter((el: any) => el.type === "button") as any[];
    buttons[0].props.onClick(); buttons[1].props.onClick();
    const patch = position === undefined || position === "static" ? { position: "relative" } : {};
    assert.deepEqual(writes, [{ zIndex: "2", ...patch }, { zIndex: "4", ...patch }]);
  });
}
