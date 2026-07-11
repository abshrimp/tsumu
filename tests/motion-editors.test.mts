import assert from "node:assert/strict";
import { test } from "node:test";
import { easeAt, easingValue, parseEasing } from "../lib/easing";
import { parseKeyframes, serializeKeyframes } from "../lib/keyframes";
import { KEYFRAMES } from "../lib/motion";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("easing keywords and cubic-bezier values round-trip", () => {
  assert.deepEqual(parseEasing("ease-out"), { kind: "bezier", b: [0, 0, 0.58, 1] });
  assert.equal(easingValue({ kind: "bezier", b: [0.42, 0, 0.58, 1] }), "ease-in-out");
  assert.equal(easingValue({ kind: "bezier", b: [0.123, 0.5, 0.456, 1.2] }), "cubic-bezier(0.12, 0.5, 0.46, 1.2)");
  // プリセットと同じ曲線は、プリセットの書き方に戻す（ドロップダウンで選択中として出る）
  assert.equal(easingValue(parseEasing("cubic-bezier(0.340, 1.56, 0.64, 1.0)")!), "cubic-bezier(0.34, 1.56, 0.64, 1)");
});

test("easing values that cannot be drawn are rejected", () => {
  assert.equal(parseEasing("cubic-bezier(1.2, 0, 0, 1)"), null);
  assert.equal(parseEasing("cubic-bezier(0, 0, 1)"), null);
  assert.equal(parseEasing("linear(0, 0.5 20%, 1)"), null);
  assert.equal(parseEasing("steps(1, jump-none)"), null);
});

test("steps follow the CSS definition", () => {
  const end = parseEasing("steps(4)")!;
  assert.deepEqual(end, { kind: "steps", n: 4, pos: "jump-end" });
  assert.equal(easeAt(end, 0), 0);
  assert.equal(easeAt(end, 0.3), 0.25);
  assert.equal(easeAt(end, 1), 1);
  const start = parseEasing("steps(4, start)")!;
  assert.equal(easeAt(start, 0), 0.25);
  const none = parseEasing("steps(3, jump-none)")!;
  assert.equal(easeAt(none, 0.5), 0.5);
  const both = parseEasing("steps(3, jump-both)")!;
  assert.equal(easeAt(both, 0), 0.25);
  assert.equal(easingValue(start), "steps(4, jump-start)");
  assert.equal(easingValue(end), "steps(4)");
});

test("bezier evaluation matches known points", () => {
  const linear = parseEasing("linear")!;
  close(easeAt(linear, 0.37), 0.37);
  const ease = parseEasing("ease-in-out")!;
  close(easeAt(ease, 0.5), 0.5);
  assert.ok(easeAt(parseEasing("ease-in")!, 0.25) < 0.25);
  // 行き過ぎる曲線は 1 を超える
  assert.ok(easeAt(parseEasing("cubic-bezier(0.34, 1.56, 0.64, 1)")!, 0.6) > 1);
});

test("keyframes are split into editable properties", () => {
  const list = parseKeyframes("from { opacity: 0; transform: translateY(24px) scale(0.9); filter: blur(4px); }")!;
  assert.equal(list.length, 1);
  assert.equal(list[0].offset, 0);
  assert.equal(list[0].opacity, 0);
  assert.equal(list[0].y, 24);
  assert.equal(list[0].scale, 0.9);
  assert.equal(list[0].extra, "filter: blur(4px);");
});

test("grouped selectors become separate keyframes and the same offset is merged", () => {
  const list = parseKeyframes("0%, 100% { transform: translateX(0); } 50% { transform: translateX(6px); } 100% { opacity: 1; }")!;
  assert.deepEqual(list.map((k) => k.offset), [0, 50, 100]);
  assert.equal(list[2].x, 0);
  assert.equal(list[2].opacity, 1);
});

test("transforms that would change meaning stay as raw CSS", () => {
  // 回転してから移動すると、項目に分けた順（移動→回転）とは見た目が変わる
  const list = parseKeyframes("to { transform: rotate(45deg) translateX(10px); }")!;
  assert.equal(list[0].x, undefined);
  assert.equal(list[0].extra, "transform: rotate(45deg) translateX(10px);");
  const flip = parseKeyframes("to { transform: perspective(600px) rotateY(360deg); }")!;
  assert.match(flip[0].extra, /perspective/);
});

test("invalid keyframe CSS is rejected", () => {
  assert.equal(parseKeyframes("from { opacity: 0;"), null);
  assert.equal(parseKeyframes("middle { opacity: 0; }"), null);
  assert.equal(parseKeyframes("opacity: 0;"), null);
  assert.deepEqual(parseKeyframes(""), []);
});

test("serialized keyframes share the same transform functions", () => {
  const css = serializeKeyframes([
    { id: "a", offset: 0, y: 20, extra: "" },
    { id: "b", offset: 100, scale: 1.2, extra: "" },
    { id: "c", offset: 50, opacity: 0.5, extra: "filter: blur(2px)" },
  ]);
  assert.equal(
    css,
    [
      "from { transform: translateY(20px) scale(1); }",
      "50% { opacity: 0.5; filter: blur(2px); }",
      "to { transform: translateY(0px) scale(1.2); }",
    ].join("\n")
  );
});

test("every built-in keyframe preset parses and keeps its meaning", () => {
  for (const kf of KEYFRAMES) {
    const list = parseKeyframes(kf.css);
    assert.ok(list, kf.key);
    // 書き出したものをもう一度読んでも同じ内容になる
    const again = parseKeyframes(serializeKeyframes(list!))!;
    const strip = (l: typeof list) => l!.map(({ id: _id, ...rest }) => rest);
    assert.deepEqual(strip(again), strip(list), kf.key);
  }
});
