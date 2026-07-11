import { clientNestedDoc } from './client-nested-lists';

export const linkItems = [
  { name: 'First', profile: { label: 'Global' }, slug: 'global', tags: [{ label: 'red' }] },
  { name: 'Second & space', profile: { label: 'Own' }, slug: 'second', tags: [{ label: 'green' }] },
  { name: null, profile: null, slug: '', tags: [{ label: 'null' }] },
  { name: '', profile: {}, tags: [{ label: 'missing' }] },
  { 'profile.label': 'Literal {name}', tags: [{ label: 'dotted' }] },
  { name: 'Data {label}%7Bname%7D', tags: [{ label: 'data' }] },
];
export function clientLinkDoc(component = false, url = '/products/{name}', items: unknown[] = linkItems) {
  const doc = clientNestedDoc(component);
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = items;
  for (const key of ['name', 'profile', 'slug']) doc.pages.p.pageScripts![0].steps.push({ id: `global-${key}`, kind: 'set-var', value: `{response.0.${key}}`, into: key });
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'fallback', kind: 'split', source: 'Server \\{name}', sep: ',', into: 'fallback' },
    { id: 'private', kind: 'split', source: 'UNUSED_SERVER_PRIVATE', sep: ',', into: 'private' },
  );
  doc.nodes.detail.link = { kind: 'url', url };
  return doc;
}
