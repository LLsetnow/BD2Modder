'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');
const fixture = require('../references/char003793-layout.json');

const repo = path.resolve(__dirname, '../../..');
const report = path.join(repo, 'docs/char003793-Spine贴图重绘流程.html');

function readAsset(assets, key) {
  const uri = assets[key];
  assert(uri?.startsWith('data:image/png;base64,'), '缺少内嵌 PNG：' + key);
  return Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
}

function requireSize(image, width, height) {
  assert.equal(image.width, width, '图像宽度不符');
  assert.equal(image.height, height, '图像高度不符');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sampleBilinear(image, x, y, channel) {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const u = x - x0;
  const v = y - y0;
  const read = (px, py) => image.data[(py * image.width + px) * 4 + channel];
  const top = read(x0, y0) * (1 - u) + read(x1, y0) * u;
  const bottom = read(x0, y1) * (1 - u) + read(x1, y1) * u;
  return Math.round(top * (1 - v) + bottom * v);
}

function copyRGB(target, atlasIndex, source, workIndex, width, height) {
  const x = (workIndex % width + 0.5) * source.width / width - 0.5;
  const y = (Math.floor(workIndex / width) + 0.5) * source.height / height - 0.5;
  for (let channel = 0; channel < 3; channel++) {
    target[atlasIndex * 4 + channel] = sampleBilinear(source, x, y, channel);
  }
}

function readPrompt(html, round) {
  const prompt = html.match(new RegExp(
    '<details id="gpt-image-prompt-' + round + '"[^>]*>[\\s\\S]*?<p lang="en">([^<]+)</p>'
  ));
  assert(prompt, '缺少第 ' + round + ' 轮英文提示词');
  return prompt[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() + '\n';
}

async function replay(caseDirectory, outputDirectory, htmlPath) {
  const [html, sourceBytes, maskBytes] = await Promise.all([
    fs.readFile(htmlPath, 'utf8'),
    fs.readFile(path.join(caseDirectory, 'char003793.png')),
    fs.readFile(path.join(caseDirectory, 'char003793-skirt-mask.png'))
  ]);
  const payload = html.match(/<script id="demo-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert(payload, '流程 HTML 缺少内嵌的取样数据');
  const { assets, samples, local, stats } = JSON.parse(payload[1]);
  assert.deepEqual(local, { w: 1024, h: 1024 });
  assert.equal(samples.length, fixture.layout.length);

  const original = PNG.sync.read(sourceBytes);
  const originalMask = PNG.sync.read(maskBytes);
  requireSize(original, 2048, 1024);
  requireSize(originalMask, original.width, original.height);
  assert.equal(sha256(original.data), fixture.sourceRGBA, '原始图集与案例不匹配');
  assert.equal(sha256(originalMask.data), fixture.skirtMaskRGBA, '裙摆遮罩与案例不匹配');

  const round1Input = readAsset(assets, 'assembledInput');
  const round1Output = readAsset(assets, 'generated1');
  const round2Input = readAsset(assets, 'uvNativeInput');
  const round2Mask = readAsset(assets, 'uvNativeMask');
  const round2Output = readAsset(assets, 'generated2');
  const gen1 = PNG.sync.read(round1Output);
  const gen2 = PNG.sync.read(round2Output);
  const holeMask = PNG.sync.read(round2Mask);
  requireSize(PNG.sync.read(round1Input), 1024, 1024);
  requireSize(PNG.sync.read(round2Input), 768, 512);
  requireSize(holeMask, 768, 512);
  requireSize(gen1, 1254, 1254);
  requireSize(gen2, 1536, 1024);

  const round1 = Buffer.from(original.data);
  const final = Buffer.from(original.data);
  const seen = new Uint8Array(original.width * original.height);
  const parts = [];
  for (const { name, work, size, atlas } of fixture.layout) {
    const sample = samples.find(item => item.name === name);
    assert(sample, '缺少裙片：' + name);
    assert.deepEqual(atlas, sample.origin);
    assert.deepEqual(size, [sample.w, sample.h]);
    const packed = Buffer.from(sample.pixels, 'base64');
    assert.equal(packed.length, sample.w * sample.h * 4);
    const neighbors = new Map(fixture.neighbors[name] ?? []);
    const part = { name, first: 0, direct: 0, neighbor: 0, remaining: [] };

    for (let index = 0; index < packed.length / 4; index++) {
      const data = packed.readUInt32LE(index * 4);
      const phase = (data >>> 20) & 3;
      const x = index % sample.w;
      const y = Math.floor(index / sample.w);
      const workIndex = (work[1] + y) * 768 + work[0] + x;
      assert.equal(holeMask.data[workIndex * 4] === 255, phase === 2 || phase === 3);
      if (phase === 0) continue;

      const atlasX = atlas[0] + x;
      const atlasY = atlas[1] + y;
      const atlasIndex = atlasY * original.width + atlasX;
      assert.equal(seen[atlasIndex], 0, '同一个候选像素出现多次');
      seen[atlasIndex] = 1;
      assert(original.data[atlasIndex * 4 + 3] > 0 && originalMask.data[atlasIndex * 4] > 0);
      if (phase === 1) {
        const sourceIndex = data & 0xfffff;
        copyRGB(round1, atlasIndex, gen1, sourceIndex, 1024, 1024);
        copyRGB(final, atlasIndex, gen1, sourceIndex, 1024, 1024);
        part.first++;
      } else if (phase === 2) {
        const sourceIndex = neighbors.get(index) ?? workIndex;
        const dx = sourceIndex % 768 - work[0];
        const dy = Math.floor(sourceIndex / 768) - work[1];
        assert(dx >= 0 && dy >= 0 && dx < sample.w && dy < sample.h);
        const donorPhase = (packed.readUInt32LE((dy * sample.w + dx) * 4) >>> 20) & 3;
        assert(donorPhase === 1 || donorPhase === 2);
        assert(Math.hypot(dx - x, dy - y) <= 3);
        copyRGB(final, atlasIndex, gen2, sourceIndex, 768, 512);
        if (neighbors.delete(index)) part.neighbor++;
        else part.direct++;
      } else {
        part.remaining.push([atlasX, atlasY]);
      }
    }
    assert.equal(neighbors.size, 0, '部分邻近取样记录未使用');
    assert.deepEqual(sample.stats, {
      first: part.first, second: part.direct + part.neighbor, remaining: part.remaining.length
    });
    parts.push(part);
  }

  const summary = { first: 0, direct: 0, neighbor: 0, remaining: 0 };
  for (const part of parts) {
    summary.first += part.first;
    summary.direct += part.direct;
    summary.neighbor += part.neighbor;
    summary.remaining += part.remaining.length;
  }
  const second = summary.direct + summary.neighbor;
  assert.deepEqual(stats, {
    total: summary.first + second + summary.remaining,
    round1: summary.first, round2: second, direct2: summary.direct,
    neighbour2: summary.neighbor, remaining: summary.remaining
  });
  const expected = PNG.sync.read(readAsset(assets, 'atlasDownload'));
  requireSize(expected, original.width, original.height);
  assert(final.equals(expected.data), '计算结果与存档图集存在 RGBA 差异');

  const encodeAtlas = data => PNG.sync.write({ width: original.width, height: original.height, data });
  const files = {
    'round-1-input.png': round1Input,
    'round-1-output.png': round1Output,
    'round-1-valid-samples.png': readAsset(assets, 'assembledMask'),
    'round-1-prompt.txt': readPrompt(html, 1),
    'round-1-atlas.png': encodeAtlas(round1),
    'round-2-input.png': round2Input,
    'round-2-reference.png': round1Output,
    'round-2-mask.png': round2Mask,
    'round-2-output.png': round2Output,
    'round-2-prompt.txt': readPrompt(html, 2),
    'char003793-replayed.png': encodeAtlas(final),
    'reproduction.json': JSON.stringify({ stats, parts, finalRGBA: sha256(final) }, null, 2) + '\n'
  };
  await fs.mkdir(outputDirectory);
  await Promise.all(Object.entries(files).map(([name, contents]) =>
    fs.writeFile(path.join(outputDirectory, name), contents, { flag: 'wx' })
  ));
  console.log(JSON.stringify({ outputDirectory: path.resolve(outputDirectory), ...stats }, null, 2));
}

const [caseDirectory, outputDirectory, htmlPath = report] = process.argv.slice(2);
if (!caseDirectory || !outputDirectory || process.argv.includes('--help')) {
  console.log('用法：node replay-char003793.cjs <原素材目录> <新输出目录> [流程 HTML]');
  process.exitCode = process.argv.includes('--help') ? 0 : 1;
} else {
  replay(caseDirectory, outputDirectory, htmlPath).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
