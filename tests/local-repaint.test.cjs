'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PNG } = require('pngjs');
const { Generation } = require('../app/generation.cjs');
const { runRepaint } = require('../app/repaint-job.cjs');
const { repaintOptions } = require('../app/repaint-controls.cjs');
const { prepare, projectRoundOne } = require('../app/local-repaint.cjs');

const assembled = require('../app/workflows/local-repaint-assembled.qwen21.json');
const uv = require('../app/workflows/local-repaint-uv.qwen21.json');
const model = 'redqw21UNLOCKEDV2TI2I_redqw21UNLOCKEDV2_int8.safetensors';

test('built-in RunningHub jobs send full graphs and load the independent reference', async () => {
  const uploads = [];
  const key = 'test-key';
  let submitted;
  const generation = new Generation({
    fetch: async (url, options) => {
      if (url.hostname === 'rh-hk-images.xiaoyaoyou.com') {
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers, undefined);
        return new Response('output');
      }
      assert.equal(url.origin, 'https://www.runninghub.ai');
      const route = url.pathname.replace('/proxy-plus/test-key/', '');
      if (route === 'upload/image') {
        const image = options.body.get('image');
        uploads.push(await image.text());
        return Response.json({ name: image.name, subfolder: 'input' });
      }
      if (route === 'prompt') {
        submitted = JSON.parse(options.body);
        return Response.json({ prompt_id: 'job' });
      }
      if (route === 'history/job') {
        return Response.json({ job: { outputs: { 10: { images: [{ filename: 'output.png' }] } } } });
      }
      if (route === 'view') return Response.redirect('https://www.runninghub.ai/view?file=output.png');
      if (route === '/view') return Response.redirect('https://rh-hk-images.xiaoyaoyou.com/output.png');
      assert.fail('Unrecognized route ' + route);
    }
  });
  const result = await generation.generateBuiltIn({ cloudAddress: 'https://www.runninghub.ai/' }, uv, {
    image: Buffer.from('target'), mask: Buffer.from('holes'), reference: Buffer.from('assembled'),
    request: 'Teal fabric', steps: 25, seed: 793, denoise: .8
  }, key, new AbortController().signal, () => {});
  assert.deepEqual(uploads, ['target', 'holes', 'assembled']);
  assert.deepEqual(Object.keys(submitted), ['prompt']);
  assert.equal(submitted.prompt[1].inputs.image, 'input/image.png');
  assert.equal(submitted.prompt[2].inputs.image, 'input/mask.png');
  assert.equal(submitted.prompt[3].inputs.image, 'input/reference.png');
  assert.deepEqual(submitted.prompt[7].inputs['images.image_2'], ['3', 0]);
  assert.deepEqual(submitted.prompt[7].inputs['images.image_1'], ['15', 0]);
  assert.deepEqual(submitted.prompt[7].inputs['images.image_3'], ['16', 0]);
  assert.deepEqual(submitted.prompt[14].inputs.mask, ['17', 0]);
  assert.equal(submitted.prompt[8].inputs.denoise, .8);
  assert.equal(submitted.prompt[4].inputs.unet_name, model);
  assert.equal(assembled[4].inputs.unet_name, model);
  for (const [graph, target] of [[assembled, ['1', 0]], [submitted.prompt, ['15', 0]]]) {
    assert.deepEqual(graph[7].inputs['images.image_1'], target);
    assert.deepEqual(graph[7].inputs.resolution, ['19', 1]);
    assert.equal(graph[18].class_type, 'GetImageSize');
    assert.deepEqual(graph[18].inputs.image, target);
    assert.equal(graph[19].class_type, 'ComfyMathExpression');
    assert.deepEqual(graph[19].inputs, {
      expression: 'round(sqrt(a * b))',
      'values.a': ['18', 0],
      'values.b': ['18', 1]
    });
  }
  assert.equal(result.image.toString(), 'output');
});

