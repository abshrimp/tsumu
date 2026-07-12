import { createInitialDoc, makeBox, makeMedia } from '../../lib/presets';

export const audioSource = 'https://example.com/default-audio.wav';

export function defaultAudioDoc(component = false) {
  const doc = createInitialDoc();
  const audio = { ...makeMedia('audio'), id: 'audio', attrId: 'audio' };
  doc.nodes = { audio };
  doc.pages = { p: { id: 'p', name: 'Audio', slug: '', title: 'Audio', description: '', children: ['audio'] } };
  doc.pageOrder = ['p'];
  doc.components = {};
  if (component) {
    doc.nodes.master = { ...makeBox(), id: 'master', children: ['audio'] };
    doc.nodes.instance = { ...makeBox(), id: 'instance', type: 'instance', componentId: 'player' };
    doc.components.player = { id: 'player', name: 'Player', rootId: 'master' };
    doc.pages.p.children = ['instance'];
  }
  return doc;
}
