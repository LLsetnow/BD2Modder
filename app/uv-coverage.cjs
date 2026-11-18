'use strict';

function meshCoverage(image, rect, meshes) {
  if (!Array.isArray(meshes)) throw Error('部件网格数据无效。');
  if (!meshes.length) return null;

  const coverage = new Uint8Array(rect.width * rect.height);
  const epsilon = 1e-5;
  const pixelTolerance = .001;
  for (const mesh of meshes) {
    const { uvs, triangles } = mesh ?? {};
    if (!Array.isArray(uvs) || uvs.length % 2 || !uvs.every(Number.isFinite) || !Array.isArray(triangles) ||
        triangles.length % 3 || triangles.some(index => !Number.isInteger(index) || index < 0 || index * 2 >= uvs.length)) {
      throw Error('部件网格数据无效。');
    }

    const points = uvs.map((value, i) => i % 2 ? value * image.height - rect.y : value * image.width - rect.x);
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 2, b = triangles[i + 1] * 2, c = triangles[i + 2] * 2;
      const ax = points[a], ay = points[a + 1], bx = points[b], by = points[b + 1], cx = points[c], cy = points[c + 1];
      const abX = bx - ax, abY = by - ay, acX = cx - ax, acY = cy - ay;
      const determinant = abX * acY - abY * acX;
      if (!Number.isFinite(determinant) || Math.abs(determinant) < epsilon) continue;
      const minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - .5 - pixelTolerance));
      const maxX = Math.min(rect.width - 1, Math.floor(Math.max(ax, bx, cx) - .5 + pixelTolerance));
      const minY = Math.max(0, Math.ceil(Math.min(ay, by, cy) - .5 - pixelTolerance));
      const maxY = Math.min(rect.height - 1, Math.floor(Math.max(ay, by, cy) - .5 + pixelTolerance));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + .5 - ax, py = y + .5 - ay;
          const weightB = (px * acY - py * acX) / determinant;
          const weightC = (abX * py - abY * px) / determinant;
          if (Math.min(weightB, weightC, 1 - weightB - weightC) >= -epsilon) coverage[y * rect.width + x] = 1;
        }
      }
    }
  }
  return coverage;
}

function pickAtlasPart(parts, pageName, page, x, y, meshesForPart) {
  if (!(x >= 0 && y >= 0 && x < page.width && y < page.height)) return null;
  const px = Math.floor(x), py = Math.floor(y);
  if (!page.pixels[(py * page.width + px) * 4 + 3]) return null;

  const pixel = { x: px, y: py, width: 1, height: 1 };
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.page !== pageName || px < part.x || py < part.y || px >= part.x + part.width || py >= part.y + part.height) continue;
    const coverage = meshCoverage(page, pixel, meshesForPart(part));
    if (!coverage || coverage[0]) return part.name;
  }
  return null;
}

function atlasOutlinePath(page, part, meshes) {
  const { x, y, width, height } = part;
  const coverage = meshCoverage(page, part, meshes);
  const mask = coverage ?? new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const i = row * width + column;
    const alpha = page.pixels[((y + row) * page.width + x + column) * 4 + 3];
    mask[i] = (!coverage || coverage[i]) && alpha > 0 ? 1 : 0;
  }

  // Trace only transitions between covered and empty pixels, joining runs on the same edge.
  const path = [];
  for (let row = 0; row <= height; row++) {
    let start = -1;
    for (let column = 0; column <= width; column++) {
      const above = row > 0 && column < width ? mask[(row - 1) * width + column] : 0;
      const below = row < height && column < width ? mask[row * width + column] : 0;
      if (above !== below) {
        if (start === -1) start = column;
      } else if (start !== -1) {
        path.push(`M${x + start} ${y + row}H${x + column}`);
        start = -1;
      }
    }
  }
  for (let column = 0; column <= width; column++) {
    let start = -1;
    for (let row = 0; row <= height; row++) {
      const left = column > 0 && row < height ? mask[row * width + column - 1] : 0;
      const right = column < width && row < height ? mask[row * width + column] : 0;
      if (left !== right) {
        if (start === -1) start = row;
      } else if (start !== -1) {
        path.push(`M${x + column} ${y + start}V${y + row}`);
        start = -1;
      }
    }
  }
  return path.join('');
}

module.exports = { meshCoverage, pickAtlasPart, atlasOutlinePath };
