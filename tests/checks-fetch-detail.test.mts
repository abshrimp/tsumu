import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runChecks} from '../lib/generator/checks';
import {generateProject} from '../lib/generator';
import {pageDataSteps} from '../lib/data';
import type {SiteDoc} from '../lib/types';
function fixture():SiteDoc {
 return {siteName:'Detail',assets:{},nodes:{},pageOrder:['home','detail'],pages:{
  home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
  detail:{id:'detail',name:'Detail',title:'Detail',description:'',slug:'posts/[slug]',children:[],pageScripts:[{id:'load',trigger:'load',pos:{x:0,y:0},steps:[{id:'fetch',kind:'fetch',url:'https://example.com/posts/{slug}',as:'post'}]}]},
 }};
}
const missingData=(doc:SiteDoc)=>runChecks(doc).filter(r=>r.help==='data-detail'&&r.message.includes('does not fetch data'));
test('detail page with a generated server fetch does not warn that no data is fetched',()=>{
 const doc=fixture();
 assert.equal(pageDataSteps(doc,'detail').some(s=>s.kind==='fetch'&&s.as==='post'),true);
 const output=generateProject(doc).files['app/posts/[slug]/page.tsx'];
 assert.match(output,/await fetchJson\(interpolateUrl\("https:\/\/example.com\/posts\/\{slug\}"/);
 assert.deepEqual(missingData(doc),[]);
});
test('detail page without server data still reports the missing-data warning',()=>{
 const doc=fixture();doc.pages.detail.pageScripts=[];
 assert.equal(missingData(doc).length,1);
});
test('empty fetch URL still reports its separate blocking error',()=>{
 const doc=fixture();const step=doc.pages.detail.pageScripts![0].steps[0];
 if(step.kind==='fetch')step.url='';
 assert.ok(runChecks(doc).some(r=>r.level==='error'&&r.help==='data-fetch'));
});
