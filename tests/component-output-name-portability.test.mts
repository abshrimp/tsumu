import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildComponentNames } from '../lib/generator/names';
import { generateExportProject } from '../lib/export-formats';
import { makeBox } from '../lib/presets';
import type { SiteDoc } from '../lib/types';
function fixture(names:string[]):SiteDoc {
  const doc:SiteDoc={siteName:'Components',assets:{},nodes:{},components:{},pageOrder:['p'],pages:{p:{id:'p',name:'Home',title:'Home',description:'',slug:'',children:[]}}};
  names.forEach((name,i)=>{
    const id='component'+i,rootId='root'+i,instance='instance'+i;
    doc.components![id]={id,name,rootId};
    doc.nodes[rootId]={...makeBox(),id:rootId};
    doc.nodes[instance]={...makeBox(),id:instance,type:'instance',componentId:id};
    doc.pages.p.children.push(instance);
  });
  return doc;
}
for(const names of [['Hero','HERO','Hero2','hero'],['Con','Aux','NUL','COM1','Lpt9','Prn'],['image','IMAGE','Page','PAGE','page2']]) {
  test(`component output names remain portable: ${names.join(',')}`,()=>{
    const doc=fixture(names),assigned=[...buildComponentNames(doc).values()];
    assert.equal(new Set(assigned.map(n=>n.toLowerCase())).size,names.length);
    assert.ok(assigned.every(n=>!/^(con|aux|nul|com[1-9]|lpt[1-9]|prn)$/i.test(n)));
    for(const framework of ['nextjs','react'] as const) {
      const {files}=generateExportProject(doc,{framework,language:'typescript',style:'css',scope:'project'});
      const prefix=framework==='nextjs'?'components/':'src/components/';
      for(const name of assigned)assert.ok(files[prefix+name+'.tsx'],`${framework}: ${name}`);
      const page=Object.entries(files).find(([p])=>framework==='nextjs'?p==='app/page.tsx':p==='src/pages/Page0.tsx')![1];
      for(const name of assigned)assert.ok(page.includes('/components/'+name),`${framework}: import ${name}`);
    }
    assert.deepEqual(Object.values(doc.components!).map(c=>c.name),names,'authored names remain unchanged');
  });
}
test('ordinary readable component names retain stable output',()=>{
  assert.deepEqual([...buildComponentNames(fixture(['Hero','Footer','Call to action'])).values()],['Hero','Footer','CallToAction']);
});

test('long component labels export with bounded unique filenames and matching imports',()=>{
  const names=['A'.repeat(300),'A'.repeat(299)+'B','a'.repeat(300)];
  const doc=fixture(names),assigned=[...buildComponentNames(doc).values()];
  assert.deepEqual(assigned,['A'.repeat(120),'A'.repeat(120)+'2','A'+'a'.repeat(119)+'3']);
  for(const framework of ['nextjs','react'] as const) {
    const {files}=generateExportProject(doc,{framework,language:'typescript',style:'css',scope:'project'});
    const prefix=framework==='nextjs'?'components/':'src/components/';
    const page=files[framework==='nextjs'?'app/page.tsx':'src/pages/Page0.tsx'];
    for(const name of assigned) {
      assert.ok(files[prefix+name+'.tsx']);
      assert.ok(page.includes('/components/'+name));
      assert.ok(new TextEncoder().encode(name+'.tsx').length<=255);
    }
  }
  assert.deepEqual(Object.values(doc.components!).map(c=>c.name),names);
});
