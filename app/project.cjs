'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { task } = require('./tasks.cjs');
const { atlasRegions, partKey, hiddenSignature } = require('./visibility.cjs');
const EDITOR_FILE = '.bdmodder-editor.json';
const hash = bytes => bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
const MAX_FILE = 256 * 1024 * 1024;
function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) throw Error('素材包含无效或不安全的路径：' + name);
  return name;
}
function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
async function regular(file) { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw Error('不支持链接、非普通文件或超大文件：' + path.basename(file)); return stat; }
async function read(file) { await regular(file); return fs.readFile(file); }
async function filesUnder(root) {
  const result = []; let total = 0;
  async function visit(dir) {
    const stat = await fs.lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('不支持链接目录。');
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (/^(\.bdmodder|\.studio|\.git|node_modules)/i.test(e.name) || /\.(zip|studio-backup.*|bdmodder-tmp)$/.test(e.name)) continue;
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw Error('素材中不能包含链接。');
      if (e.isDirectory()) await visit(file);
      else { const stat = await regular(file); total += stat.size; if (total > 1024 * 1024 * 1024 || result.length >= 10000) throw Error('素材总量过大。'); result.push(path.relative(root, file).split(path.sep).join('/')); }
    }
  }
  await visit(root); return result;
}
function validateManifest(value) {
  const entries = Array.isArray(value) ? value : [value];
  if (!entries.length || entries.some(e => !e || typeof e !== 'object' || Array.isArray(e))) throw Error('modfile 必须是对象或非空对象数组。');
  const types = entries.map(e => e.type || 'loop');
  if (new Set(types).size !== types.length || (types.length > 1 && types.includes('all'))) throw Error('modfile 类型重复或 all 与其他类型冲突。');
  return value;
}
class Project {
  constructor(folder, temporary = false) {
    this.root = path.resolve(folder); this.temporary = temporary; this.id = crypto.randomUUID(); this.pages = new Map(); this.history = []; this.future = []; this.revision = 0; this.lock = false;
    this.hiddenParts = new Map(); this.renderCache = new Map(); this.savedHidden = '[]'; this.editorHash = null;
  }
  async load() {
    const stat = await fs.lstat(this.root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('请选择普通的 MOD 文件夹。');
    this.files = await filesUnder(this.root);
    const roots = this.files.filter(f => !f.includes('/'));
    const atlases = roots.filter(f => /\.atlas$/i.test(f));
    if (atlases.length !== 1) throw Error('请选择单个 MOD 文件夹，根目录需要恰好一个 .atlas 文件。');
    this.atlasName = atlases[0]; this.atlasText = (await read(path.join(this.root, this.atlasName))).toString('utf8').replace(/^\uFEFF/, '');
    const skeletons = roots.filter(f => /\.skel$/i.test(f));
    for (const file of roots.filter(f => /\.json$/i.test(f))) { const b = await read(path.join(this.root, file)); try { if (Array.isArray(JSON.parse(b.toString('utf8').replace(/^\uFEFF/, '')).bones)) skeletons.push(file); } catch {} }
    if (skeletons.length !== 1) throw Error('根目录需要恰好一份 Spine 骨骼（.skel 或含 bones 的 JSON）。');
    this.skeletonName = skeletons[0]; this.skeletonBytes = await read(path.join(this.root, this.skeletonName));
    const manifestFiles = roots.filter(f => /\.modfile$/i.test(f));
    if (manifestFiles.length > 1) throw Error('此目录包含多个 MOD，请选择其中单个 MOD 的目录。');
    this.manifestName = manifestFiles[0] || path.basename(this.skeletonName, path.extname(this.skeletonName)) + '.modfile';
    this.manifestText = manifestFiles.length ? (await read(path.join(this.root, this.manifestName))).toString('utf8').replace(/^\uFEFF/, '') : '{"version":2,"type":"loop"}';
    if (!this.manifestText.trim()) this.manifestText = '{"version":2,"type":"loop"}';
    validateManifest(JSON.parse(this.manifestText)); this.savedManifest = this.manifestText;
    const pageNames = [...new Set(this.atlasText.split(/\r?\n/).map(l => l.trim()).filter(l => /\.png$/i.test(l)))];
    if (!pageNames.length || pageNames.length > 128) throw Error('atlas 没有有效 PNG 图集页，或图集页数量过多。');
    let nextPage = 0;
    await Promise.all(Array.from({ length: Math.min(3, pageNames.length) }, async () => { while (nextPage < pageNames.length) { const name = pageNames[nextPage++];
      safeRelative(name); if (name.includes('/')) throw Error('图集页必须位于 MOD 根目录。');
      const sourceName = roots.includes(name) ? name : roots.includes(name + '.bytes') ? name + '.bytes' : null;
      if (!sourceName) throw Error('缺少图集页：' + name);
      const image = await task('texture', { path: path.join(this.root, sourceName) }); const bytes = Buffer.from(image.bytes);
      this.pages.set(name, { name, sourceName, width: image.width, height: image.height, bytes, original: bytes, saved: bytes, diskHash: image.hash });
    } }));
    this.regions = atlasRegions(this.atlasText, this.pages);
    let editorBytes; try { editorBytes = await read(path.join(this.root, EDITOR_FILE)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (editorBytes) {
      if (editorBytes.length > 2 * 1024 * 1024) throw Error('编辑器隐藏记录过大。');
      const data = JSON.parse(editorBytes.toString('utf8'));
      if (data.version !== 1 || !Array.isArray(data.hiddenParts) || data.hiddenParts.length > 10000) throw Error('编辑器隐藏记录格式无效。');
      for (const part of data.hiddenParts) { const key = partKey(part), region = this.regions.get(key); if (!region) throw Error('隐藏记录中的部件已不在图集中：' + part.name); this.hiddenParts.set(key, region); }
      this.editorHash = hash(editorBytes);
    }
    this.savedHidden = hiddenSignature(this.hiddenParts.values());
    this.totalBytes = (await Promise.all(this.files.map(f => fs.stat(path.join(this.root, f))))).reduce((sum, stat) => sum + stat.size, 0);
    return this.descriptor();
  }
  dirty() { return this.manifestText !== this.savedManifest || hiddenSignature(this.hiddenParts.values()) !== this.savedHidden || [...this.pages.values()].some(p => !p.bytes.equals(p.saved)); }
  status() { return { id: this.id, revision: this.revision, dirty: this.dirty(), undo: this.history.length > 0, redo: this.future.length > 0, root: this.root, temporary: this.temporary, manifestText: this.manifestText, hiddenParts: [...this.hiddenParts.values()] }; }
  descriptor() { return { ...this.status(), name: path.basename(this.root), atlasName: this.atlasName, atlasText: this.atlasText, skeletonName: this.skeletonName, skeletonBytes: this.skeletonBytes, pages: [...this.pages.values()].map(({ name, width, height }) => ({ name, width, height })), fileCount: this.files.length, totalBytes: this.totalBytes }; }
  page(name) { const value = this.pages.get(name); if (!value) throw Error('未找到该图集页。'); return value; }
  checkpoint(change) {
    this.history.push(change); this.future = []; this.revision++; this.renderCache.clear();
    let bytes = this.history.reduce((sum, c) => sum + (c.before?.length || 0) + (c.after?.length || 0), 0);
    while (this.history.length > 1 && (this.history.length > 30 || bytes > 256 * 1024 * 1024)) { const c = this.history.shift(); bytes -= (c.before?.length || 0) + (c.after?.length || 0); }
  }
  setVisibility(parts, hidden) {
    if (this.lock) throw Error('后台操作执行中。');
    if (!Array.isArray(parts) || !parts.length || parts.length > 10000 || typeof hidden !== 'boolean') throw Error('请选择需要隐藏或显示的部件。');
    const regions = parts.map(part => { const r = this.regions.get(partKey(part)); if (!r) throw Error('图集部件不存在。'); return r; });
    const before = [...this.hiddenParts.values()], next = new Map(this.hiddenParts);
    for (const r of regions) { if (hidden) next.set(partKey(r), r); else next.delete(partKey(r)); }
    if (hiddenSignature(before) !== hiddenSignature(next.values())) { this.checkpoint({ visibility: true, before, after: [...next.values()] }); this.hiddenParts = next; }
    return this.status();
  }
  async loadPartMeshes() {
    const [spine, { createPartMeshLookup, fixAtlasRotations, readSpineData }] = await Promise.all([
      import('@esotericsoftware/spine-core'), import('../renderer/spine-compat.mjs')
    ]);
    const atlas = new spine.TextureAtlas(this.atlasText);
    fixAtlasRotations(atlas);
    for (const page of atlas.pages) {
      const { width, height } = this.page(page.name);
      page.setTexture({ getImage: () => ({ width, height }), setFilters() {}, setWraps() {} });
    }
    const data = readSpineData(spine, atlas, this);
    return createPartMeshLookup(spine, atlas, data);
  }
  async renderedPage(name, { bytes = this.page(name).bytes, gray = false } = {}) {
    const parts = [...this.hiddenParts.values()].filter(part => part.page === name);
    if (!parts.length) return bytes;
    const operation = gray ? 'gray' : 'hide';
    const key = JSON.stringify([name, operation]);
    const cached = this.renderCache.get(key);
    if (cached?.bytes === bytes) return cached.result;

    this.partMeshes ??= this.loadPartMeshes();
    const result = this.partMeshes.then(meshes => task('edit', {
      bytes, operation, rects: parts.map(part => ({ ...part, meshes: meshes(part) }))
    })).then(Buffer.from).catch(error => {
      if (this.renderCache.get(key)?.result === result) this.renderCache.delete(key);
      throw error;
    });
    this.renderCache.set(key, { bytes, result });
    return result;
  }
  async mutate(name, operation, rects, options) {
    if (this.lock) throw Error('正在处理上一项操作。'); this.lock = true;
    try { const page = this.page(name); if (operation === 'restore') options = { image: page.original }; const next = Buffer.from(await task('edit', { bytes: page.bytes, operation, rects, options })); if (!next.equals(page.bytes)) { this.checkpoint({ page: name, before: page.bytes, after: next }); page.bytes = next; } return this.status(); } finally { this.lock = false; }
  }
  async replaceAssembled(name, rects, snapshot, imageBytes) {
    if (this.lock) throw Error('正在处理上一项操作。'); this.lock = true;
    try {
      const page = this.page(name);
      const next = Buffer.from(await task('repaintReplace', { atlasBytes: page.bytes, rects, snapshot, imageBytes }));
      if (!next.equals(page.bytes)) { this.checkpoint({ page: name, before: page.bytes, after: next }); page.bytes = next; }
      return this.status();
    } finally { this.lock = false; }
  }
  async replacePage(name, bytes) {
    const page = this.page(name); return this.mutate(name, 'merge', [{ x: 0, y: 0, width: page.width, height: page.height }], { image: bytes });
  }
  setManifest(text) { if (typeof text !== 'string' || text.length > 1024 * 1024) throw Error('modfile 配置过大。'); validateManifest(JSON.parse(text)); if (text !== this.manifestText) { this.checkpoint({ manifest: true, before: this.manifestText, after: text }); this.manifestText = text; } return this.status(); }
  undo(redo = false) { if (this.lock) throw Error('后台操作执行中。'); const from = redo ? this.future : this.history, to = redo ? this.history : this.future, change = from.pop(); if (change) { const value = redo ? change.after : change.before; if (change.manifest) this.manifestText = value; else if (change.visibility) this.hiddenParts = new Map(value.map(r => [partKey(r), r])); else this.page(change.page).bytes = value; to.push(change); this.revision++; this.renderCache.clear(); } return this.status(); }
  async materialize() {
    const out = {};
    for (const name of this.files) out[name] = await read(path.join(this.root, name));
    for (const page of this.pages.values()) {
      const bytes = await this.renderedPage(page.name);
      out[page.sourceName] = page.sourceName.endsWith('.bytes') ? Buffer.from(await task('encode', { bytes, original: out[page.sourceName] })) : bytes;
    }
    out[this.manifestName] = Buffer.from(this.manifestText); return out;
  }
  async save() {
    if (this.temporary) throw Error('ZIP 导入的项目请先另存为 MOD 文件夹。');
    if (this.lock) throw Error('后台操作执行中。'); this.lock = true;
    const staged = [], committed = [], backup = path.join(this.root, '.bdmodder-backups', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'));
    try {
      const changes = [];
      if (hiddenSignature(this.hiddenParts.values()) !== this.savedHidden) {
        const target = path.join(this.root, EDITOR_FILE); let disk = null; try { disk = await read(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (hash(disk) !== this.editorHash) throw Error('隐藏记录已被其他程序修改，请先另存为副本。');
        changes.push({ target, bytes: Buffer.from(JSON.stringify({ version: 1, hiddenParts: [...this.hiddenParts.values()].map(({ page, name }) => ({ page, name })) }, null, 2)) });
      }
      for (const page of this.pages.values()) if (!page.bytes.equals(page.saved)) {
        const target = path.join(this.root, page.sourceName), disk = await read(target);
        if (crypto.createHash('sha256').update(disk).digest('hex') !== page.diskHash) throw Error('图集已被其他程序修改，请另存为副本或重新打开后再编辑：' + page.name);
        const bytes = page.sourceName.endsWith('.bytes') ? Buffer.from(await task('encode', { bytes: page.bytes, original: disk })) : page.bytes;
        changes.push({ target, bytes });
      }
      if (this.manifestText !== this.savedManifest || !this.files.includes(this.manifestName)) {
        if (this.files.includes(this.manifestName)) { const disk = (await read(path.join(this.root, this.manifestName))).toString('utf8').replace(/^\uFEFF/, ''); if ((disk.trim() ? disk : '{"version":2,"type":"loop"}') !== this.savedManifest) throw Error('modfile 已被其他程序修改，请先另存为副本。'); }
        changes.push({ target: path.join(this.root, this.manifestName), bytes: Buffer.from(this.manifestText) });
      }
      if (!changes.length) return this.status();
      await fs.mkdir(backup, { recursive: true });
      for (const change of changes) {
        let previous = null; try { previous = await read(change.target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (previous) await fs.writeFile(path.join(backup, path.basename(change.target)), previous, { flag: 'wx' });
        const temp = change.target + '.' + crypto.randomUUID() + '.bdmodder-tmp'; await fs.writeFile(temp, change.bytes, { flag: 'wx' }); staged.push({ ...change, temp, previous });
      }
      for (const change of staged) { await fs.rename(change.temp, change.target); committed.push(change); }
      for (const p of this.pages.values()) { p.saved = p.bytes; const changed = staged.find(change => path.basename(change.target) === p.sourceName); if (changed) p.diskHash = crypto.createHash('sha256').update(changed.bytes).digest('hex'); } this.savedManifest = this.manifestText;
      this.savedHidden = hiddenSignature(this.hiddenParts.values()); const editorChange = staged.find(change => path.basename(change.target) === EDITOR_FILE); if (editorChange) this.editorHash = hash(editorChange.bytes);
      if (!this.files.includes(this.manifestName)) this.files.push(this.manifestName); return { ...this.status(), backup };
    } catch (error) { for (const change of committed.reverse()) { if (change.previous) await fs.writeFile(change.target, change.previous); else await fs.unlink(change.target); } throw error; }
    finally { for (const change of staged) await fs.unlink(change.temp).catch(() => {}); this.lock = false; }
  }
  async saveAs(destination) {
    destination = path.resolve(destination); if (destination === this.root || inside(this.root, destination) || inside(destination, this.root)) throw Error('另存目录不能与当前素材目录重叠。');
    try { await fs.access(destination); throw Error('目标目录已存在，请选择新的文件夹名称。'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const entries = await this.materialize(), staging = destination + '.' + crypto.randomUUID() + '.bdmodder-tmp'; await fs.mkdir(staging);
    try { for (const [name, data] of Object.entries(entries)) { safeRelative(name); const file = path.join(staging, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); } await fs.rename(staging, destination); }
    catch (e) { if (inside(path.dirname(staging), staging) && staging.endsWith('.bdmodder-tmp')) await fs.rm(staging, { recursive: true, force: true }); throw e; }
    return destination;
  }
  async zip() { const entries = await this.materialize(); return Buffer.from(await task('zip', { entries: Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [path.basename(this.root) + '/' + name, bytes])) })); }
}
async function importZip(file, cacheRoot) {
  const bytes = await read(file), entries = await task('unzip', { bytes }), folder = path.join(cacheRoot, crypto.randomUUID());
  const names = Object.keys(entries); for (const name of names) safeRelative(name.replace(/\/$/, ''));
  await fs.mkdir(folder, { recursive: true });
  for (const [name, data] of Object.entries(entries)) { if (name.endsWith('/')) continue; const target = path.join(folder, name); if (!inside(folder, target)) throw Error('ZIP 路径越界。'); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data, { flag: 'wx' }); }
  const atlasNames = names.filter(n => /\.atlas$/i.test(n)); if (atlasNames.length !== 1) throw Error('ZIP 中应只包含一个 MOD（一份 atlas）。');
  const project = new Project(path.dirname(path.join(folder, atlasNames[0])), true); await project.load(); return project;
}
module.exports = { Project, importZip, safeRelative, inside, validateManifest, filesUnder, read };
