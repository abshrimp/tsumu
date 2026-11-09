import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUERY_VARIANT_RUNTIME } from '../lib/generator/query-route';

// HTML Standard's script type uses an essence *match*, not MIME parsing.
// Parameters such as text/javascript;charset=utf-8 are inert data blocks.
// https://html.spec.whatwg.org/multipage/scripting.html#attr-script-type
async function bootstrap(type:string, browserExecutes:boolean) {
  const inserted:string[]=[];
  const attrs=[{name:'type',value:type},{name:'src',value:'/authored.js'}];
  const old={attributes:attrs,textContent:'',
    getAttribute:(name:string)=>attrs.find(a=>a.name===name)?.value??null,
    hasAttribute:(name:string)=>attrs.some(a=>a.name===name),
    replaceWith(script:any){inserted.push('authored');if(browserExecutes)queueMicrotask(()=>script.onload?.());},
  };
  const document={
    currentScript:{getAttribute:()=>JSON.stringify(['/data-loader.js','/scripts.js'])},documentElement:{},
    querySelector:(sel:string)=>sel==='[data-variant-root]'?{innerHTML:'',querySelectorAll:()=>[old]}:
      sel==='script[data-page-variants]'?{textContent:JSON.stringify([{query:{},html:''}])}:null,
    createElement:()=>({text:'',src:'',setAttribute(){}}),
    body:{appendChild(script:any){inserted.push(script.src);queueMicrotask(()=>script.onload?.());}},
  };
  new Function('document','location','URLSearchParams',QUERY_VARIANT_RUNTIME)(document,{search:''},URLSearchParams);
  await new Promise<void>(resolve=>setImmediate(resolve));
  return inserted;
}
for(const type of ['text/javascript; charset=utf-8','application/javascript; charset=utf-8','application/ecmascript;version=1','text/javascript ;','application/json','application/ld+json'])
  test(`inert script type does not stall variant startup: ${type}`,async()=>{
    assert.deepEqual(await bootstrap(type,false),['/data-loader.js','/scripts.js']);
  });
for(const type of ['text/javascript','application/javascript','text/ecmascript','application/ecmascript',
  'application/x-javascript','application/x-ecmascript','text/x-javascript','text/x-ecmascript',
  'text/javascript1.0','text/javascript1.1','text/javascript1.2','text/javascript1.3','text/javascript1.4','text/javascript1.5',
  'text/jscript','text/livescript','TEXT/JAVASCRIPT'])
  test(`browser-supported classic script type is replayed: ${type}`,async()=>{
    assert.deepEqual(await bootstrap(type,true),['authored','/data-loader.js','/scripts.js']);
  });
