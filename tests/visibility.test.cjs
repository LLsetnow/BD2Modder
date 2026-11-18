'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PNG } = require('pngjs');
const { unzipSync } = require('fflate');
const { Project } = require('../app/project.cjs');
const { edit, encodeBytes, decodeBytes } = require('../app/texture.cjs');
const { atlasRegions, partKey } = require('../app/visibility.cjs');
function image() { const p = new PNG({ width: 8, height: 8 }); for (let i = 0; i < p.data.length; i += 4) p.data.set([40, 80, 120, 255], i); return PNG.sync.write(p); }
async function fixture(t, bytes = false, skeleton = { bones: [{ name: 'root' }] }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bdmodder-visibility-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'mod'); await fs.mkdir(folder); const original = image();
  const header = Buffer.alloc(16); header.writeInt32LE(3, 8);
  for (const page of ['one', 'two']) await fs.writeFile(path.join(folder, page + (bytes ? '.png.bytes' : '.png')), bytes ? encodeBytes(original, header) : original);
  await fs.writeFile(path.join(folder, 'test.atlas'), 'one.png\nsize:8,8\nfilter:Linear,Linear\nfirst\nbounds:1,2,2,3\nrotate:90\nneighbor\nbounds:2,2,2,1\n\ntwo.png\nsize:8,8\nfilter:Linear,Linear\nsecond\nbounds:0,0,2,2\n');
  await fs.writeFile(path.join(folder, 'test.json'), JSON.stringify(skeleton));
  await fs.writeFile(path.join(folder, 'test.modfile'), '{"version":2,"type":"loop"}');
  const p = new Project(folder); await p.load(); return { p, root, folder, original };
}
const parts = [{ page: 'one.png', name: 'first' }, { page: 'two.png', name: 'second' }];
function assertCleared(bytes, original, rect) {
  const actual = PNG.sync.read(Buffer.from(bytes)), before = PNG.sync.read(original);
  for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
    const i = (y * actual.width + x) * 4;
    assert.deepEqual(actual.data.subarray(i, i + 4), x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height ? Buffer.alloc(4) : before.data.subarray(i, i + 4), `pixel ${x},${y}`);
  }
}
test('multi-page hiding is one undo operation and does not destroy editable pixels', async t => {
  const { p, original } = await fixture(t);
  const result = p.setVisibility(parts, true); assert.equal(result.hiddenParts.length, 2); assert.equal(result.dirty, true); assert.equal(p.history.length, 1);
  p.setVisibility(parts, true); assert.equal(p.history.length, 1);
  assert.deepEqual(p.page('one.png').bytes, original);
  assertCleared(await p.renderedPage('one.png'), original, { x: 1, y: 2, width: 3, height: 2 });
  p.undo(); assert.equal(p.hiddenParts.size, 0); assert.equal(p.dirty(), false); assert.deepEqual(await p.renderedPage('one.png'), original);
  p.undo(true); assert.equal(p.hiddenParts.size, 2);
  assert.throws(() => p.setVisibility([...parts, { page: 'one.png', name: 'missing' }], true), /不存在/); assert.equal(p.history.length, 1);
});
test('showing preserves color edits and invalidates cached scene textures through undo/redo', async t => {
  const { p } = await fixture(t); const rect = p.regions.get(partKey(parts[0]));
  await p.mutate('one.png', 'tint', [rect], { color: '#ff0000', strength: 1 }); const colored = p.page('one.png').bytes;
  p.setVisibility([parts[0]], true); const hidden = await p.renderedPage('one.png'); assert.notDeepEqual(hidden, colored);
  p.setVisibility([parts[0]], false); assert.deepEqual(await p.renderedPage('one.png'), colored);
  p.undo(); assert.deepEqual(await p.renderedPage('one.png'), hidden); p.undo(); assert.deepEqual(await p.renderedPage('one.png'), colored);
  p.undo(true); assert.deepEqual(await p.renderedPage('one.png'), hidden);
});
test('legacy hidden records gray and clear just the rotated UV footprint, including on export', async t => {
  const skeleton = {
    skeleton: { spine: '4.1.24' },
    bones: [{ name: 'root' }],
    slots: [{ name: 'first', bone: 'root', attachment: 'first' }, { name: 'neighbor', bone: 'root', attachment: 'neighbor' }],
    skins: [{ name: 'default', attachments: {
      first: { first: { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices: [0, 0, 2, 0, 0, 3], hull: 3 } },
      neighbor: { neighbor: { width: 2, height: 1 } }
    } }]
  };
  const { folder, original } = await fixture(t, false, skeleton);
  await fs.writeFile(path.join(folder, '.bdmodder-editor.json'), JSON.stringify({ version: 1, hiddenParts: [parts[0]] }));
  const project = new Project(folder);
  await project.load();
  assert.equal(project.dirty(), false);
  const gray = PNG.sync.read(await project.renderedPage('one.png', { gray: true }));
  const cleared = await project.renderedPage('one.png');
  const visible = PNG.sync.read(cleared);
  const source = PNG.sync.read(original);
  const footprint = new Set(['1,2', '1,3', '2,3']);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = (y * 8 + x) * 4;
    const hidden = footprint.has(`${x},${y}`);
    const rgba = source.data.subarray(offset, offset + 4);
    assert.deepEqual(visible.data.subarray(offset, offset + 4), hidden ? Buffer.alloc(4) : rgba);
    assert.deepEqual(gray.data.subarray(offset, offset + 4), hidden ? Buffer.from([48, 48, 48, 255]) : rgba);
  }
  const entries = unzipSync(await project.zip());
  assert.deepEqual(Buffer.from(entries['mod/one.png']), cleared);
  assert.deepEqual(await fs.readFile(path.join(folder, 'one.png')), original);
  project.setVisibility([parts[0]], false);
  assert.deepEqual(await project.renderedPage('one.png', { gray: true }), original);
  project.undo();
  assert.deepEqual(await project.renderedPage('one.png'), cleared);
});
test('save and reopen retain recoverable hidden state; exported ZIP and folder contain cleared pixels only', async t => {
  const { p, root, folder, original } = await fixture(t); p.setVisibility(parts, true); await p.save(); assert.equal(p.dirty(), false);
  assert.deepEqual(await fs.readFile(path.join(folder, 'one.png')), original);
  const reopened = new Project(folder); await reopened.load(); assert.equal(reopened.hiddenParts.size, 2); assert.equal(reopened.dirty(), false);
  const entries = unzipSync(await reopened.zip()); assert.equal(Object.keys(entries).some(name => name.includes('.bdmodder')), false);
  assertCleared(entries['mod/one.png'], original, { x: 1, y: 2, width: 3, height: 2 }); assertCleared(entries['mod/two.png'], original, { x: 0, y: 0, width: 2, height: 2 });
  assert.deepEqual(Buffer.from(entries['mod/test.atlas']), await fs.readFile(path.join(folder, 'test.atlas')));
  const output = path.join(root, 'exported'); await reopened.saveAs(output); const baked = new Project(output); await baked.load(); assert.equal(baked.hiddenParts.size, 0);
  assertCleared(baked.page('one.png').bytes, original, { x: 1, y: 2, width: 3, height: 2 });
  p.undo(); assert.equal(p.dirty(), true); await p.save(); assert.equal((await new Project(folder).load()).hiddenParts.length, 0);
});
test('hidden metadata conflicts do not overwrite external changes', async t => {
  const { p, folder } = await fixture(t); p.setVisibility(parts, true); await p.save();
  const external = '{"version":1,"hiddenParts":[]}'; await fs.writeFile(path.join(folder, '.bdmodder-editor.json'), external); p.setVisibility(parts, false);
  await assert.rejects(p.save(), /其他程序/); assert.equal(await fs.readFile(path.join(folder, '.bdmodder-editor.json'), 'utf8'), external);
});
test('Unity RGB textures gain transparent RGBA pixels on hidden MOD export', async t => {
  const { p, original } = await fixture(t, true); p.setVisibility([parts[0]], true); const entries = await p.materialize();
  assertCleared(decodeBytes(entries['one.png.bytes']), original, { x: 1, y: 2, width: 3, height: 2 });
  assert.deepEqual(decodeBytes(entries['two.png.bytes']), original);
});
test('legacy xy/size and all four atlas rotations resolve stored rectangles safely', () => {
  for (const angle of [0, 90, 180, 270, 'true', 'false']) {
    const region = [...atlasRegions(`page.png\nsize:8,8\npart\n  rotate: ${angle}\n  xy: 1, 2\n  size: 2, 3\n`, new Map([['page.png', { width: 8, height: 8 }]])).values()][0];
    assert.equal(region.width, [90, 270, 'true'].includes(angle) ? 3 : 2); assert.equal(region.height, [90, 270, 'true'].includes(angle) ? 2 : 3);
  }
  assert.throws(() => atlasRegions('page.png\npart\nbounds:7,7,2,2', new Map([['page.png', { width: 8, height: 8 }]])), /范围/);
});
