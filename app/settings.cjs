'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_SHORTCUTS, validateShortcuts } = require('./keybindings.cjs');
const isMac = process.platform === 'darwin';
const MAX_RECENT_PROJECTS = 5;
const DEFAULT_UI_ZOOM = 1.1, RESET_UI_ZOOM = 1, MIN_UI_ZOOM = 0.75, MAX_UI_ZOOM = 1.75;
function normalizeUiZoom(value) { if (!Number.isFinite(value)) throw Error('界面缩放比例无效。'); return Math.round(Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, value)) * 100) / 100; }
function normalizeRecent(recent) {
  if (!Array.isArray(recent)) return [];
  const paths = recent.filter(file => typeof file === 'string' && file.length > 0);
  return [...new Set(paths)].slice(0, MAX_RECENT_PROJECTS);
}
function storedRunningHubKeys(entries) {
  const keys = new Map();
  for (const entry of entries) {
    if (typeof entry?.id !== 'string' || !entry.id || keys.has(entry.id) ||
        typeof entry.name !== 'string' || !entry.name.trim() ||
        typeof entry.encryptedKey !== 'string' || !entry.encryptedKey) continue;
    keys.set(entry.id, { id: entry.id, name: entry.name, encryptedKey: entry.encryptedKey });
  }
  return [...keys.values()];
}
class Settings {
  constructor(root, secrets) {
    this.root = root; this.secrets = secrets; this.keyValue = ''; this.encryptionAvailable = false; this.queue = Promise.resolve();
    this.value = {
      recent: [], address: 'http://127.0.0.1:8188/', cloudAddress: 'https://www.runninghub.ai/',
      profile: null, uiZoom: DEFAULT_UI_ZOOM, shortcuts: { ...DEFAULT_SHORTCUTS },
      runningHubKeys: [], activeRunningHubKeyId: null
    };
  }
  async load() {
    let stored;
    try { stored = JSON.parse(await fs.readFile(path.join(this.root, 'settings.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    const { encryptedKey, runningHubKeys, activeRunningHubKeyId, ...saved } = stored ?? {};
    const legacy = !Array.isArray(runningHubKeys) && typeof encryptedKey === 'string' && encryptedKey
      ? { id: 'legacy', name: '原有密钥', encryptedKey } : null;
    const keys = legacy ? [legacy] : storedRunningHubKeys(Array.isArray(runningHubKeys) ? runningHubKeys : []);
    const active = keys.find(entry => entry.id === (legacy?.id ?? activeRunningHubKeyId));
    this.value = { ...this.value, ...saved, runningHubKeys: keys, activeRunningHubKeyId: active?.id ?? null };
    this.value.recent = normalizeRecent(this.value.recent);
    try { this.value.shortcuts = validateShortcuts(this.value.shortcuts, isMac); } catch { this.value.shortcuts = { ...DEFAULT_SHORTCUTS }; }
    try { this.value.uiZoom = normalizeUiZoom(this.value.uiZoom); } catch { this.value.uiZoom = DEFAULT_UI_ZOOM; }
    this.encryptionAvailable = await this.secrets.isAsyncEncryptionAvailable();
    this.keyValue = active && this.encryptionAvailable ? await this.decryptRunningHubKey(active).catch(() => '') : '';
    return this.public();
  }
  public() {
    const { recent, address, cloudAddress, profile, uiZoom, shortcuts, runningHubKeys, activeRunningHubKeyId } = this.value;
    return { recent, address, cloudAddress, profile, uiZoom, shortcuts,
      runningHubKeys: runningHubKeys.map(({ id, name }) => ({ id, name })), activeRunningHubKeyId,
      hasKey: Boolean(this.keyValue), encryptionAvailable: this.encryptionAvailable };
  }
  key() { return this.keyValue; }
  async decryptRunningHubKey(entry) {
    if (!this.encryptionAvailable) throw Error('当前无法使用系统密钥加密。');
    try {
      const { result } = await this.secrets.decryptStringAsync(Buffer.from(entry.encryptedKey, 'base64'));
      if (typeof result === 'string' && result) return result;
    } catch {}
    throw Error('无法解密此 RunningHub 密钥，请重新添加。');
  }
  async updateRunningHubKeys(next, patch) {
    let keyValue = this.keyValue;
    const adding = 'addRunningHubKey' in patch;
    const apiKey = adding ? patch.addRunningHubKey?.apiKey : patch.apiKey;
    if (adding || ('apiKey' in patch && apiKey !== '')) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('请填写 RunningHub API Key。');
      if (!this.encryptionAvailable) throw Error('系统密钥加密不可用，不能保存 API Key。');
      keyValue = apiKey.trim();
      let encryptedKey;
      try { encryptedKey = (await this.secrets.encryptStringAsync(keyValue)).toString('base64'); }
      catch { throw Error('无法使用系统加密保存 RunningHub 密钥。'); }

      const existing = adding ? null : next.runningHubKeys.find(entry => entry.id === next.activeRunningHubKeyId);
      const inputName = patch.addRunningHubKey?.name;
      const preferred = typeof inputName === 'string' && inputName.trim() ? inputName.trim() : '密钥';
      let name = preferred;
      for (let suffix = 2; next.runningHubKeys.some(entry => entry.name === name); suffix++) name = `${preferred} ${suffix}`;
      const entry = { id: existing?.id ?? randomUUID(), name: existing?.name ?? name, encryptedKey };
      next.runningHubKeys = existing ? next.runningHubKeys.map(key => key === existing ? entry : key) : [...next.runningHubKeys, entry];
      next.activeRunningHubKeyId = entry.id;
    }
    if (patch.clearKey || 'removeRunningHubKeyId' in patch) {
      const id = patch.clearKey ? next.activeRunningHubKeyId : patch.removeRunningHubKeyId;
      if (!patch.clearKey && !next.runningHubKeys.some(entry => entry.id === id)) throw Error('未找到要删除的 RunningHub 密钥。');
      next.runningHubKeys = next.runningHubKeys.filter(entry => entry.id !== id);
      if (next.activeRunningHubKeyId === id) { next.activeRunningHubKeyId = null; keyValue = ''; }
    }
    if ('activeRunningHubKeyId' in patch) {
      const id = patch.activeRunningHubKeyId;
      const entry = next.runningHubKeys.find(key => key.id === id);
      if (id !== null && !entry) throw Error('未找到要启用的 RunningHub 密钥。');
      if (id !== next.activeRunningHubKeyId || (entry && !keyValue)) {
        keyValue = entry ? await this.decryptRunningHubKey(entry) : '';
        next.activeRunningHubKeyId = id;
      }
    }
    return keyValue;
  }
  save(patch = {}) { const operation = this.queue.then(() => this.write(patch)); this.queue = operation.catch(() => {}); return operation; }
  async write(patch) {
    const next = { ...this.value };
    const shortcuts = 'shortcuts' in patch ? validateShortcuts(patch.shortcuts, isMac) : null;
    const uiZoom = 'uiZoom' in patch ? Number(patch.uiZoom) : null;
    if ('uiZoom' in patch && (!Number.isFinite(uiZoom) || uiZoom < MIN_UI_ZOOM || uiZoom > MAX_UI_ZOOM)) throw Error(`界面缩放范围为 ${MIN_UI_ZOOM * 100}%–${MAX_UI_ZOOM * 100}%。`);
    for (const field of ['address', 'cloudAddress']) if (field in patch) {
      const url = new URL(patch[field]); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('服务地址必须是无账号、无查询参数的 HTTP/HTTPS 地址。');
      if (field === 'cloudAddress' && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('云端服务必须使用 HTTPS。'); next[field] = url.href.endsWith('/') ? url.href : url.href + '/';
    }
    const keyValue = await this.updateRunningHubKeys(next, patch);
    if ('profile' in patch) next.profile = patch.profile;
    if (uiZoom !== null) next.uiZoom = normalizeUiZoom(uiZoom);
    if (shortcuts) next.shortcuts = shortcuts;
    if ('recent' in patch) next.recent = normalizeRecent(patch.recent);
    await fs.mkdir(this.root, { recursive: true });
    const temp = path.join(this.root, 'settings.json.tmp');
    await fs.writeFile(temp, JSON.stringify(next, null, 2));
    await fs.rename(temp, path.join(this.root, 'settings.json'));
    this.value = next;
    this.keyValue = keyValue;
    return this.public();
  }
}
module.exports = { Settings, DEFAULT_UI_ZOOM, RESET_UI_ZOOM, MIN_UI_ZOOM, MAX_UI_ZOOM, normalizeUiZoom };
