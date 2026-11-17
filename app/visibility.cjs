'use strict';
// Resolve region identities against the atlas; never trust rectangles sent by the UI.
function atlasRegions(text, pages) {
  const regions = new Map(); let page = null, current = null;
  const finish = () => {
    if (!current) return;
    const { name, values } = current, bounds = values.bounds || [...(values.xy || []), ...(values.size || [])];
    const rotate = values.rotate?.[0], rotation = rotate === 'true' ? 90 : !rotate || rotate === 'false' ? 0 : Number(rotate);
    const [x, y, w, h] = bounds.map(Number), swap = rotation === 90 || rotation === 270;
    const width = swap ? h : w, height = swap ? w : h, size = pages.get(page);
    if (![0, 90, 180, 270].includes(rotation) || ![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > size.width || y + height > size.height) throw Error('图集部件范围无效：' + name);
    const key = JSON.stringify([page, name]); if (regions.has(key)) throw Error('图集部件名称重复：' + name);
    regions.set(key, { page, name, x, y, width, height }); current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) { finish(); page = null; continue; }
    const colon = line.indexOf(':');
    if (colon !== -1) { if (current) current.values[line.slice(0, colon)] = line.slice(colon + 1).split(',').map(s => s.trim()); continue; }
    finish();
    if (!page) { if (!pages.has(line)) throw Error('图集页不存在：' + line); page = line; }
    else current = { name: line, values: {} };
  }
  finish(); return regions;
}
const partKey = part => JSON.stringify([part.page, part.name]);
const hiddenSignature = parts => JSON.stringify([...parts].map(partKey).sort());
module.exports = { atlasRegions, partKey, hiddenSignature };
