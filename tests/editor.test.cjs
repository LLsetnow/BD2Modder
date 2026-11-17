'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PNG } = require('pngjs');
const { zipSync, unzipSync } = require('fflate');
const { Project, importZip, safeRelative, validateManifest } = require('../app/project.cjs');
const { edit, mask, decodeBytes, encodeBytes, unpickle } = require('../app/texture.cjs');
const { Generation, normalizeProfile, validateProfile, bind } = require('../app/generation.cjs');
const { Settings } = require('../app/settings.cjs');
function image() { const png = new PNG({ width: 4, height: 4 }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 40; png.data[i + 1] = 80; png.data[i + 2] = 120; png.data[i + 3] = i === 0 ? 0 : 255; } return PNG.sync.write(png); }
const rect = { x: 0, y: 0, width: 2, height: 2 };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bdmodder-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, '测试 MOD'); await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'page.png'), image());
  await fs.writeFile(path.join(folder, 'character.atlas'), 'page.png\nsize:4,4\nfilter:Linear,Linear\npart\nbounds:0,0,2,2\n');
  await fs.writeFile(path.join(folder, 'character.json'), JSON.stringify({ skeleton: { spine: '4.1.24' }, bones: [{ name: 'root' }], slots: [], skins: [], animations: {} }));
  await fs.writeFile(path.join(folder, 'character.modfile'), '{"version":2,"type":"loop","custom":"keep me"}'); return { root, folder };
}
test('selection edits preserve transparent alpha and pixels outside selection', () => {
  const original = PNG.sync.read(image()), tinted = PNG.sync.read(edit(image(), 'tint', [rect], { color: '#ff0000', strength: 1 }));
  assert.equal(tinted.data[3], 0); assert.notEqual(tinted.data[4], original.data[4]); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (x >= 2 || y >= 2) { const p = (y * 4 + x) * 4; assert.deepEqual(tinted.data.subarray(p, p + 4), original.data.subarray(p, p + 4)); }
  const hidden = PNG.sync.read(edit(image(), 'hide', [rect])); assert.equal(hidden.data[7], 0); assert.equal(hidden.data[15], 255);
  const selection = PNG.sync.read(mask(image(), [rect])); assert.equal(selection.data[0], 0); assert.equal(selection.data[4], 255); assert.equal(selection.data[12], 0); assert.equal(selection.data[15], 255);
  const replacement = new PNG({ width: 4, height: 4 }); replacement.data.fill(255); const merged = PNG.sync.read(edit(image(), 'merge', [rect], { image: PNG.sync.write(replacement), preserveAlpha: true })); assert.equal(merged.data[3], 0); assert.equal(merged.data[7], 255); assert.equal(merged.data[4], 255);
  assert.throws(() => edit(image(), 'hide', [{ x: 3, y: 3, width: 2, height: 2 }]), /超出/);
});
test('compressed Unity texture roundtrip preserves all channel layouts and row direction', () => {
  for (const format of [3, 4, 5, 14]) { const header = Buffer.alloc(16); header.writeInt32LE(format, 8); const compressed = encodeBytes(image(), header); assert.deepEqual(PNG.sync.read(decodeBytes(compressed)).data, PNG.sync.read(image()).data); }
  assert.throws(() => decodeBytes(Buffer.alloc(20)), /无效/); assert.throws(() => unpickle(Buffer.from([64, 10, 0]), 20), /长度/);
  const packed = Buffer.from([64, 2, 0x12, 65, 1, 0, 0x10, 66]); assert.equal(unpickle(packed, 8).toString(), 'AAAAAAAB');
});
test('loading, undo after save, backup and ZIP export retain unrelated files and metadata', async t => {
  const { root, folder } = await fixture(t); const original = await fs.readFile(path.join(folder, 'page.png'));
  const p = new Project(folder); const descriptor = await p.load(); assert.equal(descriptor.pages.length, 1); assert.equal(p.dirty(), false);
  await p.mutate('page.png', 'hide', [rect]); assert.equal(p.dirty(), true); assert.deepEqual(await fs.readFile(path.join(folder, 'page.png')), original);
  const saved = await p.save(); assert.equal(p.dirty(), false); assert.deepEqual(await fs.readFile(path.join(saved.backup, 'page.png')), original);
  p.undo(); assert.equal(p.dirty(), true); assert.deepEqual(p.page('page.png').bytes, original); p.undo(true); assert.equal(p.dirty(), false);
  const zip = await p.zip(), entries = unzipSync(zip); assert.equal(Object.keys(entries).some(n => n.includes('backups')), false); assert.equal(JSON.parse(Buffer.from(entries['测试 MOD/character.modfile'])).custom, 'keep me');
  const zipPath = path.join(root, 'mod.zip'); await fs.writeFile(zipPath, zip); const imported = await importZip(zipPath, path.join(root, 'imports')); assert.equal(imported.temporary, true); assert.equal(imported.pages.size, 1);
  const destination = path.join(root, 'new-mod'); await imported.saveAs(destination); assert.ok((await new Project(destination).load()).skeletonBytes.length);
  await assert.rejects(p.saveAs(path.join(folder, 'nested')), /重叠/);
});
test('archive traversal, invalid modfile and incomplete material fail before originals change', async t => {
  const { root, folder } = await fixture(t); for (const name of ['../escape', '/absolute', 'C:/drive', 'a\\b', 'a/../b', 'NUL.png']) assert.throws(() => safeRelative(name));
  assert.throws(() => validateManifest([{ type: 'all' }, { type: 'loop' }]), /冲突/);
  const archive = path.join(root, 'bad.zip'); await fs.writeFile(archive, zipSync({ '../escape.txt': Buffer.from('bad') })); await assert.rejects(importZip(archive, path.join(root, 'cache')), /路径/);
  await fs.unlink(path.join(folder, 'page.png')); await assert.rejects(new Project(folder).load(), /缺少图集/);
});
test('save detects external modifications and does not overwrite them', async t => {
  const { folder } = await fixture(t), p = new Project(folder); await p.load(); await p.mutate('page.png', 'hide', [rect]);
  const external = edit(image(), 'tint', [{ x: 2, y: 2, width: 1, height: 1 }], { color: '#00ff00', strength: 1 }); await fs.writeFile(path.join(folder, 'page.png'), external);
  await assert.rejects(p.save(), /其他程序/); assert.deepEqual(await fs.readFile(path.join(folder, 'page.png')), external); assert.equal(p.dirty(), true);
});
test('settings never expose or persist plaintext credentials', async t => {
  const { root } = await fixture(t), secrets = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from(text.split('').reverse().join('')), decryptStringAsync: async bytes => ({ result: bytes.toString().split('').reverse().join('') }) };
  const cfg = new Settings(path.join(root, 'settings'), secrets); await cfg.load(); const result = await cfg.save({ apiKey: 'private-test-value', address: 'http://localhost:8188' }); assert.equal(result.hasKey, true); assert.equal('encryptedKey' in result, false); assert.equal(cfg.key(), 'private-test-value');
  assert.equal((await fs.readFile(path.join(root, 'settings/settings.json'), 'utf8')).includes('private-test-value'), false);
  const loaded = new Settings(path.join(root, 'settings'), secrets); await loaded.load(); assert.equal(loaded.key(), 'private-test-value'); await loaded.save({ clearKey: true }); assert.equal(loaded.key(), '');
});
function profile() { return normalizeProfile({ '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } }, '2': { class_type: 'LoadImageMask', inputs: { image: 'mask.png', channel: 'alpha' } }, '3': { class_type: 'CLIPTextEncode', inputs: { text: 'old' } }, '4': { class_type: 'SaveImage', inputs: { images: ['1', 0] } } }); }
test('workflow mapping preserves graph links, binds prompts, and uses independent red mask', () => {
  const p = profile(); validateProfile(p); const graph = bind(p, { request: 'blue dress', seed: 7 }, { image: 'new.png', mask: 'new-mask.png' });
  assert.equal(graph['1'].inputs.image, 'new.png'); assert.equal(graph['2'].inputs.channel, 'red'); assert.equal(graph['3'].inputs.text, 'blue dress'); assert.deepEqual(graph['4'].inputs.images, ['1', 0]); assert.equal(p.workflow['1'].inputs.image, 'old.png');
  p.bindings[0].field = 'missing'; assert.throws(() => validateProfile(p), /无效/);
});
test('workflow suggestions work when negative prompt and mask loaders precede positive inputs', () => {
  const p = normalizeProfile({ '1': { class_type: 'CLIPTextEncode', _meta: { title: 'negative' }, inputs: { text: 'bad' } }, '2': { class_type: 'LoadImage', _meta: { title: 'mask' }, inputs: { image: 'mask.png' } }, '3': { class_type: 'LoadImage', inputs: { image: 'source.png' } }, '4': { class_type: 'CLIPTextEncode', inputs: { text: 'good' } }, '5': { class_type: 'ImageToMask', inputs: { image: ['2', 0], channel: 'alpha' } }, '6': { class_type: 'SaveImage', inputs: { images: ['3', 0] } } });
  validateProfile(p); assert.equal(p.bindings.find(b => b.value === 'positive').node, '4'); assert.equal(p.bindings.find(b => b.value === 'image').node, '3');
});
test('ComfyUI task executes against a mock service and records the submitted task', async () => {
  const requests = [], records = []; let history = 0;
  const fakeFetch = async (url, options) => {
    requests.push({ url: String(url), options }); let body;
    if (url.pathname === '/object_info') body = Object.fromEntries(['LoadImage', 'LoadImageMask', 'CLIPTextEncode', 'SaveImage'].map(n => [n, {}]));
    else if (url.pathname === '/upload/image') body = { subfolder: 'test', name: 'image.png' };
    else if (url.pathname === '/prompt') { const graph = JSON.parse(options.body).prompt; assert.equal(graph['2'].inputs.channel, 'red'); body = { prompt_id: 'task-123' }; }
    else if (url.pathname === '/history/task-123') { history++; body = { 'task-123': { outputs: { '4': { images: [{ filename: 'out.png' }] } } } }; }
    else if (url.pathname === '/view') return new Response(image());
    else throw Error('Unexpected endpoint ' + url);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const engine = new Generation({ fetch: fakeFetch, pollMs: 1 }); const out = await engine.generate({ address: 'http://localhost:8188/' }, 'ComfyUI', profile(), { image: image(), mask: mask(image(), [rect]), request: 'blue', width: 4, height: 4, steps: 20, seed: 1, denoise: .4 }, '', new AbortController().signal, () => {}, async r => records.push(r));
  assert.equal(out.id, 'task-123'); assert.equal(history, 1); assert.equal(records[0].id, 'task-123'); assert.deepEqual(out.image, image()); assert.equal(requests.length, 6);
});
test('RunningHub validates the cloud workflow and sends only explicit node overrides', async () => {
  const p = profile(); p.workflowId = '1234'; const key = 'test-key'; const fakeFetch = async (url, options) => {
    let data; const route = url.pathname;
    if (route === '/api/openapi/getJsonApiFormat') data = { prompt: p.workflow };
    else if (route === '/openapi/v2/media/upload/binary') data = { fileName: 'uploaded.png' };
    else if (route === '/task/openapi/create') { const payload = JSON.parse(options.body); assert.equal(payload.apiKey, key); assert.ok(payload.nodeInfoList.some(n => n.fieldName === 'channel' && n.fieldValue === 'red')); data = { taskId: 'cloud-1' }; }
    else if (route === '/task/openapi/outputs') data = [{ nodeId: '4', fileUrl: 'https://results.example/output.png' }];
    else if (url.host === 'results.example') { assert.equal(options.headers?.Authorization, undefined); return new Response(image()); }
    else throw Error('Unexpected endpoint ' + url);
    return new Response(JSON.stringify({ code: 0, data }));
  };
  const engine = new Generation({ fetch: fakeFetch, pollMs: 1 }); const out = await engine.generate({ cloudAddress: 'https://cloud.example/' }, 'RunningHub', p, { image: image(), mask: mask(image(), [rect]), request: 'blue', width: 4, height: 4 }, key, new AbortController().signal, () => {}); assert.equal(out.id, 'cloud-1');
});
