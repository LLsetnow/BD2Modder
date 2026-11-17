'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_SHORTCUTS, validateShortcuts } = require('./keybindings.cjs');
const isMac = process.platform === 'darwin';
const DEFAULT_UI_ZOOM = 1.1, RESET_UI_ZOOM = 1, MIN_UI_ZOOM = 0.75, MAX_UI_ZOOM = 1.75;
function normalizeUiZoom(value) { if (!Number.isFinite(value)) throw Error('界面缩放比例无效。'); return Math.round(Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, value)) * 100) / 100; }
class Settings {
  constructor(root, secrets) { this.root = root; this.secrets = secrets; this.keyValue = ''; this.encryptionAvailable = false; this.queue = Promise.resolve(); this.value = { recent: [], address: 'http://127.0.0.1:8188/', cloudAddress: 'https://www.runninghub.cn/', profile: null, uiZoom: DEFAULT_UI_ZOOM, shortcuts: { ...DEFAULT_SHORTCUTS } }; }
  async load() { try { Object.assign(this.value, JSON.parse(await fs.readFile(path.join(this.root, 'settings.json'), 'utf8'))); } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; } try { this.value.shortcuts = validateShortcuts(this.value.shortcuts, isMac); } catch { this.value.shortcuts = { ...DEFAULT_SHORTCUTS }; } try { this.value.uiZoom = normalizeUiZoom(this.value.uiZoom); } catch { this.value.uiZoom = DEFAULT_UI_ZOOM; } this.encryptionAvailable = await this.secrets.isAsyncEncryptionAvailable(); if (this.value.encryptedKey && this.encryptionAvailable) this.keyValue = (await this.secrets.decryptStringAsync(Buffer.from(this.value.encryptedKey, 'base64'))).result; return this.public(); }
  public() { const { encryptedKey, ...value } = this.value; return { ...value, hasKey: Boolean(encryptedKey), encryptionAvailable: this.encryptionAvailable }; }
  key() { return this.keyValue; }
  save(patch = {}) { const operation = this.queue.then(() => this.write(patch)); this.queue = operation.catch(() => {}); return operation; }
  async write(patch) {
    const shortcuts = 'shortcuts' in patch ? validateShortcuts(patch.shortcuts, isMac) : null;
    const uiZoom = 'uiZoom' in patch ? Number(patch.uiZoom) : null;
    if ('uiZoom' in patch && (!Number.isFinite(uiZoom) || uiZoom < MIN_UI_ZOOM || uiZoom > MAX_UI_ZOOM)) throw Error(`界面缩放范围为 ${MIN_UI_ZOOM * 100}%–${MAX_UI_ZOOM * 100}%。`);
    for (const field of ['address', 'cloudAddress']) if (field in patch) {
      const url = new URL(patch[field]); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('服务地址必须是无账号、无查询参数的 HTTP/HTTPS 地址。');
      if (field === 'cloudAddress' && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('云端服务必须使用 HTTPS。'); this.value[field] = url.href.endsWith('/') ? url.href : url.href + '/';
    }
    if ('apiKey' in patch && patch.apiKey !== '') { if (!this.encryptionAvailable) throw Error('系统密钥加密不可用，不能持久化 API Key。'); this.keyValue = patch.apiKey.trim(); this.value.encryptedKey = (await this.secrets.encryptStringAsync(this.keyValue)).toString('base64'); }
    if (patch.clearKey) { delete this.value.encryptedKey; this.keyValue = ''; }
    if ('profile' in patch) this.value.profile = patch.profile;
    if ('recent' in patch) this.value.recent = patch.recent;
    if (uiZoom !== null) this.value.uiZoom = normalizeUiZoom(uiZoom);
    if (shortcuts) this.value.shortcuts = shortcuts;
    await fs.mkdir(this.root, { recursive: true }); const temp = path.join(this.root, 'settings.json.tmp'); await fs.writeFile(temp, JSON.stringify(this.value, null, 2)); await fs.rename(temp, path.join(this.root, 'settings.json')); return this.public();
  }
}
module.exports = { Settings, DEFAULT_UI_ZOOM, RESET_UI_ZOOM, MIN_UI_ZOOM, MAX_UI_ZOOM, normalizeUiZoom };
