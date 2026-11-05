import { makeText } from '../../lib/presets';
import { clientNestedDoc } from './client-nested-lists';

export const imageItems = [
  { name: 'First', tags: [{ label: 'red' }] },
  { name: 'Second', tags: [{ label: 'green' }] },
];
export function clientImageDoc(component = false, src = '/images/{name}.png') {
  const doc = clientNestedDoc(component);
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = imageItems;
  doc.pages.p.pageScripts![0].steps.push({ id: 'global-name', kind: 'set-var', value: '{response.0.name}', into: 'name' });
  doc.nodes.picture = { ...makeText(''), id: 'picture', attrId: 'picture', type: 'image', text: undefined,
    image: { src, alt: 'Row image', width: 20, height: 30 } };
  doc.nodes.row.children.push('picture');
  return doc;
}
