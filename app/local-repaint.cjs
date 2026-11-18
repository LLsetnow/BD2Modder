'use strict';

const { PNG } = require('pngjs');
const { png, validateRects } = require('./texture.cjs');

const MATTE = 224;
const EDGE_RADIUS = 3;
const MAX_WORK = 2048;
const EPSILON = 1e-5;

function canvas(width, height, value = MATTE) {
  const image = new PNG({ width, height });
  image.data.fill(value);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  return image;
}

function rasterize(coords, rect, visit) {
  const [ax, ay, bx, by, cx, cy] = coords;
  const dx = bx - ax, dy = by - ay, ex = cx - ax, ey = cy - ay;
  const determinant = dx * ey - dy * ex;
  if (Math.abs(determinant) < EPSILON) return;
  const minX = Math.max(rect.x, Math.ceil(Math.min(ax, bx, cx) - .5));
  const maxX = Math.min(rect.x + rect.width - 1, Math.floor(Math.max(ax, bx, cx) - .5));
  const minY = Math.max(rect.y, Math.ceil(Math.min(ay, by, cy) - .5));
  const maxY = Math.min(rect.y + rect.height - 1, Math.floor(Math.max(ay, by, cy) - .5));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + .5 - ax, py = y + .5 - ay;
      const b = (px * ey - py * ex) / determinant;
      const c = (dx * py - dy * px) / determinant;
      const a = 1 - b - c;
      if (Math.min(a, b, c) >= -EPSILON) visit(x, y, a, b, c);
    }
  }
}

function triangles(draw, name, project) {
  const result = [];
  const input = draw[name];
  if (!Array.isArray(input) || !Array.isArray(draw.triangles) || input.length % 2 ||
      draw.triangles.length % 3 || !input.every(Number.isFinite) ||
      draw.triangles.some(i => !Number.isInteger(i) || i < 0 || i * 2 + 1 >= input.length)) {
    throw Error('Spine 三角形数据无效。');
  }
  for (let i = 0; i < draw.triangles.length; i += 3) {
    const coords = [];
    for (let j = i; j < i + 3; j++) {
      const offset = draw.triangles[j] * 2;
      coords.push(...project(input[offset], input[offset + 1]));
    }
    result.push(coords);
  }
  return result;
}

function interpolate(coords, a, b, c) {
  return [a * coords[0] + b * coords[2] + c * coords[4], a * coords[1] + b * coords[3] + c * coords[5]];
}

function alignedCenter(min, max, size) {
  const midpoint = (min + max) / 2;
  const aligned = Math.round(midpoint);
  return Math.max(max - aligned, aligned - min) <= size / 2 + .001 ? aligned : midpoint;
}

function offsetAt(image, x, y) {
  return (y * image.width + x) * 4;
}

