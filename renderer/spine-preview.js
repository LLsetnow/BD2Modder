import * as spine from '@esotericsoftware/spine-webgl';
import { createPartMeshLookup, fixAtlasRotations, readSpineData, regionRect } from './spine-compat.mjs';
import { SceneOutlines } from './scene-outlines.js';
export class SpinePreview {
  constructor(canvas, overlay, onFrame, onError) {
    this.canvas = canvas; this.overlay = overlay; this.onFrame = onFrame; this.onError = onError;
    this.selected = new Set(); this.pages = new Map(); this.hidden = new Set(); this.textureRequests = new Map(); this.zoom = 1; this.pan = { x: 0, y: 0 }; this.time = 0; this.playing = false; this.speed = 1; this.mesh = false; this.bones = false; this.outline = true;
    this.selectionOnly = false;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!this.gl) throw Error('无法初始化 WebGL。请更新显卡驱动，或检查远程桌面是否禁用了图形加速。');
    this.renderer = new spine.SceneRenderer(canvas, this.gl, true);
    const debugRenderer = this.renderer.skeletonDebugRenderer;
    debugRenderer.drawBones = true; debugRenderer.drawRegionAttachments = false; debugRenderer.drawBoundingBoxes = false;
    debugRenderer.drawMeshHull = false; debugRenderer.drawMeshTriangles = false; debugRenderer.drawPaths = false; debugRenderer.drawClipping = false; debugRenderer.drawSkeletonXY = false;
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
    this.data = readSpineData(spine, atlas, descriptor);
    this.partMeshes = createPartMeshLookup(spine, atlas, this.data);
    this.skeleton = new spine.Skeleton(this.data); this.animationState = new spine.AnimationState(new spine.AnimationStateData(this.data));
    let type; try { const config = JSON.parse(descriptor.manifestText); type = (Array.isArray(config) ? config[0] : config).type; } catch {}
    const animation = this.data.animations.find(a => a.name === type) || this.data.animations[0];
    this.setAnimation(animation?.name || ''); this.fit();
    return { animations: this.data.animations.map(a => ({ name: a.name, duration: a.duration })), skins: this.data.skins.map(s => s.name), regions: atlas.regions.map(regionRect), version: this.data.version, animation: this.animation, device: this.device, hardware: this.hardware };
  }
  setHiddenParts(parts) {
    this.hidden = new Set(parts.map(r => JSON.stringify([r.page, r.name])));
    this.invalidate();
  }
  isHiddenRegion(region) { return region && this.hidden.has(JSON.stringify([region.page.name, region.name])); }
  async refreshTextures(descriptor, onlyPage, candidateUrl) {
    this.setHiddenParts(descriptor.hiddenParts || []);
    const pages = this.atlas.pages.filter(page => !onlyPage || (Array.isArray(onlyPage) ? onlyPage.includes(page.name) : page.name === onlyPage));
    await Promise.all(pages.map(async page => {
      const token = {}; this.textureRequests.set(page.name, token);
      const image = new Image(); image.crossOrigin = 'anonymous'; image.src = candidateUrl || `bdasset://${descriptor.id}/${encodeURIComponent(page.name)}?revision=${descriptor.revision}`; await image.decode();
      if (this.textureRequests.get(page.name) !== token) return;
      if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw Error('图集尺寸与 atlas 不一致：' + page.name);
      const limit = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE); if (page.width > limit || page.height > limit) throw Error('图集超过当前显卡支持的最大纹理尺寸：' + limit);
      const old = page.texture;
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !page.pma);
      const texture = new spine.GLTexture(this.renderer.context, image);
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
      if (!slot.bone.active) { clip.clipEndWithSlot(slot); continue; }
      const attachment = slot.getAttachment(); if (attachment instanceof spine.ClippingAttachment) { clip.clipStart(slot, attachment); continue; }
      let vertices, triangles, uvs;
      if (slot.color.a * (attachment?.color?.a ?? 0) > .001) {
        if (attachment instanceof spine.RegionAttachment) { vertices = new Float32Array(8); attachment.computeWorldVertices(slot, vertices, 0, 2); triangles = [0, 1, 2, 2, 3, 0]; uvs = attachment.uvs; }
        else if (attachment instanceof spine.MeshAttachment) { vertices = new Float32Array(attachment.worldVerticesLength); attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2); triangles = attachment.triangles; uvs = attachment.uvs; }
        if (vertices && attachment.region) {
          if (clip.isClipping()) { clip.clipTriangles(vertices, vertices.length, triangles, triangles.length, uvs, white, black, false); const packed = clip.clippedVertices; vertices = []; uvs = []; for (let i = 0; i < packed.length; i += 8) { vertices.push(packed[i], packed[i + 1]); uvs.push(packed[i + 6], packed[i + 7]); } triangles = [...clip.clippedTriangles]; }
          if (triangles.length && (includeHidden || !this.isHiddenRegion(attachment.region))) output.push({ slot, region: attachment.region.name, page: attachment.region.page.name, vertices, triangles, uvs });
        }
      }
      clip.clipEndWithSlot(slot);
    }
    clip.clipEnd(); return output;
  }
  selectedDraws() { return this.geometry().filter(draw => this.selected.has(draw.region)); }
  filteredSkeleton(include) {
    // Keep every slot in draw order so any slot can end a clipping attachment.
    const drawOrder = this.skeleton.drawOrder.map(slot => {
      const attachment = slot.getAttachment();
      if (attachment instanceof spine.ClippingAttachment || include(slot, attachment)) return slot;
      return { bone: slot.bone, data: slot.data, getAttachment: () => null };
    });
    return { color: this.skeleton.color, drawOrder };
  }
  selectionSkeleton(draws) {
    if (draws) {
      const slots = new Set(draws.map(draw => draw.slot));
      return this.filteredSkeleton(slot => slots.has(slot));
    }
    return this.filteredSkeleton((slot, attachment) => {
      attachment?.sequence?.apply(slot, attachment);
      const region = attachment?.region;
      return this.selected.has(region?.name) && !this.isHiddenRegion(region);
    });
  }
  visibleSkeleton() {
    if (!this.hidden.size) return this.skeleton;
    return this.filteredSkeleton((slot, attachment) => {
      if (!slot.bone.active || !attachment) return true;
      attachment.sequence?.apply(slot, attachment);
      return !this.isHiddenRegion(attachment.region);
    });
  }
  repaintSnapshot(page, names) {
    const selected = new Set(names);
    const isSelected = region => region?.page.name === page && selected.has(region.name);
    const draws = this.geometry().filter(draw => draw.page === page && selected.has(draw.region)).map(draw => {
      const opacity = draw.slot.color.a * draw.slot.getAttachment().color.a * this.skeleton.color.a;
      return { region: draw.region, opacity, vertices: Array.from(draw.vertices), triangles: Array.from(draw.triangles), uvs: Array.from(draw.uvs) };
    });
    const attachments = new Set(this.skeleton.drawOrder.map(slot => slot.getAttachment()));
    for (const skin of new Set([this.skeleton.skin, this.data.defaultSkin])) {
      for (const item of skin?.getAttachments() ?? []) attachments.add(item.attachment);
    }
    const footprints = [];
    for (const attachment of attachments) {
      if (!isSelected(attachment?.region)) continue;
      let triangles;
      if (attachment instanceof spine.RegionAttachment) triangles = [0, 1, 2, 2, 3, 0];
      else if (attachment instanceof spine.MeshAttachment) triangles = Array.from(attachment.triangles);
      else continue;
      footprints.push({ region: attachment.region.name, triangles, uvs: Array.from(attachment.uvs) });
    }
    return {
      draws, footprints, animation: this.animation, time: this.time,
      premultiplied: Boolean(this.atlas.pages.find(item => item.name === page)?.pma)
    };
  }
  pick(x, y) {
    const world = this.renderer.camera.screenToWorld(new spine.Vector3(x, y, 0), this.canvas.clientWidth, this.canvas.clientHeight);
    const draws = this.selectionOnly ? this.selectedDraws() : this.geometry();
    for (const draw of draws.reverse()) for (let i = 0; i < draw.triangles.length; i += 3) {
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
  drawSkeleton(skeleton, showBones = false) {
    const { gl, renderer } = this;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    try {
      renderer.drawSkeleton(skeleton, true);
      if (showBones) { renderer.skeletonDebugRenderer.scale = 1 / Math.max(this.scale || 1, .001); renderer.drawSkeletonDebug(this.skeleton, true); }
    }
    finally { renderer.end(); }
  }
  render(timestamp, showDiagnostics = true) {
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
      const outline = this.outline && this.selected.size > 0;
      const selection = this.selectionOnly || outline ? this.selectionSkeleton() : null;
      const ctx = this.overlay.getContext('2d');
      ctx.resetTransform();
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
      if (outline) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        this.sceneOutlines ??= new SceneOutlines(this.renderer.context);
        this.sceneOutlines.draw(selection, camera.projectionView.values, ratio);
        ctx.drawImage(this.canvas, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, pixelWidth, pixelHeight);
        ctx.globalCompositeOperation = 'source-over';

        if (this.mesh) {
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const { vertices, triangles } of this.selectedDraws()) {
            const points = [];
            for (let i = 0; i < vertices.length; i += 2) {
              points.push(camera.worldToScreen(new spine.Vector3(vertices[i], vertices[i + 1], 0), width, height));
            }
            for (let i = 0; i < triangles.length; i += 3) {
              const a = points[triangles[i]], b = points[triangles[i + 1]], c = points[triangles[i + 2]];
              ctx.moveTo(a.x, height - a.y);
              ctx.lineTo(b.x, height - b.y);
              ctx.lineTo(c.x, height - c.y);
              ctx.closePath();
            }
          }
          ctx.stroke();
        }
      }
      this.drawSkeleton(this.selectionOnly ? selection : this.visibleSkeleton(), showDiagnostics && this.bones);
      this.onFrame?.({ time: this.time, duration: this.duration(), zoom: this.zoom, resolution: [pixelWidth, pixelHeight], playing: this.playing });
      if (this.playing) this.invalidate();
    } catch (error) { this.playing = false; this.onError(error); }
  }
  resetFocus() { this.focus = null; }
  capture() {
    const sceneVisible = this.canvas.clientWidth && this.canvas.clientHeight;
    this.render(performance.now(), false);
    if (!this.selectionOnly && sceneVisible) return this.canvas.toDataURL('image/png');
    try {
      this.drawSkeleton(this.visibleSkeleton());
      return this.canvas.toDataURL('image/png');
    } finally {
      if (this.selectionOnly && !this.gl.isContextLost()) this.drawSkeleton(this.selectionSkeleton());
    }
  }
  captureSelection() {
    const draws = this.selectedDraws();
    if (!draws.length) throw Error('当前帧没有可导出的选中部件。');

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { vertices, triangles } of draws) for (const index of triangles) {
      const x = vertices[index * 2], y = vertices[index * 2 + 1];
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const width = maxX - minX, height = maxY - minY;
    const extent = Math.max(width, height);
    if (!Number.isFinite(extent) || width <= 0 || height <= 0) throw Error('当前选区的导出尺寸无效。');
    // Ignore floating-point noise at pixel boundaries.
    const pixelTolerance = .001;
    const size = extent <= 1024 + pixelTolerance ? 1024 : 2048;
    if (extent > size + pixelTolerance) throw Error('选中部件的原尺寸超出 2048 × 2048 画布。');
    const { canvas, gl, renderer } = this;
    const [maxWidth, maxHeight] = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [0, 0];
    if (size > Math.min(maxWidth, maxHeight)) throw Error('当前选区的原尺寸超出显卡支持的导出范围。');

    const skeleton = this.selectionSkeleton(draws);
    const center = (min, max) => {
      const midpoint = (min + max) / 2;
      const aligned = Math.round(midpoint);
      return Math.max(max - aligned, aligned - min) <= size / 2 + pixelTolerance ? aligned : midpoint;
    };
    const camera = new spine.OrthoCamera(size, size);
    camera.position.set(center(minX, maxX), center(minY, maxY), 0);
    const previewCamera = renderer.camera, previewWidth = canvas.width, previewHeight = canvas.height;
    try {
      canvas.width = size; canvas.height = size;
      if (gl.drawingBufferWidth !== size || gl.drawingBufferHeight !== size) throw Error('无法创建原尺寸的导出画布。');
      renderer.camera = camera;
      this.drawSkeleton(skeleton);
      const data = canvas.toDataURL('image/png');
      if (data === 'data:,') throw Error('无法生成组合 PNG。');
      return data;
    } finally {
      canvas.width = previewWidth; canvas.height = previewHeight;
      renderer.camera = previewCamera;
      if (!gl.isContextLost()) this.drawSkeleton(this.selectionOnly ? skeleton : this.visibleSkeleton());
    }
  }
  dispose() { cancelAnimationFrame(this.request); this.resizeObserver.disconnect(); this.atlas?.dispose(); this.sceneOutlines?.dispose(); this.renderer.dispose(); this.pages.clear(); }
}
