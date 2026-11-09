import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { cssAssetReferences } from "../lib/css-assets";

function render(image: string, assets = {}) {
  const writes: Record<string, string | null>[] = [];
  const path = resolve("components/style-panel/BackgroundSec.tsx");
  const require = createRequire(path);
  const mod = { exports: {} as any };
  const doc = { assets };
  const useEditor = Object.assign((select: (s: { doc: typeof doc }) => unknown) => select({ doc }), {
    getState: () => ({ doc }),
  });
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "../../lib/store") return { useEditor };
    if (id === "../ImagePicker") return { default: "ImagePicker", __esModule: true };
    if (id === "../controls") return {
      useInspector: () => ({ editTarget: "a", get: (prop: string) => ({ value: prop === "backgroundImage" ? image : undefined }),
        cleared: () => null, set: (props: Record<string, string | null>) => writes.push(props) }),
      Seg: "Seg", Grp: "Grp", Dropdown: "Dropdown", FillControl: "FillControl", NumField: "NumField", PropFill: "PropFill", PropSelect: "PropSelect",
    };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, mod, mod.exports);
  const elements: any[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") { elements.push(value); visit(value.props?.children); }
  };
  visit(mod.exports.BackgroundSec());
  return { elements, writes, mode: elements.find(e => e.type === "Seg")?.props.value,
    picker: elements.find(e => e.type === "ImagePicker")?.props };
}

for (const image of ['url("https://example.test/gradient.png")', 'URL("https://example.test/photo.png")']) {
  test(`background controls recognize an image rather than matching URL contents: ${image}`, () => {
    const view = render(image);
    assert.equal(view.mode, "image");
    assert.equal(view.picker.value.url, cssAssetReferences(image)[0].url);
  });
}
for (const image of ['url("https://example.test/photo(1).png")', 'url("https://example.test/a\\\"b.png")', 'url(https://example.test/a\\(1\\).png)']) {
  test(`background picker preserves the complete decoded URL: ${image}`, () => {
    assert.equal(render(image).picker.value.url, cssAssetReferences(image)[0].url);
  });
}

test("changing a background escapes CSS string delimiters and round-trips the URL", () => {
  const view = render('url("before.png")');
  const url = 'https://example.test/a"b\\c(1).png';
  view.picker.onChange({ url });
  const value = view.writes[0].backgroundImage!;
  assert.deepEqual(cssAssetReferences(value).map(ref => ref.url), [url]);
  assert.equal(render(value).picker.value.url, url);
});

test("actual gradient functions still use gradient controls", () => {
  assert.equal(render("linear-gradient(90deg, #fff 0%, #000 100%)").mode, "gradient");
});


test("uppercase gradient function retains its angle and colors", () => {
  const view = render("LINEAR-GRADIENT(45DEG, #123456 0%, #abcdef 100%)");
  assert.equal(view.mode, "gradient");
  const angle = view.elements.find(e => e.type === "NumField");
  assert.equal(angle.props.value, "45deg");
  const colors = view.elements.filter(e => e.type === "FillControl");
  assert.deepEqual(colors.map(e => e.props.value), ["#123456", "#abcdef"]);
});
