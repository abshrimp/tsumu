import assert from "node:assert/strict";
import { test } from "node:test";
import { TOPICS } from "../lib/manualTopics";

test("Adobe Fonts help explains Web Project creation, ID lookup and font selection", () => {
  const topic = TOPICS.find((entry) => entry.id === "text-adobe-fonts");
  assert.ok(topic, "Adobe Fonts must have a dedicated help topic");
  assert.equal(topic.cat, "text");
  const steps = topic.body?.find((block) => "list" in block && block.ordered);
  assert.ok(steps && "list" in steps);
  assert.equal(steps.list.length, 4);
  assert.match(steps.list.join(" "), /Project ID/);
  assert.match(steps.list.join(" "), /Adobe Fonts/);
  const official = topic.body?.find((block) => "external" in block);
  assert.ok(official && "external" in official);
  assert.equal(official.external.url, "https://fonts.adobe.com/my_fonts#web_projects-section");
  const note = topic.body?.find((block) => "note" in block);
  assert.ok(note && "note" in note);
  assert.match(note.note, /adobeFonts\[\]\.kitId/);
  const warning = topic.body?.find((block) => "warn" in block);
  assert.ok(warning && "warn" in warning);
  assert.match(warning.warn, /expired/);
});

test("Google Fonts help links to the Adobe Fonts instructions", () => {
  const topic = TOPICS.find((entry) => entry.id === "text-font");
  assert.ok(topic);
  assert.ok(topic.see?.includes("text-adobe-fonts"));
});