test('two rounds project visible pixels and fill hidden pixels while preserving source alpha', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'bdmodder-local-repaint-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const source = new PNG({ width: 6, height: 2 });
  for (let i = 0; i < source.data.length; i += 4) source.data.set([124, 81, 155, 185], i);

  const rects = [
    { name: 'hidden', x: 0, y: 0, width: 2, height: 2 },
    { name: 'visible', x: 2, y: 0, width: 2, height: 2 }
  ];
  const vertices = [0, 2, 2, 2, 2, 0, 0, 0];
  const triangles = [0, 1, 2, 2, 3, 0];
  const shape = rect => ({
    region: rect.name, vertices, triangles, opacity: 1,
    uvs: [rect.x / 6, 0, (rect.x + 2) / 6, 0, (rect.x + 2) / 6, 1, rect.x / 6, 1]
  });
  const [hidden, visible] = rects.map(shape);
  let calls = 0;
  let firstOutput;
  const firstColor = [52, 116, 110], secondColor = [68, 140, 125];
  const generation = {
    async generateBuiltIn(settings, graph, input) {
      calls++;
      const image = PNG.sync.read(Buffer.from(input.image));
      const holeMask = input.mask && PNG.sync.read(Buffer.from(input.mask));
      if (holeMask) {
        assert.equal(graph, uv);
        assert(input.reference.equals(firstOutput));
        assert.equal(image.width, 768);
        assert.equal(image.height, 512);
      } else {
        assert.equal(graph, assembled);
        assert.equal(image.width, 1024);
      }
      for (let i = 0; i < image.data.length; i += 4) {
        const foreground = holeMask ? holeMask.data[i] === 255 : image.data[i] !== 224;
        if (!foreground) continue;
        if (holeMask) {
          image.data.set([224, 224, 224], i);
          image.data.set(secondColor, i - 6 * 4);
        } else image.data.set(firstColor, i);
      }
      const bytes = PNG.sync.write(image);
      if (!holeMask) firstOutput = bytes;
      return { image: bytes, id: String(calls) };
    }
  };
  const result = await runRepaint({
    generation, settings: {}, key: 'test-key', signal: new AbortController().signal, progress() {},
    session: folder, atlasBytes: PNG.sync.write(source), rects,
    snapshot: { draws: [visible], footprints: [hidden, visible], animation: 'idle', time: 0 },
    input: { request: 'teal', steps: 25, seed: 1, denoise: .8, maskExpand: 0, maskFeather: 0 }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.stats, { total: 8, first: 4, direct: 4, neighbor: 0, remaining: 0 });
  assert.equal(result.alignment.find(part => part.name === 'hidden').dx, -6);
  const atlas = PNG.sync.read(result.atlas);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 6; x++) {
      const start = (y * 6 + x) * 4;
      const actual = [...atlas.data.subarray(start, start + 4)];
      const expected = x < 2 ? [...secondColor, 185] : x < 4 ? [...firstColor, 185] : [124, 81, 155, 185];
      assert.deepEqual(actual, expected);
    }
  }
});

