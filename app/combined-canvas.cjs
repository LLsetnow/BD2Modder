'use strict';

const COMBINED_SIZES = [1024, 2048, 4096, 8192];
const MAX_COMBINED_SIZE = COMBINED_SIZES.at(-1);
const MAX_COMBINED_PNG_BYTES = MAX_COMBINED_SIZE ** 2 * 4 + 2 * 1024 * 1024;
// Ignore floating-point noise at pixel boundaries.
const PIXEL_TOLERANCE = .001;

function selectionBounds(draws) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { vertices, triangles } of draws) for (const index of triangles) {
    const x = vertices[index * 2], y = vertices[index * 2 + 1];
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function alignedCenter(min, max, size) {
  const midpoint = (min + max) / 2;
  const aligned = Math.round(midpoint);
  return Math.max(max - aligned, aligned - min) <= size / 2 + PIXEL_TOLERANCE ? aligned : midpoint;
}

function combinedCanvas({ minX, minY, maxX, maxY }) {
  const width = maxX - minX, height = maxY - minY;
  const extent = Math.max(width, height);
  if (!Number.isFinite(extent) || width <= 0 || height <= 0) throw Error('当前选区的导出尺寸无效。');
  const size = COMBINED_SIZES.find(candidate => extent <= candidate + PIXEL_TOLERANCE);
  if (!size) throw Error('选中部件的原尺寸超出 8192 × 8192 画布。');
  return { size, centerX: alignedCenter(minX, maxX, size), centerY: alignedCenter(minY, maxY, size) };
}

module.exports = { MAX_COMBINED_SIZE, MAX_COMBINED_PNG_BYTES, selectionBounds, combinedCanvas };
