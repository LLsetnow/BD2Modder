'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Project } = require('../app/project.cjs');
const sample = path.resolve(__dirname, '../../../mods/10 Common Characters 常用角色/Blade 布莱德/Blade小公主 技能 战损');
test('real Blade MOD parses in the 4.1 runtime and every animation produces finite mesh vertices', async t => {
  if (!await fs.access(sample).then(() => true, () => false)) return t.skip('User sample is not available on this machine');
  const spine = await import('@esotericsoftware/spine-core'); const p = new Project(sample); const descriptor = await p.load();
  const before = crypto.createHash('sha256').update(await fs.readFile(path.join(sample, p.atlasName))).digest('hex');
  const atlas = new spine.TextureAtlas(descriptor.atlasText);
  for (const page of atlas.pages) page.setTexture({ getImage: () => ({ width: page.width, height: page.height }), setFilters() {}, setWraps() {}, dispose() {} });
  const compat = await import('../renderer/spine-compat.mjs'); compat.fixAtlasRotations(atlas);
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(Buffer.from(descriptor.skeletonBytes).toString('utf8')));
  compat.fixQuadRotations(data, spine.RegionAttachment);
  assert.equal(data.version, '4.1.24'); assert.equal(data.animations.length, 4); assert.equal(atlas.regions.length, 260);
  for (const r of atlas.regions) {
    const width = r.degrees % 180 ? r.height : r.width, height = r.degrees % 180 ? r.width : r.height;
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + width <= r.page.width && r.y + height <= r.page.height, r.name);
    const stored = p.regions.get(JSON.stringify([r.page.name, r.name])); assert.deepEqual(stored, { page: r.page.name, name: r.name, x: r.x, y: r.y, width, height });
  }
  const skeleton = new spine.Skeleton(data), state = new spine.AnimationState(new spine.AnimationStateData(data));
  for (const animation of data.animations) {
    state.setAnimation(0, animation.name, true); let totalVertices = 0;
    for (let frame = 0; frame < 20; frame++) {
      state.update(animation.duration / 20); state.apply(skeleton); skeleton.updateWorldTransform();
      for (const slot of skeleton.drawOrder) {
        const a = slot.getAttachment(); let v;
        if (a instanceof spine.MeshAttachment) { v = new Float32Array(a.worldVerticesLength); a.computeWorldVertices(slot, 0, v.length, v, 0, 2); }
        else if (a instanceof spine.RegionAttachment) { v = new Float32Array(8); a.computeWorldVertices(slot, v, 0, 2); }
        if (v) { assert.ok([...v].every(Number.isFinite), animation.name + '/' + slot.data.name); totalVertices += v.length; }
      }
    }
    assert.ok(totalVertices > 0, animation.name);
  }
  assert.equal(p.dirty(), false); assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(sample, p.atlasName))).digest('hex'), before);
});
test('quarter-turn atlas packing preserves quad UV corners and stored rectangle dimensions', async () => {
  const spine = await import('@esotericsoftware/spine-core'), compat = await import('../renderer/spine-compat.mjs');
  for (const degrees of [0, 90, 180, 270]) {
    const atlas = new spine.TextureAtlas(`page.png\nsize:8,8\nfilter:Linear,Linear\npart\nbounds:1,2,2,3\nrotate:${degrees}\n`); compat.fixAtlasRotations(atlas);
    const page = atlas.pages[0]; page.setTexture({ getImage: () => ({ width: 8, height: 8 }), setFilters() {}, setWraps() {}, dispose() {} });
    const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData({ skeleton: { spine: '4.1.24' }, bones: [{ name: 'root' }], slots: [{ name: 'slot', bone: 'root', attachment: 'part' }], skins: [{ name: 'default', attachments: { slot: { part: { width: 2, height: 3 } } } }] });
    compat.fixQuadRotations(data, spine.RegionAttachment); const r = atlas.regions[0], attachment = data.defaultSkin.getAttachment(0, 'part');
    const points = [[r.u, r.v2], [r.u, r.v], [r.u2, r.v], [r.u2, r.v2]], shift = degrees / 90;
    for (let i = 0; i < 4; i++) { const p = points[(i - shift + 4) % 4]; assert.equal(attachment.uvs[i * 2], p[0]); assert.equal(attachment.uvs[i * 2 + 1], p[1]); }
    assert.equal(compat.regionRect(r).width, degrees % 180 ? 3 : 2); assert.equal(compat.regionRect(r).height, degrees % 180 ? 2 : 3);
  }
});