function readColor(image, x, y, useAlpha) {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const u = x - x0, v = y - y0;
  const p = offsetAt(image, x0, y0), q = offsetAt(image, x1, y0);
  const r = offsetAt(image, x0, y1), s = offsetAt(image, x1, y1);
  const { data } = image;
  const blend = (a, b, c, d) => (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  if (!useAlpha) return [0, 1, 2, 3].map(c => Math.round(blend(data[p + c], data[q + c], data[r + c], data[s + c])));
  const ap = data[p + 3], aq = data[q + 3], ar = data[r + 3], as = data[s + 3];
  const alpha = blend(ap, aq, ar, as);
  if (!alpha) return [0, 0, 0, 0];
  const rgb = [0, 1, 2].map(c => Math.round(blend(data[p + c] * ap, data[q + c] * aq, data[r + c] * ar, data[s + c] * as) / alpha));
  return [...rgb, Math.round(alpha)];
}

function distance(data, offset, rgb) {
  return Math.max(...rgb.map((channel, i) => Math.abs(channel - data[offset + i])));
}

function copyRgb(dst, offset, rgb, premultiplied = false) {
  const alpha = premultiplied ? dst[offset + 3] / 255 : 1;
  for (let c = 0; c < 3; c++) dst[offset + c] = Math.round(rgb[c] * alpha);
}

function writeSample(atlas, offset, rgba, premultiplied, writeAlpha) {
  if (writeAlpha) atlas.data[offset + 3] = rgba[3];
  copyRgb(atlas.data, offset, rgba, premultiplied);
}

function candidatePixels(atlas, rects, footprints, mask) {
  const owner = new Uint16Array(atlas.width * atlas.height);
  const atlasPoint = (u, v) => [u * atlas.width, v * atlas.height];
  for (const draw of footprints) {
    const part = rects.findIndex(rect => rect.name === draw.region);
    if (part < 0) continue;
    for (const triangle of triangles(draw, 'uvs', atlasPoint)) {
      rasterize(triangle, rects[part], (x, y) => {
        const index = y * atlas.width + x;
        const p = index * 4;
        if (atlas.data[p + 3] > 0 && (!mask || (mask.data[p] > 0 && mask.data[p + 3] > 0))) {
          if (owner[index] !== 0 && owner[index] !== part + 1) throw Error('选中的部件共享图集像素，请分开重绘。');
          owner[index] = part + 1;
        }
      });
    }
  }
  return owner;
}

function crossesSharedVertex(from, to, x, y) {
  if (from.drawIndex !== to.drawIndex) return false;
  const [ax, ay, bx, by, cx, cy] = to.xy;
  const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  // A point in the other triangle's interior is genuine mesh overlap.
  if (Math.min(ab, bc, ca) > EPSILON || Math.max(ab, bc, ca) < -EPSILON) return false;
  for (let i = 0; i < 6; i += 2) {
    for (let j = 0; j < 6; j += 2) {
      if (Math.abs(from.uv[i] - to.uv[j]) < EPSILON &&
          Math.abs(from.uv[i + 1] - to.uv[j + 1]) < EPSILON) return true;
    }
  }
  return false;
}

function indexVisibleRows(screenOwner, projected, size, partCount) {
  const parts = Array.from({ length: partCount }, () => ({ first: size, last: -1, rows: [] }));
  for (let i = 0; i < screenOwner.length; i++) {
    const owner = screenOwner[i];
    if (!owner) continue;
    const part = parts[projected[owner - 1].part];
    const row = Math.floor(i / size);
    (part.rows[row] ??= []).push(i % size);
    part.first = Math.min(part.first, row);
    part.last = row;
  }
  return parts;
}

function nearPart({ first, last, rows }, x, y, radius) {
  for (let row = Math.max(first, y - radius); row <= Math.min(last, y + radius); row++) {
    const columns = rows[row];
    if (!columns) continue;
    const dy = row - y;
    const reach = Math.floor(Math.sqrt(radius * radius - dy * dy));
    const min = x - reach, max = x + reach;
    if (max < columns[0] || min > columns[columns.length - 1]) continue;
    let low = 0, high = columns.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (columns[mid] < min) low = mid + 1;
      else high = mid;
    }
    if (columns[low] <= max) return true;
  }
  return false;
}

