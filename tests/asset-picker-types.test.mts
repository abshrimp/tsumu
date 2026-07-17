import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetGrid } from "../components/ImagePicker";
import { useEditor } from "../lib/store";
import type { Asset } from "../lib/types";

test("image pickers do not offer CSS, scripts, documents or fonts as images", () => {
  const initial = useEditor.getInitialState();
  const original = initial.doc;
  const asset = (id: string, name: string, mimeType?: string): Asset => ({ id, name, mimeType, path: `assets/${name}`, width: 1, height: 1 });
  const assets = [
    asset("png", "photo.png", "image/png"), asset("svg", "logo.svg", "image/svg+xml"),
    asset("legacy", "legacy.png"), asset("css", "styles.css", "text/css"),
    asset("js", "app.js", "text/javascript"), asset("pdf", "manual.pdf", "application/pdf"),
    asset("font", "font.woff2", "font/woff2"), asset("video", "movie.mp4", "video/mp4"),
    asset("audio", "sound.mp3", "audio/mpeg"),
  ];
  initial.doc = { ...original, assets: Object.fromEntries(assets.map(a => [a.id, a])) };
  try {
    const markup = renderToStaticMarkup(createElement(AssetGrid, { kind: "image", onPick() {} }));
    for (const name of ["photo.png", "logo.svg", "legacy.png"]) assert.ok(markup.includes(`data-tip="${name}"`), name);
    for (const name of ["styles.css", "app.js", "manual.pdf", "font.woff2", "movie.mp4", "sound.mp3"]) assert.ok(!markup.includes(`data-tip="${name}"`), name);
    for (const [kind, name] of [["video", "movie.mp4"], ["audio", "sound.mp3"]] as const) {
      const media = renderToStaticMarkup(createElement(AssetGrid, { kind, onPick() {} }));
      assert.ok(media.includes(`data-tip="${name}"`));
      assert.ok(!media.includes('data-tip="photo.png"'));
    }
  } finally { initial.doc = original; }
});
