import assert from "node:assert/strict";
import { test } from "node:test";
import {
  systemTimeValues, systemVariable,
  SYSTEM_TIME_VARIABLE_NAMES, SYSTEM_BROWSER_VARIABLE_NAMES, SYSTEM_RANDOM_VARIABLE_NAMES,
} from "../lib/system-time";
import { interpolate, lookupVar } from "../lib/vars";
import { varGroupsAt, varNamesAt } from "../lib/data";
import { createInitialDoc } from "../lib/presets";

test("system time variables provide local time, UTC ISO, Unix seconds and components", () => {
  const at = new Date("2026-11-16T03:04:05.123Z");
  const values = systemTimeValues(at);
  assert.equal(values.iso, "2026-11-16T03:04:05.123Z");
  assert.equal(values.unix, Math.floor(at.getTime() / 1000));
  assert.equal(values.timestamp, at.getTime());
  assert.match(values.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(values.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(systemVariable("system.iso", at), values.iso);
  assert.deepEqual(systemVariable("system", at), values);
  assert.equal(systemVariable("system.missing", at), undefined);
});

test("time is resolved at use time instead of being stored in the document", () => {
  const before = Date.now();
  const stamp = lookupVar({}, "system.timestamp");
  assert.equal(typeof stamp, "number");
  assert.ok((stamp as number) >= before && (stamp as number) <= Date.now());
  assert.match(interpolate("{system.date} {system.time}", {}), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(lookupVar({ system: { date: "overridden" } }, "system.date") === "overridden", false);
});

test("random values have documented types, boundaries, and are generated per read", () => {
  const previous = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(systemVariable("system.random"), 0);
    assert.equal(systemVariable("system.randomInt"), 1);
    assert.equal(systemVariable("system.randomBoolean"), true);
    Math.random = () => 0.999999999;
    assert.ok((systemVariable("system.random") as number) < 1);
    assert.equal(systemVariable("system.randomInt"), 100);
    assert.equal(systemVariable("system.randomBoolean"), false);
    Math.random = () => 0.4;
    assert.equal(lookupVar({}, "system.randomInt"), 41);
  } finally {
    Math.random = previous;
  }
  const uuid = systemVariable("system.uuid");
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    assert.match(uuid as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } else assert.equal(uuid, undefined);
});

test("advanced picker contains all built-ins, without mixing them into normal suggestions", () => {
  const doc = createInitialDoc();
  const pageId = doc.pageOrder[0];
  const groups = varGroupsAt(doc, pageId, "");
  const builtin = groups.filter((group) => group.key === "system");
  assert.equal(builtin.length, 3);
  assert.ok(builtin.every((group) => group.advanced === true));
  const fields = new Set(builtin.flatMap((group) => Object.keys(group.vars)));
  for (const name of [
    ...SYSTEM_TIME_VARIABLE_NAMES, ...SYSTEM_BROWSER_VARIABLE_NAMES, ...SYSTEM_RANDOM_VARIABLE_NAMES,
  ]) assert.ok(fields.has(name), name);
  assert.ok(!varNamesAt(doc, pageId, "").some((name) => name.startsWith("system.")));
});

test("browser-only variables are undefined without a DOM, but timezone is available", () => {
  assert.equal(typeof systemVariable("system.browser.timeZone"), "string");
  assert.equal(systemVariable("system.page.url"), undefined);
  assert.equal(systemVariable("system.viewport.width"), undefined);
});