function prepare({ atlasBytes, rects, snapshot, maskBytes, seamExpand = 0 }) {
  const atlas = png(atlasBytes);
  validateRects(rects, atlas);
  const mask = maskBytes ? png(maskBytes) : null;
  if (mask && (mask.width !== atlas.width || mask.height !== atlas.height)) throw Error('部件遮罩尺寸须与图集一致。');
  if (!rects.length || rects.length > 1024 || !Array.isArray(snapshot.draws) || !Array.isArray(snapshot.footprints)) {
    throw Error('无效的局部重绘选区。');
  }
  const candidates = candidatePixels(atlas, rects, snapshot.footprints, mask);
  const total = candidates.reduce((count, owner) => count + Number(Boolean(owner)), 0);
  if (!total) throw Error('选中的网格内没有可写的贴图像素。');

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const draw of snapshot.draws) {
    for (const vertex of draw.triangles) {
      const x = draw.vertices[vertex * 2], y = draw.vertices[vertex * 2 + 1];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const extent = Math.max(x1 - x0, y1 - y0);
  if (!Number.isFinite(extent) || extent <= 0) throw Error('当前帧没有可见的选中部件，请选择另一帧。');
  const size = extent <= 960 ? 1024 : MAX_WORK;
  const exportSize = extent <= 1024 + .001 ? 1024 : MAX_WORK;
  const centerX = (x0 + x1) / 2, centerY = (y0 + y1) / 2;
  const exportCenterX = alignedCenter(x0, x1, exportSize), exportCenterY = alignedCenter(y0, y1, exportSize);
  const scale = Math.min(1, (size - 64) / extent);
  const workPoint = (x, y) => [size / 2 + (x - centerX) * scale, size / 2 - (y - centerY) * scale];
  const atlasPoint = (u, v) => [u * atlas.width, v * atlas.height];
  const work = canvas(size, size);
  const workBounds = { x: 0, y: 0, width: size, height: size };
  const screenOwner = new Int32Array(size * size);
  const projected = [];

  for (const [drawIndex, draw] of snapshot.draws.entries()) {
    const part = rects.findIndex(rect => rect.name === draw.region);
    if (part < 0) continue;
    const source = triangles(draw, 'uvs', atlasPoint);
    const target = triangles(draw, 'vertices', workPoint);
    const used = new Set();
    for (let i = 0; i < source.length; i++) {
      const uv = source[i], xy = target[i], id = projected.length + 1;
      projected.push({ part, uv, xy, id, drawIndex });
      rasterize(xy, workBounds, (x, y, a, b, c) => {
        const [u, v] = interpolate(uv, a, b, c);
        const tx = Math.floor(u), ty = Math.floor(v);
        const rect = rects[part];
        if (tx < rect.x || ty < rect.y || tx >= rect.x + rect.width || ty >= rect.y + rect.height) return;
        const src = ty * atlas.width + tx;
        if (candidates[src] !== part + 1) return;
        const alpha = atlas.data[src * 4 + 3] / 255 * draw.opacity;
        if (alpha <= 0) return;
        const destination = y * size + x;
        // A shared triangle edge has two raster hits. Composite a slot once at each pixel.
        if (!used.has(destination)) {
          const offset = destination * 4;
          for (let channel = 0; channel < 3; channel++) {
            const rgb = atlas.data[src * 4 + channel];
            const sourceColor = snapshot.premultiplied ? rgb * draw.opacity : rgb * alpha;
            work.data[offset + channel] = Math.round(sourceColor + work.data[offset + channel] * (1 - alpha));
          }
          used.add(destination);
          if (alpha >= .025) screenOwner[destination] = id;
        }
      });
    }
  }

  const sources = new Int32Array(candidates.length).fill(-1);
  const seamSources = seamExpand ? new Int32Array(candidates.length).fill(-1) : null;
  let visibleRows;
  for (const triangle of projected) {
    const { part, uv, xy, id } = triangle;
    rasterize(uv, rects[part], (x, y, a, b, c) => {
      const index = y * atlas.width + x;
      if (candidates[index] !== part + 1) return;
      const [px, py] = interpolate(xy, a, b, c);
      const sx = Math.floor(px), sy = Math.floor(py);
      const source = sy * size + sx;
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) return;
      const owner = screenOwner[source];
      // The atlas and render grids can land on opposite sides of a shared mesh edge.
      if (owner === id || (owner && crossesSharedVertex(triangle, projected[owner - 1], px, py))) sources[index] = source;
      else if (seamSources && owner && projected[owner - 1].part !== part) {
        visibleRows ??= indexVisibleRows(screenOwner, projected, size, rects.length);
        if (nearPart(visibleRows[part], sx, sy, seamExpand)) seamSources[index] = source;
      }
    });
  }
  if (!sources.some(source => source >= 0)) throw Error('当前姿势没有可靠的组装图取样点。');
  const tint = [62, 211, 178];
  for (let i = 0; i < candidates.length; i++) {
    if (!candidates[i]) continue;
    for (let c = 0; c < 3; c++) {
      const offset = i * 4 + c;
      atlas.data[offset] = Math.round(atlas.data[offset] * .35 + tint[c] * .65);
    }
    atlas.data[i * 4 + 3] = Math.max(180, atlas.data[i * 4 + 3]);
  }
  const selectionAlpha = canvas(size, size, 0);
  for (let index = 0; index < screenOwner.length; index++) {
    const offset = index * 4;
    if (screenOwner[index]) selectionAlpha.data.fill(255, offset, offset + 4);
    else work.data[offset + 3] = 0;
  }
  return {
    image: PNG.sync.write(work), mask: PNG.sync.write(selectionAlpha),
    selectedAtlas: PNG.sync.write(atlas), size, total, candidates, sources, seamSources,
    premultiplied: Boolean(snapshot.premultiplied),
    projection: { centerX, centerY, scale, exportSize, exportCenterX, exportCenterY }
  };
}

