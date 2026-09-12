import { makeMedia, makeEmbed } from '../../lib/presets';
import { clientImageDoc } from './client-image-scope';

export const literalItems = [{ name: 'First', tags: [{}] }, { name: 'Second', tags: [{}] }, { tags: [{}] }];
export const literalText = 'Literal {name} / \\{name} / {missing} / %7Bname%7D';
export const literalSource = 'https://example.com/{name}/\\{name}/{missing}/%7Bname%7D';

export const literalEmbed = 'https://example.com/?literal={name}&escaped=\\{name}&missing={missing}&encoded=%7Bname%7D';

export function clientLiteralAttributesDoc(component = false) {
  const doc = clientImageDoc(component, '/images/{name}.png');
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = literalItems;
  // ページの同じ名前の変数も、存在しない項目のキーも、リテラルの属性に影響しない。
  doc.nodes.picture.image!.alt = literalText;
  doc.assets.svg = { id: 'svg', name: 'shadow.svg', path: 'assets/shadow.svg', mimeType: 'image/svg+xml', width: 120, height: 40, svgFilter: true };
  doc.nodes.svg = { ...structuredClone(doc.nodes.picture), id: 'svg', attrId: 'svg', image: { ...doc.nodes.picture.image!, assetId: 'svg', width: 120, height: 40 } };
  for (const kind of ['audio', 'video'] as const) doc.nodes[kind] = {
    ...makeMedia(kind), id: kind, attrId: kind, media: { kind, src: literalSource },
  };
  // この回帰テストは、属性の保存を検証する。音声の既定の height:auto による縮小とは切り分ける。
  doc.nodes.audio.styles.base!.default!.height = "54px";
  doc.nodes.frame = { ...makeEmbed('url'), id: 'frame', attrId: 'frame', embed: { kind: 'url', src: literalEmbed } };
  doc.nodes.row.children.push('svg', 'audio', 'video', 'frame');
  return doc;
}
