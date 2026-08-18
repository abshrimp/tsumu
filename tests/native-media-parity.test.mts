import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import { YOUTUBE_ALLOW } from "../lib/embed";
import type { SiteDoc, EmbedContent } from "../lib/types";
function fixture(kind: EmbedContent["kind"]): SiteDoc {
  return {siteName:"Media parity",pageOrder:["p"],pages:{p:{id:"p",name:"P",slug:"",title:"P",description:"",children:["embed"]}},nodes:{embed:{...makeBox(),id:"embed",type:"embed",embed:{kind,src:kind === "youtube" ? "https://youtu.be/abcdefghijk" : kind === "map" ? "Tokyo" : "https://example.com/player"}}},assets:{}};
}
for (const framework of ["vue","nuxt","sveltekit"] as const) for (const kind of ["url","youtube","map"] as const) test(`${framework} ${kind} embed preserves editor fullscreen policy`, () => {
  const doc=fixture(kind);
  const path=framework === "vue" ? "src/pages/Page0.vue" : framework === "nuxt" ? "app/generated/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
  const native=generateExportProject(doc,framework).files[path].match(/<iframe\b[^>]*>/)?.[0];
  const next=generateExportProject(doc,"nextjs").files["app/page.tsx"].match(/<iframe\b[\s\S]*?\/>/)?.[0];
  assert.ok(native); assert.ok(next);
  assert.equal(/\ballowfullscreen\b/i.test(native),/\ballowFullScreen\b/.test(next));
  assert.equal(/\ballowfullscreen\b/i.test(native),kind !== "map");
  if(kind === "youtube") assert.ok(native.includes(`allow="${YOUTUBE_ALLOW}"`));
  else assert.doesNotMatch(native,/\ballow="/);
  assert.match(native,/loading="lazy"/);
  assert.match(native,/referrerpolicy="strict-origin-when-cross-origin"/);
  assert.equal(/\bsandbox\b/.test(native),/\bsandbox\b/.test(next));
});

for (const framework of ["vue","nuxt","sveltekit"] as const) for (const priority of [true,false,undefined]) test(`${framework} image priority ${priority} is preserved`, () => {
  const doc=fixture("url"); doc.nodes.embed={...makeBox(),id:"embed",type:"image",image:{src:"https://example.com/image.png",alt:"",width:100,height:100,priority}};
  const path=framework === "vue" ? "src/pages/Page0.vue" : framework === "nuxt" ? "app/generated/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
  const native=generateExportProject(doc,framework).files[path].match(/<img\b[^>]*>/)?.[0];
  const next=generateExportProject(doc,"nextjs").files["app/page.tsx"];
  assert.ok(native);
  assert.equal(/fetchpriority="high"/.test(native),!!priority);
  assert.equal(/fetchPriority="high"/.test(next),!!priority);
  if (!priority) assert.doesNotMatch(native,/fetchpriority=/);
});
