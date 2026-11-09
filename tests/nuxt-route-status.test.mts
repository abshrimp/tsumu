import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { generateExportProject } from '../lib/export-formats';
import type { SiteDoc } from '../lib/types';
const doc: SiteDoc = {siteName:'Routes',nodes:{},assets:{},pageOrder:['home','about','draft'],pages:{
  home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
  about:{id:'about',name:'About',title:'About',description:'',slug:'about',children:[]},
  draft:{id:'draft',name:'Draft',title:'Draft',description:'',slug:'draft',unpublished:true,children:[]},
}};
for (const language of ['javascript','typescript'] as const) {
  const files=generateExportProject(doc,{framework:'nuxt',language,scope:'project'}).files;
  const routes:any={URLSearchParams};
  runInNewContext(files['app/generated/site-routes.js'].replace(/\bexport /g,'')+'\nglobalThis.selectPage=selectPage;',routes);
  const source=files['app/pages/index.vue'];
  assert.equal(source,files['app/pages/[...slug].vue']);
  const setup=source.slice(source.indexOf('const route ='),source.indexOf('</script>'));
  async function execute(path: string, server=true) {
    const event=server ? {status:200}:undefined;
    const url=new URL(path,'https://example.test');
    const computed=(fn:()=>any)=>({get value(){return fn();}});
    const context={URL,Response,URLSearchParams,
      useRoute:()=>({fullPath:path,path:url.pathname}),useRequestURL:()=>url,
      useRequestEvent:()=>event,setResponseStatus:(target:typeof event,status:number)=>{assert.ok(target);target.status=status;},
      computed,ref:(value:any)=>({value}),watch:()=>{},useHead:()=>{},onMounted:()=>{},
      selectPage:routes.selectPage,
      useAsyncData:async(_key:any,fn:()=>Promise<any>)=>({data:{value:await fn()}}),
      loadPageData:async()=>({}),
    };
    const js=transformSync('(async()=>{'+setup+'\nreturn selected.value?.id ?? null;})()', {loader:'ts',target:'esnext'}).code;
    const id=await runInNewContext(js,context);
    return {status:event?.status,id};
  }
  test(`Nuxt ${language} unknown and unpublished paths return HTTP 404`,async()=>{
    for(const path of ['/missing','/missing/child?x=1','/draft']) {
      assert.deepEqual(await execute(path),{status:404,id:null});
    }
  });
  test(`Nuxt ${language} authored paths retain HTTP 200`,async()=>{
    for(const [path,id] of [['/','home'],['/about','about'],['/about/?x=1','about']])
      assert.deepEqual(await execute(path),{status:200,id});
  });
  test(`Nuxt ${language} client rendering does not require a server event`,async()=>{
    assert.deepEqual(await execute('/missing',false),{status:undefined,id:null});
    assert.deepEqual(await execute('/about',false),{status:undefined,id:'about'});
  });
}