function replaceAssembled({ atlasBytes, rects, snapshot, imageBytes }) {
  const prepared = prepare({ atlasBytes, rects, snapshot });
  const atlas = png(atlasBytes), replacement = png(imageBytes);
  const { exportSize, exportCenterX, exportCenterY, centerX, centerY, scale } = prepared.projection;
  if (replacement.width < exportSize / 2 || replacement.height < exportSize / 2 ||
      Math.abs(replacement.width / replacement.height - 1) > .005) {
    throw Error('组合 PNG 的画布比例或尺寸不符，请保持导出图的裁切、位置和留白。');
  }

  let changed = false;
  for (let index = 0; index < prepared.sources.length; index++) {
    const source = prepared.sources[index];
    if (source < 0) continue;
    const workX = source % prepared.size, workY = Math.floor(source / prepared.size);
    const worldX = centerX + (workX + .5 - prepared.size / 2) / scale;
    const worldY = centerY - (workY + .5 - prepared.size / 2) / scale;
    const outputX = exportSize / 2 + worldX - exportCenterX;
    const outputY = exportSize / 2 - (worldY - exportCenterY);
    const inputX = (outputX * replacement.width / exportSize) - .5;
    const inputY = (outputY * replacement.height / exportSize) - .5;
    if (inputX < -.5 || inputY < -.5 || inputX > replacement.width - .5 || inputY > replacement.height - .5) continue;
    const rgba = readColor(replacement, inputX, inputY, true);
    // Match local repaint's RGB writeback: transparent output leaves the source pixel intact.
    if (rgba[3] < 128) continue;
    const offset = index * 4;
    const before = Array.from(atlas.data.subarray(offset, offset + 4));
    writeSample(atlas, offset, rgba, prepared.premultiplied, false);
    if (before.some((value, channel) => value !== atlas.data[offset + channel])) changed = true;
  }
  return changed ? PNG.sync.write(atlas) : Buffer.from(atlasBytes);
}

function normalizedOutput(bytes, width, height, writebackMode) {
  const source = png(bytes);
  if (source.width < width / 2 || source.height < height / 2 ||
      Math.abs(source.width / source.height - width / height) > .005) {
    throw Error('模型输出画布比例或尺寸不符，请保持原裁切、位置和留白。');
  }
  const writeAlpha = writebackMode === 'argb' && source.alpha;
  let image = source;
  if (source.width !== width || source.height !== height) {
    image = canvas(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgba = readColor(source, (x + .5) * source.width / width - .5, (y + .5) * source.height / height - .5, writeAlpha);
        image.data.set(rgba, offsetAt(image, x, y));
      }
    }
  }
  return { image, writeAlpha, background: workBackground(image, writeAlpha) };
}

function contentSample(result, input, index, background, sourceIndex, originalAlpha = null) {
  const offset = sourceIndex * 4;
  const rgba = result.data.subarray(offset, offset + 4);
  const alpha = rgba[3];
  const translucent = originalAlpha !== null && alpha < 255;
  if (!translucent && (alpha < 128 || (background && distance(result.data, offset, background) < 9))) return null;
  if ((originalAlpha === null || alpha === originalAlpha) && distance(input.data, index * 4, rgba.subarray(0, 3)) < 5) return null;
  return rgba;
}

function workBackground(image, writeAlpha) {
  const w = image.width, h = image.height;
  const corners = [0, w - 1, w * (h - 1), w * h - 1];
  if (writeAlpha && corners.filter(index => image.data[index * 4 + 3] < 128).length >= 3) return null;
  return [0, 1, 2].map(c => {
    const values = corners.map(index => image.data[index * 4 + c]).sort((a, b) => a - b);
    return Math.round((values[1] + values[2]) / 2);
  });
}

