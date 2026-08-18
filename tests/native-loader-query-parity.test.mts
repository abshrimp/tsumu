import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { generateExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";
const doc: SiteDoc = { siteName:"Query routes", nodes:{}, assets:{}, pageOrder:["home","special"],pages:{
  home:{id:"home",name:"Home",title:"Home",description:"",slug:"",children:[]},
  special:{id:"special",name:"Special",title:"Special",description:"",slug:"",query:"tab=details",children:[]},
} };
const files=generateExportProject(doc,"nuxt").files;
const source=files["app/pages/index.vue"];
const queryLine=source.match(/^const query = computed\(\(\) => (.+)\);$/m)?.[1];
assert.ok(queryLine);
const module={exports:{} as any};
runInNewContext(transformSync(files["app/generated/site-routes.js"],{format:"cjs"}).code,{module,URLSearchParams});
const dataModule={exports:{} as any};
runInNewContext(transformSync(files["app/generated/site-data.js"],{format:"cjs"}).code,{module:dataModule,URLSearchParams,URL,fetch});
for(const fullPath of ["/?q=alpha?beta", "/?tab=details#section", "/?q=alpha?beta#section", "/?q=a%3Fb%23c", "/?q=a+b&tag=one&tag=two", "/#section?not=a-query", "/"]) test(`Nuxt query loader agrees with server URL parsing: ${fullPath}`, async () => {
  const expected=new URL(fullPath,"https://example.com").searchParams;
  const query=runInNewContext(queryLine,{route:{fullPath},requestUrl:new URL("https://example.com"),URLSearchParams,URL});
  assert.deepEqual([...query.entries()],[...expected.entries()]);
  assert.equal(module.exports.selectPage("/",query)?.id,module.exports.selectPage("/",expected)?.id);
  const values=await dataModule.exports.loadPageData({steps:[]},query);
  assert.deepEqual({...values},Object.fromEntries(expected));
});
