import assert from "node:assert/strict";
import { test } from "node:test";
import { savedTimeLabel } from "../lib/time";

const at = (text: string) => new Date(text).getTime();

test("a save within 24 hours shows its time, marked with the day when it was not today", () => {
  const now = at("2026-11-17T10:00:00");
  assert.equal(savedTimeLabel(at("2026-11-17T09:05:03"), now, "ja"), "9:05:03");
  assert.equal(savedTimeLabel(at("2026-11-16T23:10:00"), now, "ja"), "昨日 23:10");
  assert.equal(savedTimeLabel(at("2026-11-16T23:10:00"), now, "en"), "yesterday 11:10 PM");
});

test("a save older than 24 hours shows how many calendar days ago it was", () => {
  const now = at("2026-11-17T10:00:00");
  assert.equal(savedTimeLabel(at("2026-11-16T09:59:00"), now, "ja"), "昨日");
  assert.equal(savedTimeLabel(at("2026-11-15T23:00:00"), now, "ja"), "一昨日");
  assert.equal(savedTimeLabel(at("2026-11-14T12:00:00"), now, "ja"), "3 日前");
  assert.equal(savedTimeLabel(at("2026-11-16T09:59:00"), now, "en"), "yesterday");
  assert.equal(savedTimeLabel(at("2026-11-14T12:00:00"), now, "en"), "3 days ago");
  // 0:30 の時点で2日前の 23:00 は、25時間半前でも暦の上では「一昨日」。
  assert.equal(savedTimeLabel(at("2026-11-15T23:00:00"), at("2026-11-17T00:30:00"), "ja"), "一昨日");
});

test("older saves fall back to weeks, months and years", () => {
  const now = at("2026-11-17T10:00:00");
  assert.equal(savedTimeLabel(at("2026-11-08T10:00:00"), now, "ja"), "先週");
  assert.equal(savedTimeLabel(at("2026-10-01T10:00:00"), now, "ja"), "先月");
  assert.equal(savedTimeLabel(at("2024-11-01T10:00:00"), now, "ja"), "2 年前");
});