function pack(rects, margin) {
  const align = size => Math.ceil(size / 32) * 32;
  const minPad = 24;
  const preferredPad = Math.max(minPad, margin * 2 + 2);
  const widest = Math.max(...rects.map(rect => rect.width));
  const parts = rects.map((rect, part) => ({ rect, part })).sort((a, b) => b.rect.height - a.rect.height);

  function arrange(width, pad) {
    let x = pad, y = pad, tallest = 0;
    const layout = new Array(rects.length);
    for (const { rect, part } of parts) {
      if (x + rect.width + pad > width) {
        x = pad;
        y += tallest + pad;
        tallest = 0;
      }
      layout[part] = { ...rect, workX: x, workY: y };
      x += rect.width + pad;
      tallest = Math.max(tallest, rect.height);
    }
    const height = align(Math.max(512, y + tallest + pad));
    return height <= MAX_WORK ? { width, height, layout } : null;
  }

  const preferredWidth = align(Math.max(768, widest + 2 * preferredPad));
  if (preferredWidth <= MAX_WORK) {
    const preferred = arrange(preferredWidth, preferredPad);
    if (preferred) return preferred;
  }

  // Keep extra spacing where it fits. Mask distances are still applied at the requested values.
  let low = minPad;
  let high = Math.min(preferredPad, Math.floor((MAX_WORK - Math.max(widest, parts[0].rect.height)) / 2));
  let packed = null;
  while (low <= high) {
    const pad = Math.floor((low + high) / 2);
    const candidate = arrange(MAX_WORK, pad);
    if (candidate) {
      packed = candidate;
      low = pad + 1;
    } else high = pad - 1;
  }
  if (!packed) throw Error('原尺寸 UV 排版超出 2048 × 2048，请减少选中的部件。');
  return packed;
}

function eachPartPixel(atlas, work, layout, visit) {
  for (const [part, rect] of layout.entries()) {
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const atlasIndex = (rect.y + y) * atlas.width + rect.x + x;
        const workIndex = (rect.workY + y) * work.width + rect.workX + x;
        visit(part, rect, atlasIndex, workIndex, x, y);
      }
    }
  }
}

function softenMask(mask, expand, feather) {
  if (!expand && !feather) return mask;
  const { width, height } = mask;
  // Approximate pixel distances with orthogonal and diagonal moves.
  const distances = new Uint16Array(width * height);
  distances.fill(65535);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask.data[i * 4]) { distances[i] = 0; continue; }
      if (x) distances[i] = Math.min(distances[i], distances[i - 1] + 10);
      if (y) {
        distances[i] = Math.min(distances[i], distances[i - width] + 10);
        if (x) distances[i] = Math.min(distances[i], distances[i - width - 1] + 14);
        if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i - width + 1] + 14);
      }
    }
  }
  const output = canvas(width, height, 0);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + 1] + 10);
      if (y + 1 < height) {
        distances[i] = Math.min(distances[i], distances[i + width] + 10);
        if (x) distances[i] = Math.min(distances[i], distances[i + width - 1] + 14);
        if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + width + 1] + 14);
      }
      const distance = distances[i] / 10;
      const weight = distance <= expand ? 1 : feather ? Math.max(0, 1 - (distance - expand) / feather) : 0;
      output.data.fill(Math.round(255 * weight), i * 4, i * 4 + 3);
    }
  }
  return output;
}

function traceRoundOne(prepared, written) {
  const trace = Buffer.allocUnsafe(prepared.total * 8);
  const samples = canvas(prepared.size, prepared.size, 0);
  let offset = 0;
  for (let i = 0; i < prepared.candidates.length; i++) {
    if (!prepared.candidates[i]) continue;
    const source = prepared.sources[i] >= 0 ? prepared.sources[i] : prepared.seamSources?.[i] ?? -1;
    const sourceX = source < 0 ? -1 : source % prepared.size;
    const sourceY = source < 0 ? -1 : Math.floor(source / prepared.size);
    const sample = sourceX < 0 || sourceY < 0 ||
      sourceX >= prepared.size || sourceY >= prepared.size
      ? -1 : sourceY * prepared.size + sourceX;
    // Sorted pairs of atlas index and sample index. A negative sample was written.
    trace.writeUInt32LE(i, offset);
    trace.writeInt32LE(written[i] && sample >= 0 ? -sample - 2 : sample + 2, offset + 4);
    offset += 8;
    if (written[i] && sample >= 0) samples.data.fill(255, sample * 4, sample * 4 + 3);
  }
  return { trace, samples: PNG.sync.write(samples) };
}

