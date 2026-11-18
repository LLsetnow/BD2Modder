// Spine 4.1's TS atlas/quad readers handle 90° packing specially but omit 270°/180°.
// Keep these extensions outside the dependency so installation remains reproducible.
export function fixAtlasRotations(atlas) {
  for (const region of atlas.regions) if (region.degrees === 270) { region.u2 = (region.x + region.height) / region.page.width; region.v2 = (region.y + region.width) / region.page.height; }
}
export function fixQuadRotations(data, RegionAttachment) {
  for (const skin of data.skins) for (const entry of skin.getAttachments()) {
    const attachment = entry.attachment; if (!(attachment instanceof RegionAttachment) || attachment.bdRotationPatched) continue;
    const update = attachment.updateRegion;
    attachment.updateRegion = function () {
      update.call(this); const r = this.region; if (r.degrees !== 180 && r.degrees !== 270) return;
      const points = [[r.u, r.v2], [r.u, r.v], [r.u2, r.v], [r.u2, r.v2]], shift = r.degrees / 90;
      for (let i = 0; i < 4; i++) { const p = points[(i - shift + 4) % 4]; this.uvs[i * 2] = p[0]; this.uvs[i * 2 + 1] = p[1]; }
    };
    attachment.bdRotationPatched = true; attachment.updateRegion();
  }
}
export function regionRect(region) { return { name: region.name, page: region.page.name, x: region.x, y: region.y, width: region.degrees % 180 ? region.height : region.width, height: region.degrees % 180 ? region.width : region.height, rotation: region.degrees }; }

export function readSpineData(spine, atlas, { skeletonName, skeletonBytes }) {
  const loader = new spine.AtlasAttachmentLoader(atlas);
  const json = skeletonName.toLowerCase().endsWith('.json');
  const parser = json ? new spine.SkeletonJson(loader) : new spine.SkeletonBinary(loader);
  const bytes = new Uint8Array(skeletonBytes);
  const source = json ? JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')) : bytes;
  if (source.skeleton?.spine && !/^4\.1\./.test(source.skeleton.spine)) throw Error('此版本支持 Spine 4.1，当前骨骼版本为 ' + source.skeleton.spine + '。');
  const data = parser.readSkeletonData(source);
  fixQuadRotations(data, spine.RegionAttachment);
  if (data.version && !/^4\.1\./.test(data.version)) throw Error('需要 Spine 4.1 骨骼，当前版本：' + data.version);
  return data;
}

export function createPartMeshLookup(spine, atlas, data) {
  const byRegion = new Map(atlas.regions.map(region => [region, new Set()]));
  const byName = new Map(atlas.regions.map(region => [JSON.stringify([region.page.name, region.name]), region]));
  for (const skin of data.skins) for (const { attachment } of skin.getAttachments()) {
    for (const region of attachment.sequence?.regions ?? [attachment.region]) byRegion.get(region)?.add(attachment);
  }
  const cache = new Map();
  return ({ page, name }) => {
    const region = byName.get(JSON.stringify([page, name]));
    if (!region) throw Error('图集部件不存在。');
    if (cache.has(region)) return cache.get(region);
    const meshes = [];
    for (const attachment of byRegion.get(region)) {
      if (attachment instanceof spine.RegionAttachment) { meshes.length = 0; break; }
      if (!(attachment instanceof spine.MeshAttachment)) continue;
      let uvs = attachment.uvs;
      if (attachment.region !== region) {
        const mesh = new spine.MeshAttachment(attachment.name, attachment.path);
        mesh.region = region;
        mesh.regionUVs = attachment.regionUVs;
        mesh.updateRegion();
        uvs = mesh.uvs;
      }
      meshes.push({ uvs: Array.from(uvs), triangles: Array.from(attachment.triangles) });
    }
    cache.set(region, meshes);
    return meshes;
  };
}
