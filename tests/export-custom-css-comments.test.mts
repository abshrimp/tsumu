import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { generateSiteCss } from '../lib/generator/css';
import { buildCanvasCss } from '../components/canvas/css';
import { makeBox } from '../lib/presets';
import type { SiteDoc } from '../lib/types';
const postcss=createRequire(import.meta.url)('postcss');
function css(source:string) {
  const doc:SiteDoc={siteName:'Comments',assets:{},pageOrder:['p'],pages:{p:{id:'p',name:'P',title:'P',description:'',slug:'',children:['box']}},nodes:{box:{...makeBox(),id:'box',customCss:source}}};
  return { exported:generateSiteCss(doc,new Map([['box','box']]),new Map()),
    canvas:buildCanvasCss(doc,['box'],'base','preview',null,'default') };
}
function declarations(source:string) {
  const result:Record<string,string>={};
  postcss.parse(source).walkDecls((decl:any)=>{result[decl.prop]=decl.value;});
  return result;
}
for(const source of [
  'color:red; /* note */ background:blue;',
  '/* punctuation ; : ) \' */ color:red; /* more */ background:blue;',
  'color:/* ; ) " */red; background:blue;',
  'color /* property note */ : red; background: blue;',
  String.raw`color:red; --literal: \/*not-comment*/; background:blue;`,
  'color:red; content:"/* keep ; quote */"; background:blue;',
]) test(`export preserves commented custom declarations: ${source}`,()=>{
  const actual=css(source);
  const expected=declarations(actual.canvas),result=declarations(actual.exported);
  assert.equal(result.color,expected.color);
  assert.equal(result.background,expected.background);
  if(source.includes('--literal:'))assert.equal(result['--literal'],expected['--literal']);
  if(source.includes('content:'))assert.equal(result.content,expected.content);
});
test('comment tokens do not make rule-breaking custom declarations valid',()=>{
  const result=css('color: red; /* note */ background: blue; bad property: x; content: "</style><script>x</script>";');
  assert.equal(declarations(result.exported).background,'blue');
  assert.doesNotMatch(result.exported,/bad property|<\/style>|<script>/);
});