function projectRoundOne({ atlasBytes, rects, prepared, generated, maskExpand = 0, maskFeather = 0, writebackMode, secondRound = true }) {
  const atlas = png(atlasBytes);
  const first = new Uint8Array(prepared.candidates.length);
  const roundOneInput = png(prepared.image);
  const { image: output, writeAlpha, background } = normalizedOutput(generated, prepared.size, prepared.size, writebackMode);
  let count = 0, seamCount = 0;
  for (let i = 0; i < prepared.sources.length; i++) {
    const direct = prepared.sources[i];
    const source = direct >= 0 ? direct : prepared.seamSources?.[i] ?? -1;
    if (source < 0) continue;
    const offset = i * 4;
    const sampleX = source % prepared.size;
    const sampleY = Math.floor(source / prepared.size);
    if (sampleX < 0 || sampleY < 0 || sampleX >= prepared.size || sampleY >= prepared.size) continue;
    const sample = sampleY * prepared.size + sampleX;
    // Cross-part seam samples can supply color while opacity comes from a direct UV sample.
    const copyAlpha = writeAlpha && direct >= 0;
    const rgba = contentSample(output, roundOneInput, sample, background, sample, copyAlpha ? atlas.data[offset + 3] : null);
    if (!rgba) continue;
    writeSample(atlas, offset, rgba, prepared.premultiplied, copyAlpha);
    first[i] = 1;
    count++;
    if (direct < 0) seamCount++;
  }
  const committed = PNG.sync.write(atlas);
  const trace = traceRoundOne(prepared, first);
  if (prepared.total === count || !secondRound) return { atlas: committed, first, count, seamCount, ...trace };

  const { width, height, layout } = pack(rects, maskExpand + maskFeather);
  const work = canvas(width, height);
  const mask = canvas(width, height, 0);
  eachPartPixel(atlas, work, layout, (part, rect, ai, wi) => {
    if (prepared.candidates[ai] !== part + 1) return;
    // Keep soft edges readable in the RGB input and leave erased pixels on the matte.
    const offset = ai * 4;
    const storedAlpha = atlas.data[offset + 3];
    if (storedAlpha > 0) {
      const alpha = prepared.premultiplied ? storedAlpha / 255 : 1;
      const rgb = [0, 1, 2].map(channel => Math.min(255, Math.round(atlas.data[offset + channel] / alpha)));
      copyRgb(work.data, wi * 4, rgb);
    }
    if (!first[ai]) copyRgb(mask.data, wi * 4, [255, 255, 255]);
  });
  return {
    atlas: committed, first, count, seamCount, ...trace, layout, width, height, image: PNG.sync.write(work),
    mask: PNG.sync.write(mask), modelMask: PNG.sync.write(softenMask(mask, maskExpand, maskFeather))
  };
}

