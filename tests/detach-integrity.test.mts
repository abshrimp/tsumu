import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useEditor } from '../lib/store';
import { makeBox } from '../lib/presets';
import type { SiteDoc } from '../lib/types';

test('detaching preserves independently configured visibility and identity', () => {
  const doc: SiteDoc = {
    siteName: 'Detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: ['instance'] } },
    components: { c: { id: 'c', name: 'Card', rootId: 'master' } },
    nodes: {
      master: { ...makeBox(), id: 'master', name: 'Card', hiddenOn: ['lg'] },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'c', name: 'Footer card', hiddenOn: ['sm'], locked: true },
    },
  };
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  const detached = after.nodes[after.pages.p.children[0]];
  assert.deepEqual(new Set(detached.hiddenOn), new Set(['lg', 'sm']));
  assert.equal(detached.name, 'Footer card');
  assert.equal(detached.locked, true);
});

test('detach keeps the instance anchor and redirects master references without altering originals', () => {
  const doc: SiteDoc = {
    siteName: 'Detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: ['instance', 'other', 'external'] } },
    components: { c: { id: 'c', name: 'Card', rootId: 'master' } },
    nodes: {
      master: { ...makeBox(), id: 'master', attrId: 'master-card', children: ['child'], locked: true, text: { content: '{master-card}', heading: 0 } },
      child: { ...makeBox(), id: 'child', attrId: 'footer-card', link: { kind: 'url', url: '#master-card' }, scripts: [{ id: 'script', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'step', kind: 'hide', target: 'master-card' }] }] },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'c', attrId: 'footer-card', name: 'Footer' },
      other: { ...makeBox(), id: 'other', type: 'instance', componentId: 'c' },
      external: { ...makeBox(), id: 'external', link: { kind: 'url', url: '#footer-card' } },
    },
  };
  const before = structuredClone(doc);
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  const root = after.nodes[after.pages.p.children[0]];
  assert.equal(root.attrId, 'footer-card');
  assert.equal(root.text!.content, '{footer-card}');
  assert.equal(after.nodes[root.children[0]].link!.url, '#footer-card');
  assert.equal(after.nodes[root.children[0]].attrId, 'footer-card-2');
  const step = after.nodes[root.children[0]].scripts![0].steps[0];
  assert.ok('target' in step);
  assert.equal(step.target, 'footer-card');
  assert.equal(root.hiddenOn, undefined);
  assert.equal(root.locked, undefined, 'master locking must not lock an unlocked instance');
  assert.equal(after.nodes.external.link!.url, '#footer-card');
  assert.deepEqual(after.nodes.master, before.nodes.master);
  assert.deepEqual(after.nodes.other, before.nodes.other);
  assert.deepEqual(doc, before);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
});

test('detach without an instance anchor keeps normal clone ID collision handling', () => {
  const doc: SiteDoc = {
    siteName: 'Detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: ['instance', 'other'] } },
    components: { c: { id: 'c', name: 'Card', rootId: 'master' } },
    nodes: {
      master: { ...makeBox(), id: 'master', attrId: 'card' },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'c' },
      other: { ...makeBox(), id: 'other', type: 'instance', componentId: 'c' },
    },
  };
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  assert.equal(after.nodes[after.pages.p.children[0]].attrId, 'card-2');
});

test('detach in an unused component preserves instance settings and avoids edited-master collisions', () => {
  const doc: SiteDoc = {
    siteName: 'Nested detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: [] } },
    components: {
      outer: { id: 'outer', name: 'Outer', rootId: 'outerRoot' },
      inner: { id: 'inner', name: 'Inner', rootId: 'innerRoot' },
    },
    nodes: {
      outerRoot: { ...makeBox(), id: 'outerRoot', children: ['instance', 'sibling'] },
      sibling: { ...makeBox(), id: 'sibling', attrId: 'nested-anchor-2' },
      innerRoot: { ...makeBox(), id: 'innerRoot', attrId: 'master-anchor', hiddenOn: ['lg'], children: ['child'] },
      child: { ...makeBox(), id: 'child', attrId: 'nested-anchor', link: { kind: 'url', url: '#master-anchor' } },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'inner', attrId: 'nested-anchor', name: 'Nested card', locked: true, hiddenOn: ['sm'] },
    },
  };
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage('p');
  useEditor.getState().setEditingComponent('outer');
  const before = structuredClone(useEditor.getState().doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  const root = after.nodes[after.nodes.outerRoot.children[0]];
  const child = after.nodes[root.children[0]];
  assert.equal(root.attrId, 'nested-anchor');
  assert.equal(root.name, 'Nested card');
  assert.equal(root.locked, true);
  assert.deepEqual(new Set(root.hiddenOn), new Set(['lg', 'sm']));
  assert.equal(child.attrId, 'nested-anchor-3');
  assert.equal(child.link?.url, '#nested-anchor');
  assert.deepEqual(after.nodes.innerRoot, before.nodes.innerRoot);
  assert.deepEqual(after.nodes.sibling, before.nodes.sibling);
  assert.equal(after.nodes.instance, undefined);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
});
