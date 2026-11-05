import { makeText } from '../../lib/presets';
import { clientNestedDoc } from './client-nested-lists';
import type { FieldContent } from '../../lib/types';
export const fieldItems = [{ name: 'First', tags: [{ label: 'red' }] }, { name: 'Second', tags: [{ label: 'green' }] }];
export function clientFieldDoc(component = false) {
  const doc = clientNestedDoc(component);
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = fieldItems;
  doc.pages.p.pageScripts![0].steps.push({ id: 'global-name', kind: 'set-var', value: '{response.0.name}', into: 'name' });
  const add = (id: string, field: FieldContent) => {
    doc.nodes[id] = { ...makeText(''), id, attrId: id, type: 'field', text: null, field };
    doc.nodes.row.children.push(id);
  };
  add('entry', { kind: 'input', inputType: 'text', placeholder: 'Find {name}', defaultValue: 'Edit {name}' });
  add('memo', { kind: 'textarea', placeholder: 'Find {name}', defaultValue: 'Edit {name}' });
  add('choice', { kind: 'select', options: ['Other', 'Edit {name}'], defaultValue: 'Edit {name}' });
  add('radio', { kind: 'radio', label: 'Edit {name}', group: 'selection' });
  add('box', { kind: 'checkbox', label: 'Edit {name}' });
  add('submit', { kind: 'submit', label: 'Edit {name}' });
  return doc;
}
