import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { generateProject } from '../lib/generator';
import { makeBox } from '../lib/presets';
import type { SiteDoc } from '../lib/types';

test('live fields initialize after client navigation without requiring typing', () => {
  const doc: SiteDoc = { siteName: 'Live navigation', pages: {}, pageOrder: ['a', 'b'], nodes: {}, assets: {} };
  for (const id of doc.pageOrder) {
    doc.pages[id] = { id, name: id, slug: id === 'a' ? '' : 'second', title: id, description: '', children: [id + 'field', id + 'text', id + 'dependent'] };
    doc.nodes[id + 'field'] = { ...makeBox(), id: id + 'field', type: 'field', attrId: 'name', field: { kind: 'input', defaultValue: id === 'a' ? 'Alice' : 'Bob' } };
    doc.nodes[id + 'dependent'] = { ...makeBox(), id: id + 'dependent', type: 'field', attrId: 'dependent', field: { kind: 'input', placeholder: 'For {name}', defaultValue: '{name}' } };
    doc.nodes[id + 'text'] = { ...makeBox(), id: id + 'text', text: { content: 'Hello {name}', heading: 0 } };
  }
  const { files } = generateProject(doc);
  assert.match(files['app/second/page.tsx'], /data-live=/);
  let mutation: (() => void) | undefined;
  const frames: Array<() => void> = [];
  let pid = 'a';
  let input = { value: 'Alice', type: 'text', matches: () => true };
  const text = () => ({ firstChild: { nodeType: 3, nodeValue: 'Hello ' }, getAttribute: () => 'Hello {name}' });
  let output = text();
  const dependent = () => ({ value: '', placeholder: '', edited: false, setAttribute(name: string) { if (name === 'data-edited') this.edited = true; }, hasAttribute(name: string) { return name === 'data-edited' && this.edited; }, getAttribute: (name: string) => name === 'data-live-placeholder' ? 'For {name}' : '{name}' });
  let field = dependent();
  const listeners = new Map<string, Function>();
  const root = {
    querySelector: (selector: string) => selector === '[data-page-body]' ? { getAttribute: () => pid } : null,
    querySelectorAll: (selector: string) => selector === '#name' ? [input] : selector === '[data-live]' ? [output] : selector === '[data-live-placeholder]' || selector === '[data-live-value]' ? [field] : [],
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    removeEventListener: () => {},
  };
  let observedOptions: unknown;
  runInNewContext(files['public/scripts.js'], {
    document: root, CSS: { escape: (s: string) => s }, location: { search: '' }, URLSearchParams,
    MutationObserver: class { constructor(fn: () => void) { mutation = fn; } observe(_root: unknown, options: unknown) { observedOptions = options; } disconnect() {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
  });
  assert.equal(output.firstChild.nodeValue, 'Hello Alice');
  assert.equal(field.value, 'Alice');
  assert.equal(field.placeholder, 'For Alice');
  // Next Link replaces the page DOM while the layout's next/script remains mounted.
  pid = 'b'; input = { value: 'Bob', type: 'text', matches: () => true }; output = text(); field = dependent();
  mutation?.();
  while (frames.length) frames.shift()!();
  assert.equal(output.firstChild.nodeValue, 'Hello Bob');
  assert.equal(field.value, 'Bob');
  assert.equal(field.placeholder, 'For Bob');
  // Later mutation scans must preserve a value the visitor already edited.
  field.value = 'Custom'; listeners.get('input')!({ target: field, isTrusted: true });
  assert.equal(field.edited, true);
  mutation?.();
  while (frames.length) frames.shift()!();
  assert.equal(field.value, 'Custom');
  // Subsequent ordinary editing still updates the new page.
  input.value = 'Bobby'; listeners.get('input')!({ target: input, isTrusted: false });
  assert.equal(output.firstChild.nodeValue, 'Hello Bobby');
  assert.equal(field.placeholder, 'For Bobby');
  assert.equal(field.value, 'Custom');
  assert.equal(JSON.stringify(observedOptions), JSON.stringify({ childList: true, subtree: true, attributes: true, attributeFilter: ['data-scripts', 'data-page-body'] }));
});
