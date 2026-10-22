import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { generateExportProject, prepareExportProject } from '../lib/export-formats';
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
  const js=transformSync('(async()=>{'+setup+'\nreturn selected.value?.id ?? null;})()', {loader:'ts',target:'esnext'}).code;
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

const previewDoc: SiteDoc = {
  siteName: "Preview site", nodes: {}, assets: {}, pageOrder: ["home", "nested"],
  pages: {
    home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: [] },
    nested: { id: "nested", name: "Nested", title: "Nested", description: "", slug: "guides/start", children: [] },
  },
};

function configOf(source: string) {
  const module = { exports: {} as { default?: any } };
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  new Function("defineNuxtConfig", "require", "module", "exports", code)(
    (config: unknown) => config,
    (name: string) => {
      assert.equal(name, "@tailwindcss/vite");
      return () => ({ name: "tailwindcss" });
    }, module, module.exports,
  );
  return module.exports.default;
}

for (const language of ["typescript", "javascript"] as const) {
  for (const style of ["css", "css-modules", "tailwind"] as const) {
    for (const target of ["test", "production"] as const) {
      test(`Nuxt ${language}/${style}: ${target} head preserves publishing robots policy`, async () => {
        const options = { framework: "nuxt", language, style, scope: "project" } as const;
        const { files } = await prepareExportProject(previewDoc, options, target);
        const config = configOf(files[`nuxt.config.${language === "typescript" ? "ts" : "js"}`]);
        const robots = config.app.head.meta.filter((entry: { name: string }) => entry.name === "robots");
        assert.deepEqual(robots, target === "test"
          ? [{ name: "robots", content: "noindex, nofollow, noarchive, nosnippet, noimageindex" }]
          : []);
        assert.equal(config.app.head.title, previewDoc.siteName);
        assert.ok(files["app/pages/index.vue"]);
        assert.ok(files["app/pages/[...slug].vue"], "global head covers nested pages too");
        if (target === "test") {
          assert.equal(files["public/robots.txt"], "User-agent: *\nDisallow: /\n");
          assert.match(files["public/_headers"], /X-Robots-Tag: noindex/);
        }
      });
    }
  }
}