function registerParts(work, output, atlas, layout, candidates, background) {
  const expected = new Uint16Array(work.width * work.height);
  eachPartPixel(atlas, work, layout, (part, rect, atlasIndex, workIndex) => {
    if (candidates[atlasIndex] === part + 1 && atlas.data[atlasIndex * 4 + 3] > 0) expected[workIndex] = part + 1;
  });
  const foreground = new Uint8Array(expected.length);
  for (let index = 0; index < foreground.length; index++) {
    const offset = index * 4;
    foreground[index] = output.data[offset + 3] >= 128 && (!background || distance(output.data, offset, background) >= 15);
  }
  const margin = 10;
  const search = 12;
  return layout.map((rect, part) => {
    const x0 = Math.max(0, rect.workX - margin), x1 = Math.min(work.width, rect.workX + rect.width + margin);
    const y0 = Math.max(0, rect.workY - margin), y1 = Math.min(work.height, rect.workY + rect.height + margin);
    const stride = Math.max(1, Math.ceil(Math.sqrt((x1 - x0) * (y1 - y0) / 65536)));
    const score = (dx, dy) => {
      let intersection = 0, union = 0;
      for (let y = y0; y < y1; y += stride) {
        const sy = y + dy;
        for (let x = x0; x < x1; x += stride) {
          const sx = x + dx;
          const local = expected[y * work.width + x] === part + 1;
          const generated = sx >= 0 && sx < work.width && sy >= 0 && sy < work.height &&
            Boolean(foreground[sy * work.width + sx]);
          if (local && generated) intersection++;
          if (local || generated) union++;
        }
      }
      return union ? intersection / union : 0;
    };
    const before = score(0, 0);
    let best = { dx: 0, dy: 0, after: before };
    if (before < .96) {
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          const value = score(dx, dy);
          const length = dx * dx + dy * dy;
          if (value > best.after || (value === best.after && length < best.dx * best.dx + best.dy * best.dy)) {
            best = { dx, dy, after: value };
          }
        }
      }
    }
    if (best.after < .54 || best.after - before < .04) best = { dx: 0, dy: 0, after: before };
    return { name: rect.name, before, ...best };
  });
}

function finish({ prepared, roundOne, generated, writebackMode }) {
  const atlas = png(roundOne.atlas);
  const partStats = roundOne.layout.map(rect => ({ name: rect.name, first: 0, direct: 0, neighbor: 0, remaining: 0 }));
  const work = png(roundOne.image);
  const { image: result, writeAlpha, background } = normalizedOutput(generated, roundOne.width, roundOne.height, writebackMode);
  const alignment = registerParts(work, result, atlas, roundOne.layout, prepared.candidates, background);
  const donors = new Map();
  eachPartPixel(atlas, work, roundOne.layout, (part, rect, ai, wi, x, y) => {
    if (prepared.candidates[ai] !== part + 1) return;
    if (roundOne.first[ai]) {
      partStats[part].first++;
      return;
    }
    const { dx, dy } = alignment[part];
    const sx = rect.workX + x + dx, sy = rect.workY + y + dy;
    if (sx < 0 || sy < 0 || sx >= work.width || sy >= work.height) return;
    const originalAlpha = writeAlpha ? atlas.data[ai * 4 + 3] : null;
    const rgba = contentSample(result, work, wi, background, sy * work.width + sx, originalAlpha);
    if (rgba) donors.set(wi, rgba);
  });

  eachPartPixel(atlas, work, roundOne.layout, (part, rect, ai, wi, x, y) => {
    if (prepared.candidates[ai] !== part + 1 || roundOne.first[ai]) return;
    const partStat = partStats[part];
    let rgba = donors.get(wi);
    const direct = Boolean(rgba);
    if (direct) partStat.direct++;
    else {
      let best = EDGE_RADIUS * EDGE_RADIUS + 1;
      for (let dy = -EDGE_RADIUS; dy <= EDGE_RADIUS; dy++) {
        for (let dx = -EDGE_RADIUS; dx <= EDGE_RADIUS; dx++) {
          const length = dx * dx + dy * dy;
          if (length >= best || length > EDGE_RADIUS * EDGE_RADIUS ||
              x + dx < 0 || x + dx >= rect.width || y + dy < 0 || y + dy >= rect.height) continue;
          const neighbor = donors.get(wi + dy * work.width + dx);
          if (!neighbor || neighbor[3] < 128) continue;
          best = length;
          rgba = neighbor;
        }
      }
      if (rgba) partStat.neighbor++;
      else partStat.remaining++;
    }
    if (rgba) writeSample(atlas, ai * 4, rgba, prepared.premultiplied, writeAlpha && direct);
  });
  const sum = key => partStats.reduce((count, part) => count + part[key], 0);
  return {
    atlas: PNG.sync.write(atlas), parts: partStats, alignment,
    stats: { total: prepared.total, first: roundOne.count, direct: sum('direct'), neighbor: sum('neighbor'), remaining: sum('remaining') }
  };
}

module.exports = { prepare, replaceAssembled, projectRoundOne, finish };
