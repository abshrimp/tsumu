import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { generateExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";
const {parse}=createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const site='Site & "quoted"';
const title='Page <unsafe> & "double" \'single\' <!--page-lang-->';
const description='Description " onload="bad <script>alert(1)</script> & \'text\'';
const doc:SiteDoc={siteName:site,lang:"ja",nodes:{},assets:{},pageOrder:["home","foreign"],pages:{
  home:{id:"home",name:"Home",title:"Home",description:"Home description",slug:"",children:[]},
  foreign:{id:"foreign",name:"Foreign",title,description,lang:"en-GB",slug:"foreign",children:[]},
}};
function harness(language:"javascript"|"typescript", sourceDoc: SiteDoc = doc) {
  const files=generateExportProject(sourceDoc,{framework:"vue",language,scope:"project"}).files;
  const modules=new Map<string,any>();
  const load=(path:string):any=>{
    if(modules.has(path))return modules.get(path);
    const module={exports:{} as any};modules.set(path,module.exports);
    const source=transformSync(files[path],{loader:"ts",format:"cjs"}).code;
    new Function("require","module","exports",source)((id:string)=>{
      if(id === "vue")return {createSSRApp:()=>({})};
      if(id === "vue/server-renderer")return {renderToString:async()=>'<p id="content">SSR</p>'};
      if(id === "./App.vue")return {default:{}};
      if(id.startsWith("./"))return load("src/"+id.slice(2));
      throw Error(id);
    },module,module.exports);
    modules.set(path,module.exports);return module.exports;
  };
  const render=load(`src/entry-server.${language === "typescript" ? "ts" : "js"}`).render;
  const source=files["server.mjs"];
  const begin=source.indexOf("async function handle(req, res) {");
  const end=source.indexOf("const server =",begin);
  assert.ok(begin>=0&&end>begin);
  const handle=runInNewContext(source.slice(begin,end)+"\nhandle",{
    URL,console,process:{env:{}},production:false,templateFile:"index.html",
    readFile:async()=>files["index.html"],
    vite:{ssrLoadModule:async()=>({render}),transformIndexHtml:async(_path:string,html:string)=>html,ssrFixStacktrace(){}},
  });
  return async(path:string)=>{
    let status=0,html="";
    await handle({url:path},{writeHead(code:number){status=code;},end(value:string){html=value;}});
    return {status,html,tree:parse(html)};
  };
}
for(const language of ["javascript","typescript"] as const) {
  test(`Vue ${language} SSR renders escaped page-specific title, description and language`,async()=>{
    const request=harness(language);const result=await request("/foreign");
    assert.equal(result.status,200);
    assert.equal(result.tree.querySelector("html").getAttribute("lang"),"en-GB");
    assert.equal(result.tree.querySelector("title").text,title+" | "+site);
    assert.equal(result.tree.querySelector('meta[name="description"]').getAttribute("content"),description);
    assert.equal(result.tree.querySelectorAll("script").length,2,"metadata cannot insert script elements");
    assert.equal(result.tree.querySelector("#content").text,"SSR");
    assert.doesNotMatch(result.html,/onload="bad/);
    const home=await request("/");
    assert.equal(home.tree.querySelector("html").getAttribute("lang"),"ja");
    assert.equal(home.tree.querySelector('meta[name="description"]').getAttribute("content"),"Home description");
  });
  test(`Vue ${language} not-found response retains safe default metadata`,async()=>{
    const result=await harness(language)("/missing");
    assert.equal(result.status,404);
    assert.equal(result.tree.querySelector("html").getAttribute("lang"),"ja");
    assert.equal(result.tree.querySelector('meta[name="description"]').getAttribute("content"),"");
    assert.match(result.tree.querySelector("title").text,/Not Found/);
  });
}

test("Vue SSR language metadata cannot escape its HTML attribute", async () => {
  const source = structuredClone(doc);
  source.pages.foreign.lang = 'en" data-injected="yes';
  const result = await harness("typescript", source)("/foreign");
  assert.equal(result.status, 200);
  assert.equal(result.tree.querySelector("html").getAttribute("lang"), source.pages.foreign.lang);
  assert.equal(result.tree.querySelector("html").hasAttribute("data-injected"), false);
});
