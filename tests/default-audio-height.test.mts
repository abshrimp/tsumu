import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCanvasCss } from '../components/canvas/css';
import { generateSiteCss } from '../lib/generator/css';
import { generateProject } from '../lib/generator';
import { defaultAudioDoc, audioSource } from './helpers/default-audio';

const audioRule = (css: string) => css.match(/(?:[^{}]*\[data-node="audio"\][^{}]*|\.audio)\s*\{([^}]*)\}/)?.[1] ?? '';
for (const component of [false, true]) {
  for (const mode of ['design', 'preview', 'export'] as const) {
    const cssFor = (doc: ReturnType<typeof defaultAudioDoc>, bp = 'base') => mode === 'export'
      ? generateSiteCss(doc, new Map(Object.keys(doc.nodes).map(id => [id, id])), new Map())
      : buildCanvasCss(doc, doc.pages.p.children, bp, mode, 'audio', 'default');
    test(`${component ? 'component' : 'page'} ${mode} preserves native audio height without mutating saved styles`, () => {
      const doc = defaultAudioDoc(component); doc.nodes.audio.media!.src = audioSource;
      const before = structuredClone(doc);
      const rule = audioRule(cssFor(doc));
      assert.match(rule, /width: 100%;/);
      assert.match(rule, /max-width: 480px;/);
      assert.doesNotMatch(rule, /(?:^|[;\s])height:/);
      assert.deepEqual(doc, before);
    });
    for (const height of ['72px', 'auto', '0px']) test(`${component ? 'component' : 'page'} ${mode} retains explicit audio height ${height}`, () => {
      const doc = defaultAudioDoc(component);
      doc.nodes.audio.styles.base!.default!.height = height;
      assert.ok(audioRule(cssFor(doc)).includes(`height: ${height};`));
    });
    test(`${component ? 'component' : 'page'} ${mode} preserves responsive and custom audio heights`, () => {
      const doc = defaultAudioDoc(component);
      doc.nodes.audio.styles.lg = { default: { height: '64px', width: '80%' } };
      doc.nodes.audio.customCss = 'height: 76px';
      const css = cssFor(doc, 'lg');
      assert.match(css, /height: 64px;/);
      assert.match(css, /height: 76px;/);
      assert.match(css, /width: 80%;/);
    });
    for (const kind of ['video', 'image'] as const) test(`${component ? 'component' : 'page'} ${mode} keeps ${kind} height reset`, () => {
      const doc = defaultAudioDoc(component);
      if (kind === 'video') doc.nodes.audio.media!.kind = 'video';
      else doc.nodes.audio.type = 'image';
      assert.match(audioRule(cssFor(doc)), /height: auto;/);
    });
  }
  test(`${component ? 'component' : 'page'} generated project omits synthetic audio height`, () => {
    const doc = defaultAudioDoc(component); doc.nodes.audio.media!.src = audioSource;
    const { files } = generateProject(doc);
    const markup = Object.values(files).filter(code => code.includes('<audio')).join('\n');
    assert.match(markup, /controls/);
    const cls = markup.match(/<audio[\s\S]*?className="([^"]+)"/)?.[1];
    assert.ok(cls);
    const body = files['styles/site.css'].match(new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}'))?.[1];
    assert.ok(body);
    assert.doesNotMatch(body, /(?:^|[;\s])height:/);
  });
}
