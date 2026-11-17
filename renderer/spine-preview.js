import * as spine from '@esotericsoftware/spine-webgl';
import { fixAtlasRotations, fixQuadRotations, regionRect } from './spine-compat.mjs';
export class SpinePreview {
  constructor(canvas, overlay, onFrame, onError) {
    this.canvas = canvas; this.overlay = overlay; this.onFrame = onFrame; this.onError = onError;
    this.selected = new Set(); this.pages = new Map(); this.hidden = new Set(); this.textureRequests = new Map(); this.zoom = 1; this.pan = { x: 0, y: 0 }; this.time = 0; this.playing = false; this.speed = 1; this.mesh = false; this.outline = true;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!this.gl) throw Error('无法初始化 WebGL。请更新显卡驱动，或检查远程桌面是否禁用了图形加速。');
    this.renderer = new spine.SceneRenderer(canvas, this.gl, true);
    const extension = this.gl.getExtension('WEBGL_debug_renderer_info'); this.device = extension ? this.gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : this.gl.getParameter(this.gl.RENDERER);
    this.hardware = !/swiftshader|llvmpipe|software/i.test(this.device);
    this.resizeObserver = new ResizeObserver(() => this.invalidate()); this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.playing = false; cancelAnimationFrame(this.request); this.onError(Error('显卡上下文丢失，请重新打开 MOD 以恢复预览。')); });
  }
  async load(descriptor) {
    this.playing = false; this.time = 0; this.data = null; this.skeleton = null; this.atlas?.dispose(); this.pages.clear(); this.textureRequests.clear();
    const atlas = new spine.TextureAtlas(descriptor.atlasText); this.atlas = atlas;
    fixAtlasRotations(atlas);
    await this.refreshTextures(descriptor);
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const parser = descriptor.skeletonName.toLowerCase().endsWith('.json') ? new spine.SkeletonJson(loader) : new spine.SkeletonBinary(loader);
    const bytes = new Uint8Array(descriptor.skeletonBytes);
    const source = descriptor.skeletonName.toLowerCase().endsWith('.json') ? JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')) : bytes;
    if (source.skeleton?.spine && !/^4\.1\./.test(source.skeleton.spine)) throw Error('此版本支持 Spine 4.1，当前骨骼版本为 ' + source.skeleton.spine + '。');
    this.data = parser.readSkeletonData(source);
    fixQuadRotations(this.data, spine.RegionAttachment);
    if (this.data.version && !/^4\.1\./.test(this.data.version)) throw Error('需要 Spine 4.1 骨骼，当前版本：' + this.data.version);
    this.skeleton = new spine.Skeleton(this.data); this.animationState = new spine.AnimationState(new spine.AnimationStateData(this.data));
    let type; try { const config = JSON.parse(descriptor.manifestText); type = (Array.isArray(config) ? config[0] : config).type; } catch {}
    const animation = this.data.animations.find(a => a.name === type) || this.data.animations[0];
    this.setAnimation(animation?.name || ''); this.fit();
    return { animations: this.data.animations.map(a => ({ name: a.name, duration: a.duration })), skins: this.data.skins.map(s => s.name), regions: atlas.regions.map(regionRect), version: this.data.version, animation: this.animation, device: this.device, hardware: this.hardware };
  }
  async refreshTextures(descriptor, onlyPage) {
    this.hidden = new Set((descriptor.hiddenParts || []).map(r => JSON.stringify([r.page, r.name])));
    const pages = this.atlas.pages.filter(page => !onlyPage || (Array.isArray(onlyPage) ? onlyPage.includes(page.name) : page.name === onlyPage));
    await Promise.all(pages.map(async page => {
      const token = {}; this.textureRequests.set(page.name, token);
      const image = new Image(); image.crossOrigin = 'anonymous'; image.src = `bdasset://${descriptor.id}/${encodeURIComponent(page.name)}?revision=${descriptor.revision}`; await image.decode();
      let sceneImage = image;
      if (descriptor.hiddenParts?.some(r => r.page === page.name)) { sceneImage = new Image(); sceneImage.crossOrigin = 'anonymous'; sceneImage.src = image.src + '&scene=1'; await sceneImage.decode(); }
      if (this.textureRequests.get(page.name) !== token) return;
      if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw Error('图集尺寸与 atlas 不一致：' + page.name);
      const limit = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE); if (page.width > limit || page.height > limit) throw Error('图集超过当前显卡支持的最大纹理尺寸：' + limit);
      const old = page.texture;
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !page.pma);
      const texture = new spine.GLTexture(this.renderer.context, sceneImage);
      page.setTexture(texture); old?.dispose();
      const sample = document.createElement('canvas'); sample.width = page.width; sample.height = page.height; const ctx = sample.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      this.pages.set(page.name, { image, pixels: ctx.getImageData(0, 0, page.width, page.height).data, width: page.width, height: page.height });
    })); this.invalidate();
  }
  setAnimation(name) { if (!this.skeleton) return; this.animation = name; this.time = 0; this.skeleton.setToSetupPose(); this.animationState.clearTracks(); if (name) this.animationState.setAnimation(0, name, true); this.seek(0); this.fit(); }
  setSkin(name) { this.skeleton.setSkinByName(name); this.skeleton.setSlotsToSetupPose(); this.seek(this.time); this.fit(); }
  duration() { return this.data?.animations.find(a => a.name === this.animation)?.duration || 0; }
  seek(time) { this.time = Math.max(0, Math.min(this.duration(), time)); const entry = this.animationState?.getCurrent(0); if (entry) entry.trackTime = this.time; this.skeleton?.setToSetupPose(); if (this.skeleton) { this.animationState.apply(this.skeleton); this.skeleton.updateWorldTransform(); } this.invalidate(); }
  setPlaying(value) { this.playing = Boolean(value && this.duration()); this.last = 0; this.invalidate(); }
  setZoom(value) { if (Number.isFinite(value)) this.zoom = Math.max(.05, value); this.invalidate(); }
  fit() { if (!this.skeleton) return; this.focus = null; const offset = new spine.Vector2(), size = new spine.Vector2(); this.skeleton.getBounds(offset, size, []); this.bounds = { x: offset.x, y: offset.y, width: Math.max(size.x, 1), height: Math.max(size.y, 1) }; this.zoom = 1; this.pan = { x: 0, y: 0 }; this.invalidate(); }
  locate(name) { const draws = this.geometry().filter(d => d.region === name); if (!draws.length) return false; const v = draws.flatMap(d => [...d.vertices]), xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2); this.focus = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; this.pan = { x: 0, y: 0 }; this.setZoom(Math.max(this.zoom, 2)); return true; }
  geometry(includeHidden = false) {
    if (!this.skeleton) return [];
    const output = [], clip = new spine.SkeletonClipping(), white = new spine.Color(1, 1, 1, 1), black = new spine.Color(0, 0, 0, 1);
    for (const slot of this.skeleton.drawOrder) {
      const attachment = slot.getAttachment(); if (attachment instanceof spine.ClippingAttachment) { clip.clipStart(slot, attachment); continue; }
      let vertices, triangles, uvs;
      if (slot.bone.active && slot.color.a * (attachment?.color?.a ?? 0) > .001 && attachment?.region) {
        if (attachment instanceof spine.RegionAttachment) { vertices = new Float32Array(8); attachment.computeWorldVertices(slot, vertices, 0, 2); triangles = [0, 1, 2, 2, 3, 0]; uvs = attachment.uvs; }
        else if (attachment instanceof spine.MeshAttachment) { vertices = new Float32Array(attachment.worldVerticesLength); attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2); triangles = attachment.triangles; uvs = attachment.uvs; }
        if (vertices) {
          if (clip.isClipping()) { clip.clipTriangles(vertices, vertices.length, triangles, triangles.length, uvs, white, black, false); const packed = clip.clippedVertices; vertices = []; uvs = []; for (let i = 0; i < packed.length; i += 8) { vertices.push(packed[i], packed[i + 1]); uvs.push(packed[i + 6], packed[i + 7]); } triangles = [...clip.clippedTriangles]; }
          if (triangles.length && (includeHidden || !this.hidden.has(JSON.stringify([attachment.region.page.name, attachment.region.name])))) output.push({ region: attachment.region.name, page: attachment.region.page.name, vertices, triangles, uvs });
        }
      }
      clip.clipEndWithSlot(slot);
    }
    clip.clipEnd(); return output;
  }
  pick(x, y) {
    const world = this.renderer.camera.screenToWorld(new spine.Vector3(x, y, 0), this.canvas.clientWidth, this.canvas.clientHeight);
    for (const draw of this.geometry().reverse()) for (let i = 0; i < draw.triangles.length; i += 3) {
      const a = draw.triangles[i] * 2, b = draw.triangles[i + 1] * 2, c = draw.triangles[i + 2] * 2, v = draw.vertices;
      const det = (v[b + 1] - v[c + 1]) * (v[a] - v[c]) + (v[c] - v[b]) * (v[a + 1] - v[c + 1]); if (Math.abs(det) < 1e-8) continue;
      const u = ((v[b + 1] - v[c + 1]) * (world.x - v[c]) + (v[c] - v[b]) * (world.y - v[c + 1])) / det;
      const w = ((v[c + 1] - v[a + 1]) * (world.x - v[c]) + (v[a] - v[c]) * (world.y - v[c + 1])) / det;
      if (u < 0 || w < 0 || u + w > 1) continue;
      const uv = draw.uvs, tx = uv[a] * u + uv[b] * w + uv[c] * (1 - u - w), ty = uv[a + 1] * u + uv[b + 1] * w + uv[c + 1] * (1 - u - w), page = this.pages.get(draw.page);
      const px = Math.max(0, Math.min(page.width - 1, Math.floor(tx * page.width))), py = Math.max(0, Math.min(page.height - 1, Math.floor(ty * page.height)));
      if (page.pixels[(py * page.width + px) * 4 + 3] > 12) return draw.region;
    }
    return null;
  }
  invalidate() { if (!this.request) this.request = requestAnimationFrame(timestamp => this.render(timestamp)); }
  render(timestamp) {
    this.request = 0;
    try {
      const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
      if (!width || !height || !this.skeleton || !this.bounds) return;
      if (this.playing) { const delta = this.last ? Math.min((timestamp - this.last) / 1000, .1) * this.speed : 0; this.animationState.update(delta); this.animationState.apply(this.skeleton); this.skeleton.updateWorldTransform(); this.time = (this.animationState.getCurrent(0)?.trackTime || 0) % this.duration(); }
      this.last = timestamp;
      const ratio = window.devicePixelRatio || 1, pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) { this.canvas.width = pixelWidth; this.canvas.height = pixelHeight; this.overlay.width = pixelWidth; this.overlay.height = pixelHeight; }
      const b = this.bounds, scale = Math.min(width / b.width, height / b.height) * .88 * this.zoom; this.scale = scale;
      const camera = this.renderer.camera; camera.viewportWidth = width / scale; camera.viewportHeight = height / scale;
      camera.position.x = (this.focus?.x ?? b.x + b.width / 2) - this.pan.x / scale; camera.position.y = (this.focus?.y ?? b.y + b.height / 2) + this.pan.y / scale; camera.zoom = 1; camera.update();
      this.gl.viewport(0, 0, pixelWidth, pixelHeight); this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.renderer.begin(); this.renderer.drawSkeleton(this.skeleton, true); this.renderer.end();
      const ctx = this.overlay.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      if (this.outline && this.selected.size) {
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); ctx.lineWidth = 1;
        for (const draw of this.geometry().filter(d => this.selected.has(d.region))) {
          const v = draw.vertices, points = []; for (let i = 0; i < v.length; i += 2) { const point = camera.worldToScreen(new spine.Vector3(v[i], v[i + 1], 0), width, height); points.push({ x: point.x, y: height - point.y }); }
          if (!points.length) continue;
          if (this.mesh) { ctx.setLineDash([]); ctx.beginPath(); for (let i = 0; i < draw.triangles.length; i += 3) { const p = draw.triangles.slice(i, i + 3).map(index => points[index]); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.closePath(); } ctx.stroke(); }
          else { const xs = points.map(p => p.x), ys = points.map(p => p.y); ctx.setLineDash([4, 3]); ctx.strokeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }
        }
      }
      this.onFrame?.({ time: this.time, duration: this.duration(), zoom: this.zoom, resolution: [pixelWidth, pixelHeight], playing: this.playing });
      if (this.playing) this.invalidate();
    } catch (error) { this.playing = false; this.onError(error); }
  }
  resetFocus() { this.focus = null; }
  capture() { this.render(performance.now()); return this.canvas.toDataURL('image/png'); }
  dispose() { cancelAnimationFrame(this.request); this.resizeObserver.disconnect(); this.atlas?.dispose(); this.renderer.dispose(); this.pages.clear(); }
}
