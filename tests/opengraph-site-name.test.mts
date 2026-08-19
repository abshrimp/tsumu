import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import {generateProject} from '../lib/generator';
import type {SiteDoc} from '../lib/types';
const require=createRequire(import.meta.url);
// This marker has no runtime behavior. Keep the actual Next metadata resolver.
const Module=require('node:module'),originalLoad=Module._load;
let accumulateMetadata:any;
try {
 Module._load=function(id:string,...args:any[]){return id==='server-only'?{}:originalLoad.call(this,id,...args);};
 ({accumulateMetadata}=require('next/dist/lib/metadata/resolve-metadata'));
} finally {Module._load=originalLoad;}
function fixture(dynamic:boolean,override:boolean):SiteDoc {
 return {siteName:'Brand "quoted" & 日本',siteUrl:'https://example.com',ogImage:{url:'https://example.com/default.png'},nodes:{},assets:{},pageOrder:['p'],pages:{p:{id:'p',name:'Page',title:'Page title',description:'Description',slug:dynamic?'posts/[slug]':'',children:[],
 ...(override?{ogImage:{url:'https://example.com/page.png'}}:{}),
 ...(dynamic?{pageScripts:[{id:'load',trigger:'load',pos:{x:0,y:0},steps:[{id:'fetch',kind:'fetch',url:'https://example.com/posts/{slug}',as:'response'},{id:'set',kind:'set-var',value:'{response}',into:'post'}]}]}:{}),
 }}};
}
for(const dynamic of [false,true])for(const override of [false,true])test(`Next resolved OGP retains site name (${dynamic?'dynamic':'static'}, ${override?'page':'default'} image)`,async()=>{
 const doc=fixture(dynamic,override),files=generateProject(doc).files;
 const layoutSource=files['app/layout.tsx'];
 const layout=new Function('return ('+layoutSource.match(/export const metadata: Metadata = (\{[\s\S]*?\n\});/)![1]+')')();
 const pageSource=files[dynamic?'app/posts/[slug]/page.tsx':'app/page.tsx'];
 let page:any;
 if(dynamic){
  const source=pageSource.slice(pageSource.indexOf('export async function generateMetadata'),pageSource.indexOf('export default'));
  assert.ok(source,'exercise generated dynamic metadata');
  const mod={exports:{} as any};
  new Function('module','exports','loadData',transformSync(source,{loader:'ts',format:'cjs'}).code)(mod,mod.exports,async()=>{});
  page=await mod.exports.generateMetadata({params:Promise.resolve({slug:'one'}),searchParams:Promise.resolve({})});
 }else page=new Function('return ('+pageSource.match(/export const metadata: Metadata = (\{[\s\S]*?\n\});/)![1]+')')();
 const resolved=await accumulateMetadata('/',[[layout,null],[page,null]],'/',{pathname:'/',trailingSlash:false,isStaticMetadataRouteFile:false});
 assert.equal(resolved.openGraph.siteName,doc.siteName);
 assert.equal(resolved.openGraph.images[0].url,override?'https://example.com/page.png':'https://example.com/default.png');
 assert.equal(resolved.openGraph.title.absolute,'Page title');
 assert.equal(resolved.openGraph.description,'Description');
});
