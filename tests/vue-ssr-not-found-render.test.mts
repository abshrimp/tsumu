import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { generateExportProject } from '../lib/export-formats';
import type { SiteDoc } from '../lib/types';
const doc:SiteDoc={siteName:'SSR fallback',lang:'ja',nodes:{},assets:{},pageOrder:['home'],pages:{
  home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
}};
for(const language of ['javascript','typescript'] as const) for(const style of ['css','css-modules'] as const) {
  test(`Vue ${language}/${style} SSR 404 renders the same App that the client hydrates`,async()=>{
    const files=generateExportProject(doc,{framework:'vue',language,style,scope:'project'}).files;
    const extension=language==='typescript'?'ts':'js';
    const App={source:files['src/App.vue']};
    assert.match(App.source,/<main v-else><h1>Not Found<\/h1><\/main>/);
    if(style==='css-modules')assert.match(App.source,/:class="siteStyles.siteRoot"/);
    assert.match(files[`src/entry-client.${extension}`],/createSSRApp\(App,/);
    const calls:any[]=[];
    const mod={exports:{} as any};
    new Function('require','module','exports',transformSync(files[`src/entry-server.${extension}`],{loader:'ts',format:'cjs'}).code)((id:string)=>{
      if(id==='vue')return {createSSRApp:(component:any,props:any)=>{assert.equal(component,App);calls.push(props);return {component,props};}};
      if(id==='vue/server-renderer')return {renderToString:async(app:any)=>{
        assert.equal(app.component,App);
        return `<div data-rendered-app="${style}"><main><h1>Not Found</h1></main></div>`;
      }};
      if(id==='./App.vue')return {__esModule:true,default:App};
      if(id==='./site-routes.js')return {selectPage:()=>null};
      if(id==='./site-data.js')return {loadPageData:()=>{assert.fail('missing routes must not load data');}};
      if(id==='./server-request.js')return {requestPublic:()=>{assert.fail('missing routes must not fetch');}};
      throw Error(id);
    },mod,mod.exports);
    const result=await mod.exports.render('https://site.example/does-not-exist');
    assert.deepEqual(calls,[{initialPageId:'',initialVars:{}}]);
    assert.equal(result.status,404);
    assert.equal(result.id,'');
    assert.deepEqual(result.vars,{});
    assert.equal(result.language,'ja');
    assert.match(result.html,/data-rendered-app=/,'SSR must use App renderer output, including its wrappers');
  });
}
