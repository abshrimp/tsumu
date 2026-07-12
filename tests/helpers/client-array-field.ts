import { makeText } from '../../lib/presets';
import { clientScriptFixture } from './client-script-scope';

export function clientArrayFieldFixture(component = false) {
  const { doc, items } = clientScriptFixture(component, [
    { name: 'First {label}', payload: [{ label: 'Raw {name}' }], tags: [{ label: 'red' }] },
    { name: 'Second', payload: false, tags: [{ label: 'green' }] },
  ]);
  doc.nodes.reload.scripts![0].steps.push({ id: 'targets', kind: 'set-var', value: '{response}', into: 'targets' });
  doc.nodes.act.scripts![0].steps = [
    { id: 'field', kind: 'array-field', array: 'targets', field: 'copied', value: '{name}' },
    { id: 'payload', kind: 'array-field', array: 'targets', field: 'raw', value: '{payload}' },
    { id: 'read', kind: 'set-var', value: '{targets.0.copied}|{targets.1.copied}', into: 'chosen' },
    { id: 'read-raw', kind: 'set-var', value: '{targets.0.raw.0.label}|{targets.1.raw}', into: 'rawChosen' },
  ];
  doc.nodes['raw-result'].text!.content = '{rawChosen}';
  doc.nodes.entry = { ...makeText(''), id: 'entry', attrId: 'entry', type: 'field', field: { kind: 'input', inputType: 'text' } };
  doc.nodes.change = { ...makeText('Change'), id: 'change', attrId: 'change', semantic: 'button', scripts: [{
    id: 'change', trigger: 'click', pos: { x: 0, y: 0 }, steps: [{ id: 'counter', kind: 'set-var', into: 'counter', value: '7' }],
  }] };
  doc.nodes.row.children.push('entry'); doc.pages.p.children.push('change');
  return { doc, items };
}
