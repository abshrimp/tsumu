import { makeText } from '../../lib/presets';
import { serverSourceDoc } from './server-parent-list-source';

export const serverArrayJoinItems = [{ name: 'Alpha', private: 'SECRET' }, { name: 'Beta', private: 'SECRET' }];
export function serverArrayJoinDoc() {
 const doc = serverSourceDoc();
 doc.pages.p.children = ['reload', 'result'];
 doc.pages.p.pageScripts![0].steps = doc.pages.p.pageScripts![0].steps.slice(0, 1);
 (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = serverArrayJoinItems;
 doc.nodes.reload.scripts![0].steps = [{ id: 'join', kind: 'join', array: 'response', field: 'name', sep: ',', into: 'joined' }];
 doc.nodes.result = { ...makeText('{joined}'), id: 'result', attrId: 'result' };
 return doc;
}