test('ARGB writes transparent and translucent samples through both rounds into a premultiplied atlas', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'bdmodder-argb-repaint-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const source = new PNG({ width: 6, height: 2 });
  for (let i = 0; i < source.data.length; i += 4) source.data.set([75, 45, 95, 160], i);

  const rects = [
    { name: 'visible', x: 0, y: 0, width: 2, height: 2 },
    { name: 'hidden', x: 2, y: 0, width: 2, height: 2 }
  ];
  const footprints = rects.map(({ name, x, width }) => ({
    region: name, opacity: 1, vertices: [0, 2, 2, 2, 2, 0, 0, 0], triangles: [0, 1, 2, 2, 3, 0],
    uvs: [x / 6, 0, (x + width) / 6, 0, (x + width) / 6, 1, x / 6, 1]
  }));
  const snapshot = { draws: [footprints[0]], footprints, premultiplied: true, animation: 'idle', time: 0 };
  const atlasBytes = PNG.sync.write(source);
  let opaqueFirstOutput;
  const generation = {
    async generateBuiltIn(settings, graph, input) {
      const image = PNG.sync.read(Buffer.from(input.image));
      if (graph === assembled) {
        const foreground = [];
        for (let i = 0; i < image.data.length; i += 4) {
          if (image.data[i] === 224) continue;
          foreground.push(i);
          image.data.set([100, 150, 200, 255], i);
        }
        opaqueFirstOutput = PNG.sync.write(image, { colorType: 2 });
        for (const [index, i] of foreground.entries()) image.data[i + 3] = index === 0 ? 0 : 64;
        return { image: PNG.sync.write(image), id: 'first' };
      }
      const mask = PNG.sync.read(Buffer.from(input.mask));
      const scaled = new PNG({ width: image.width * 2, height: image.height * 2 });
      for (let y = 0; y < scaled.height; y++) {
        for (let x = 0; x < scaled.width; x++) {
          const offset = (Math.floor(y / 2) * image.width + Math.floor(x / 2)) * 4;
          const rgba = mask.data[offset] ? [64, 128, 192, 96] : image.data.subarray(offset, offset + 4);
          scaled.data.set(rgba, (y * scaled.width + x) * 4);
        }
      }
      return { image: PNG.sync.write(scaled), id: 'second' };
    }
  };
  const result = await runRepaint({
    generation, settings: {}, key: 'test-key', signal: new AbortController().signal, progress() {},
    session: folder, atlasBytes, rects, snapshot,
    input: { request: 'transparent fabric', writebackMode: 'argb', maskExpand: 0, maskFeather: 0 }
  });
  assert.deepEqual(result.stats, { total: 8, first: 4, direct: 4, neighbor: 0, remaining: 0 });
  assert.equal(result.details.options.writebackMode, 'argb');
  const atlas = PNG.sync.read(result.atlas);
  assert.deepEqual([...atlas.data.subarray(0, 16)], [0, 0, 0, 0, 25, 38, 50, 64, 24, 48, 72, 96, 24, 48, 72, 96]);
  assert.deepEqual([...atlas.data.subarray(16, 24)], [75, 45, 95, 160, 75, 45, 95, 160]);

  const prepared = prepare({ atlasBytes, rects, snapshot });
  const rgbFallback = projectRoundOne({ atlasBytes, rects, prepared, generated: opaqueFirstOutput, writebackMode: 'argb' });
  assert.equal(rgbFallback.count, 4);
  assert.deepEqual([...PNG.sync.read(rgbFallback.atlas).data.subarray(0, 4)], [63, 94, 125, 160]);
});

test('UV sampling crosses internal triangle edges and respects mesh overlap', () => {
  const image = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < image.data.length; i += 4) image.data.set([120, 85, 145, 255], i);
  const rects = [{ name: 'body', x: 0, y: 0, width: image.width, height: image.height }];
  const draw = {
    region: 'body', opacity: 1, vertices: [0, 8, 8, 8, 8, 0, 0, 0],
    triangles: [0, 1, 2, 2, 3, 0], uvs: [0, 0, 1, 0, 1, 1, 0, 1]
  };
  const atlasBytes = PNG.sync.write(image);
  const snapshot = { draws: [draw], footprints: [draw] };
  const prepared = prepare({ atlasBytes, rects, snapshot });
  const output = PNG.sync.read(prepared.image);
  for (let i = 0; i < output.data.length; i += 4) {
    if (output.data[i] === 120) output.data.set([48, 131, 115], i);
  }
  const first = projectRoundOne({ atlasBytes, rects, prepared, generated: PNG.sync.write(output) });
  assert.equal(first.count, image.width * image.height);
  assert.equal(first.image, undefined);

  // Fold the second UV triangle over the first in screen space.
  const folded = { ...draw, vertices: [0, 8, 8, 8, 8, 0, 8, 8] };
  const overlap = prepare({ atlasBytes, rects, snapshot: { ...snapshot, draws: [folded] } });
  assert(overlap.sources[image.width - 1] >= 0);
  assert.equal(overlap.sources[(image.height - 1) * image.width], -1);
});

