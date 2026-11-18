'use strict';
const { PNG } = require('pngjs');
const { meshCoverage } = require('./uv-coverage.cjs');
const LIMIT = 8192;
function png(buffer) {
  buffer = Buffer.from(buffer);
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw Error('请选择有效的 PNG 图片。');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > LIMIT || height > LIMIT || width * height > 32 * 1024 * 1024) throw Error('纹理尺寸超出支持范围（单边 8192、总像素 3200 万）。');
  return PNG.sync.read(buffer);
}
function unpickle(input, expected) {
  if (!input.length || (input[0] & 7) !== 0) throw Error('不支持此 LZ4 Pickle 版本。');
  const size = [0, 1, 2, 4][input[0] >>> 6];
  if (input.length < 1 + size) throw Error('压缩纹理头不完整。');
  if (!size) { if (input.length - 1 !== expected) throw Error('纹理像素长度不匹配。'); return input.subarray(1); }
  const diff = input.readUIntLE(1, size), source = input.subarray(1 + size);
  if (source.length + diff !== expected) throw Error('纹理解压长度不匹配。');
  const output = Buffer.alloc(expected); let i = 0, o = 0;
  const length = (initial) => { let n = initial; if (n === 15) { let b; do { if (i >= source.length) throw Error('LZ4 长度损坏。'); b = source[i++]; n += b; } while (b === 255); } return n; };
  while (i < source.length) {
    const token = source[i++], literals = length(token >>> 4);
    if (i + literals > source.length || o + literals > expected) throw Error('LZ4 数据损坏。');
    source.copy(output, o, i, i + literals); i += literals; o += literals;
    if (i === source.length) break;
    if (i + 2 > source.length) throw Error('LZ4 偏移损坏。');
    const offset = source.readUInt16LE(i); i += 2;
    const count = length(token & 15) + 4;
    if (!offset || offset > o || o + count > expected) throw Error('LZ4 匹配越界。');
    for (let end = o + count; o < end; o++) output[o] = output[o - offset];
  }
  if (o !== expected) throw Error('LZ4 解压不完整。'); return output;
}
function decodeBytes(buffer) {
  buffer = Buffer.from(buffer);
  if (buffer.length < 17) throw Error('压缩纹理头不完整。');
  const width = buffer.readInt32LE(0), height = buffer.readInt32LE(4), format = buffer.readInt32LE(8), length = buffer.readInt32LE(12);
  if (width <= 0 || height <= 0 || width > LIMIT || height > LIMIT || width * height > 32 * 1024 * 1024 || length !== buffer.length - 16 || ![3, 4, 5, 14].includes(format)) throw Error('无效或不支持的 MOD 压缩纹理。');
  const stride = format === 3 ? 3 : 4, raw = unpickle(buffer.subarray(16), width * height * stride), out = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = ((height - 1 - y) * width + x) * stride, b = (y * width + x) * 4;
    out.data[b] = raw[a + (format === 14 ? 2 : format === 5 ? 1 : 0)];
    out.data[b + 1] = raw[a + (format === 5 ? 2 : 1)];
    out.data[b + 2] = raw[a + (format === 14 ? 0 : format === 5 ? 3 : 2)];
    out.data[b + 3] = format === 3 ? 255 : raw[a + (format === 5 ? 0 : 3)];
  }
  return PNG.sync.write(out);
}
function encodeBytes(pngBuffer, original) {
  const image = png(pngBuffer); let format = Buffer.from(original).readInt32LE(8);
  if (![3, 4, 5, 14].includes(format)) throw Error('不支持的压缩纹理格式。');
  if (format === 3 && image.data.some((value, index) => index % 4 === 3 && value !== 255)) format = 4;
  const stride = format === 3 ? 3 : 4;
  const raw = Buffer.alloc(image.width * image.height * stride);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const a = (y * image.width + x) * 4, b = ((image.height - 1 - y) * image.width + x) * stride;
    raw[b + (format === 14 ? 2 : format === 5 ? 1 : 0)] = image.data[a];
    raw[b + (format === 5 ? 2 : 1)] = image.data[a + 1];
    raw[b + (format === 14 ? 0 : format === 5 ? 3 : 2)] = image.data[a + 2];
    if (stride === 4) raw[b + (format === 5 ? 0 : 3)] = image.data[a + 3];
  }
  const header = Buffer.alloc(17); header.writeInt32LE(image.width, 0); header.writeInt32LE(image.height, 4); header.writeInt32LE(format, 8); header.writeInt32LE(raw.length + 1, 12);
  return Buffer.concat([header, raw]); // Pickle V0's documented uncompressed form; preserves the original Unity format.
}
function validateRects(rects, image) {
  if (!Array.isArray(rects) || !rects.length || rects.length > 10000) throw Error('请先选择部件。');
  for (const r of rects) if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > image.width || r.y + r.height > image.height) throw Error('部件选区超出图集。');
}
function crop(buffer, rect, meshes = []) {
  const source = png(buffer);
  validateRects([rect], source);
  const coverage = meshCoverage(source, rect, meshes);
  const out = new PNG({ width: rect.width, height: rect.height });
  PNG.bitblt(source, out, rect.x, rect.y, rect.width, rect.height, 0, 0);
  if (coverage) for (let i = 0; i < coverage.length; i++) {
    if (!coverage[i]) out.data.fill(0, i * 4, i * 4 + 4);
  }
  return PNG.sync.write(out);
}
function edit(buffer, operation, rects, options = {}) {
  const image = png(buffer); validateRects(rects, image);
  if (!['tint', 'hide', 'gray', 'restore', 'replace', 'merge'].includes(operation)) throw Error('不支持的编辑操作。');
  const replacement = ['replace', 'merge', 'restore'].includes(operation) ? png(options.image) : null;
  const replacingPart = operation === 'replace';
  const restoringPart = operation === 'restore';
  const gray = operation === 'gray';
  const maskingHidden = operation === 'hide' || gray;
  const shaded = gray ? new Uint8Array(image.width * image.height) : null;
  if (replacingPart && rects.length !== 1) throw Error('替换部件时请只选择一个部件。');
  if (['merge', 'restore'].includes(operation) && (replacement.width !== image.width || replacement.height !== image.height)) throw Error('图集替换尺寸必须与原始图集一致。');
  const color = /^#[\da-f]{6}$/i.test(options.color || '') ? options.color.slice(1).match(/../g).map(v => parseInt(v, 16)) : [141, 178, 228];
  const strength = Math.max(0, Math.min(1, Number(options.strength ?? 0.65)));
  if (!Number.isFinite(strength)) throw Error('无效的重绘幅度。');
  for (const r of rects) {
    const meshes = replacingPart ? options.meshes : r.meshes;
    const coverage = replacingPart || restoringPart || maskingHidden ? meshCoverage(image, r, meshes ?? []) : null;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      if (coverage && !coverage[y * r.width + x]) continue;
      const p = ((r.y + y) * image.width + r.x + x) * 4;
      if (maskingHidden && !coverage && !image.data[p + 3]) continue;
      if (operation === 'hide') image.data.fill(0, p, p + 4);
      else if (operation === 'tint' || gray) {
        const luma = image.data[p] * .2126 + image.data[p + 1] * .7152 + image.data[p + 2] * .0722;
        if (gray) {
          if (shaded[p / 4]) continue;
          shaded[p / 4] = 1;
          image.data.fill(Math.round(luma * .65), p, p + 3);
        } else for (let c = 0; c < 3; c++) image.data[p + c] = Math.round(image.data[p + c] * (1 - strength) + Math.min(255, color[c] * (luma / 128)) * strength);
      } else {
        const sx = replacingPart ? Math.min(replacement.width - 1, Math.floor(x / r.width * replacement.width)) : r.x + x;
        const sy = replacingPart ? Math.min(replacement.height - 1, Math.floor(y / r.height * replacement.height)) : r.y + y;
        const q = (sy * replacement.width + sx) * 4;
        const oldAlpha = image.data[p + 3], sourceAlpha = replacement.data[q + 3];
        if (replacingPart && (!oldAlpha || !sourceAlpha)) continue;
        if (restoringPart && !coverage && !sourceAlpha) continue;
        for (let c = 0; c < (options.preserveAlpha ? 3 : 4); c++) image.data[p + c] = replacement.data[q + c];
        if (options.preserveAlpha) image.data[p + 3] = oldAlpha;
      }
    }
  }
  return PNG.sync.write(image);
}
function mask(buffer, rects) {
  const image = png(buffer); validateRects(rects, image); const out = new PNG({ width: image.width, height: image.height });
  for (let p = 3; p < out.data.length; p += 4) out.data[p] = 255;
  for (const r of rects) for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) { const p = (y * image.width + x) * 4; out.data[p] = out.data[p + 1] = out.data[p + 2] = image.data[p + 3]; }
  return PNG.sync.write(out);
}
module.exports = { png, unpickle, decodeBytes, encodeBytes, crop, edit, mask, validateRects };
