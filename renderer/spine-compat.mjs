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