test('seam overlap shares a model sample between neighboring parts', () => {
  const source = new PNG({ width: 9, height: 4 });
  for (let i = 0; i < source.data.length; i += 4) source.data.set([120, 85, 145, 255], i);
  const rects = [
    { name: 'left', x: 0, y: 0, width: 4, height: 4 },
    { name: 'right', x: 5, y: 0, width: 4, height: 4 }
  ];
  const quad = (rect, x) => ({
    region: rect.name, opacity: 1, vertices: [x, 4, x + 4, 4, x + 4, 0, x, 0],
    uvs: [rect.x / 9, 0, (rect.x + 4) / 9, 0, (rect.x + 4) / 9, 1, rect.x / 9, 1],
    triangles: [0, 1, 2, 2, 3, 0]
  });
  const draws = [quad(rects[0], 0), quad(rects[1], 2)];
  const atlasBytes = PNG.sync.write(source);
  const snapshot = { draws, footprints: draws };
  const baseline = prepare({ atlasBytes, rects, snapshot });
  const prepared = prepare({ atlasBytes, rects, snapshot, seamExpand: 1 });
  const left = 2, right = 5;
  assert.equal(baseline.sources[left], -1);
  assert.equal(prepared.seamSources[left], prepared.sources[right]);
  assert.equal(prepared.seamSources[left + 1], -1);
  const output = PNG.sync.read(prepared.image);
  for (const index of prepared.sources) if (index >= 0) output.data.set([48, 131, 115], index * 4);
  const first = projectRoundOne({ atlasBytes, rects, prepared, generated: PNG.sync.write(output), maskExpand: 1, maskFeather: 2 });
  assert(first.seamCount > 0);
  const result = PNG.sync.read(first.atlas);
  const pixel = index => [...result.data.subarray(index * 4, index * 4 + 4)];
  assert.deepEqual(pixel(left), [48, 131, 115, 255]);
  assert.deepEqual(pixel(right), pixel(left));
  assert.deepEqual(pixel(left + 1), [120, 85, 145, 255]);
  assert.deepEqual(pixel(4), [120, 85, 145, 255]);

  const work = first.layout[0];
  const hard = PNG.sync.read(first.mask), soft = PNG.sync.read(first.modelMask);
  const redAt = (image, x, y) => image.data[(y * image.width + x) * 4];
  const x = work.workX + 3, y = work.workY;
  assert.equal(redAt(hard, x, y), 255);
  assert.equal(redAt(hard, x + 1, y), 0);
  assert.equal(redAt(soft, x, y), 255);
  assert.equal(redAt(soft, x + 1, y), 255);
  assert.equal(redAt(soft, x + 2, y), 128);
  assert.equal(redAt(soft, x + 3, y), 0);

  const large = repaintOptions({ seamExpand: Number.MAX_SAFE_INTEGER, maskExpand: 64, maskFeather: 1024 });
  const wide = prepare({ atlasBytes, rects, snapshot, seamExpand: large.seamExpand });
  assert.equal(wide.seamSources[left + 1], wide.sources[right + 1]);
  const largeMask = projectRoundOne({ atlasBytes, rects, prepared: baseline, generated: PNG.sync.write(output), ...large });
  assert(largeMask.width <= 2048 && largeMask.height <= 2048);
  const largeHard = PNG.sync.read(largeMask.mask);
  const largeSoft = PNG.sync.read(largeMask.modelMask);
  const edge = largeMask.layout[0];
  assert.equal(redAt(largeHard, edge.workX - 48, edge.workY), 0);
  assert.equal(redAt(largeSoft, edge.workX - 48, edge.workY), 255);
  const feathered = redAt(largeSoft, edge.workX - 512, edge.workY);
  assert(feathered > 0 && feathered < 255);
  assert.throws(() => repaintOptions({ maskExpand: -1 }), /非负整数/);
  assert.throws(() => repaintOptions({ maskFeather: 1.5 }), /非负整数/);
});
