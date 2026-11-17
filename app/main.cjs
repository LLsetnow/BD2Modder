'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Project, importZip, inside, read } = require('./project.cjs');
const { Settings, RESET_UI_ZOOM, MIN_UI_ZOOM, MAX_UI_ZOOM } = require('./settings.cjs');
const { formatShortcut } = require('./keybindings.cjs');
const { task } = require('./tasks.cjs');
const { Generation, normalizeProfile, validateProfile } = require('./generation.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'bdapp', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, { scheme: 'bdasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('BD Modder');
app.commandLine.appendSwitch('force-renderer-accessibility');
const isMac = process.platform === 'darwin';
const profileDirectory = process.argv.find(arg => arg.startsWith('--profile-dir='));
if (profileDirectory) { const directory = path.resolve(profileDirectory.slice('--profile-dir='.length)); require('node:fs').mkdirSync(directory, { recursive: true }); app.setPath('userData', directory); }
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) app.quit();
let window, settings, project = null, generating = null, candidate = null, startupProject = null, busy = false, settingsScreen = false;
const generation = new Generation();
const rendererRoot = path.resolve(__dirname, '../renderer');
const securityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' bdasset: blob: data:; connect-src 'self' bdasset:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const errorText = error => { let value = String(error.message || error); try { const key = settings?.key(); if (key) value = value.replaceAll(key, '[已隐藏密钥]'); } catch {} return value.slice(0, 2000); };
const requireProject = () => { if (!project) throw Error('请先打开 MOD。'); return project; };
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try { const sender = new URL(event.senderFrame.url); if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || sender.protocol !== 'bdapp:' || sender.host !== 'editor') throw Error('无效的应用请求。'); return { ok: true, value: await fn(payload) }; }
    catch (error) { return { ok: false, error: errorText(error) }; }
  });
}
async function serialized(fn) { if (busy) throw Error('正在执行文件操作，请稍候。'); busy = true; try { return await fn(); } finally { busy = false; } }
async function confirmLeave() {
  if (generating) { dialog.showMessageBoxSync(window, { type: 'info', message: '请先等待或取消当前重绘任务。' }); return false; }
  if (!project?.dirty()) return true;
  const result = await dialog.showMessageBox(window, { type: 'question', title: '尚未保存', message: '当前 MOD 有未保存的修改。', buttons: ['保存', '放弃修改', '取消'], defaultId: 0, cancelId: 2 });
  if (result.response === 2) return false; if (result.response === 1) return true; return Boolean(await saveProject(false));
}
async function remember() { if (!project.temporary) await settings.save({ recent: [project.root, ...settings.value.recent.filter(p => p !== project.root)].slice(0, 12) }); }
async function loadProject(file) {
  const next = /\.zip$/i.test(file) ? await importZip(file, path.join(app.getPath('userData'), 'imports')) : new Project(/\.modfile$/i.test(file) ? path.dirname(file) : file);
  if (!/\.zip$/i.test(file)) await next.load(); project = next; candidate = null; await remember(); return next.descriptor();
}
async function chooseOpen(kind = 'folder') {
  if (!['folder', 'file', 'zip'].includes(kind)) throw Error('请选择有效的导入方式。');
  if (!await confirmLeave()) return null;
  const result = await dialog.showOpenDialog(window, { title: kind === 'folder' ? '打开单个 MOD 文件夹' : kind === 'zip' ? '导入 MOD ZIP' : '打开 MOD 描述文件', defaultPath: project?.root || settings.value.recent[0], properties: [kind === 'folder' ? 'openDirectory' : 'openFile'], ...(kind !== 'folder' ? { filters: [{ name: kind === 'zip' ? 'MOD ZIP' : 'MOD', extensions: [kind === 'zip' ? 'zip' : 'modfile'] }] } : {}) });
  if (result.canceled) return null; return serialized(() => loadProject(result.filePaths[0]));
}
async function saveProject(asNew) {
  const current = requireProject();
  if (asNew || current.temporary) {
    const result = await dialog.showSaveDialog(window, { title: '另存为 MOD 文件夹（填写新文件夹名称）', defaultPath: path.join(current.temporary ? app.getPath('documents') : path.dirname(current.root), path.basename(current.root) + '-edited'), buttonLabel: '另存为文件夹', properties: ['createDirectory'] });
    if (result.canceled) return null;
    const folder = await current.saveAs(result.filePath); return loadProject(folder);
  }
  return current.save();
}
function menu() {
  if (settingsScreen && !isMac) { Menu.setApplicationMenu(null); return; }
  const send = command => () => window.webContents.send('bd:command', command);
  const zoom = amount => () => changeInterfaceZoom(amount).catch(error => console.error('界面缩放设置失败：', error));
  const keys = settings.value.shortcuts;
  const command = (label, id) => ({ label, accelerator: keys[id].replace(/^Ctrl\+/, 'CommandOrControl+'), click: send(id) });
  const template = [];
  if (isMac) template.push({ role: 'appMenu' });
  if (!settingsScreen) {
    const file = [command('打开 MOD', 'open'), command('保存', 'save'), command('另存为', 'saveAs'), command('导出', 'export')];
    if (!isMac) file.push({ type: 'separator' }, { role: 'quit', label: '退出' });
    template.push({ label: '文件', submenu: file });
  }
  const history = settingsScreen ? [{ role: 'undo' }, { role: 'redo' }] : [command('撤销修改', 'undo'), command('重做修改', 'redo')];
  template.push({ label: '编辑', submenu: [...history, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] });
  if (!settingsScreen) {
    const shortcut = value => formatShortcut(value, isMac);
    template.push({ label: '视图', submenu: [
      { label: '适应画布（' + shortcut(keys.fit) + '）', click: send('fit') },
      { label: '放大界面（' + shortcut('Ctrl+=') + ' / ' + shortcut('Ctrl+Shift+=') + '）', click: zoom(0.1) },
      { label: '缩小界面（' + shortcut('Ctrl+-') + '）', click: zoom(-0.1) },
      { label: '重置界面比例（' + shortcut('Ctrl+0') + '）', click: zoom(0) },
      { role: 'togglefullscreen', label: '全屏' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools', label: '开发者工具' }] : [])
    ] });
  }
  if (isMac) template.push({ role: 'windowMenu', label: '窗口' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
async function changeInterfaceZoom(amount) {
  const current = window.webContents.getZoomFactor();
  const requested = amount === 0 ? RESET_UI_ZOOM : current + amount;
  const zoom = Math.round(Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, requested)) * 100) / 100;
  window.webContents.setZoomFactor(zoom);
  await settings.save({ uiZoom: zoom });
  if (!window.webContents.isDestroyed()) window.webContents.send('bd:zoom-changed', zoom);
  return zoom;
}
function setupHandlers() {
  handle('bd:boot', () => ({ settings: settings.public(), project: startupProject, version: app.getVersion() }));
  handle('bd:open', chooseOpen);
  handle('bd:recent', async index => { if (!Number.isInteger(index) || !settings.value.recent[index]) throw Error('最近项目不存在。'); if (!await confirmLeave()) return null; return serialized(() => loadProject(settings.value.recent[index])); });
  handle('bd:save', asNew => serialized(() => saveProject(Boolean(asNew))));
  handle('bd:undo', redo => { if (busy || generating) throw Error('请等待当前操作完成。'); return requireProject().undo(redo); });
  handle('bd:manifest', text => { if (busy || generating) throw Error('请等待当前操作完成。'); return requireProject().setManifest(text); });
  handle('bd:edit', args => serialized(() => requireProject().mutate(args.page, args.operation, args.rects, args.options)));
  handle('bd:visibility', args => serialized(() => requireProject().setVisibility(args.parts, args.hidden)));
  handle('bd:replace', args => serialized(async () => {
    const result = await dialog.showOpenDialog(window, { title: args.part ? '替换所选部件（使用图集中存储的方向）' : '替换当前图集页（尺寸须相同）', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (result.canceled) return null; const bytes = await read(result.filePaths[0]);
    return args.part ? requireProject().mutate(args.page, 'replace', args.rects, { image: bytes }) : requireProject().replacePage(args.page, bytes);
  }));
  handle('bd:export', args => serialized(async () => {
    const p = requireProject(); let bytes, filename;
    if (args.type === 'zip') { bytes = await p.zip(); filename = p.descriptor().name + '.zip'; }
    else if (args.type === 'page') { bytes = await p.renderedPage(args.page); filename = args.page; }
    else if (args.type === 'part') { bytes = Buffer.from(await task('crop', { bytes: await p.renderedPage(args.page), rect: args.rect })); filename = 'part.png'; }
    else if (args.type === 'preview') { if (typeof args.data !== 'string' || !/^data:image\/png;base64,/.test(args.data) || args.data.length > 160 * 1024 * 1024) throw Error('预览图格式无效。'); bytes = Buffer.from(args.data.split(',')[1], 'base64'); filename = 'preview.png'; }
    else throw Error('不支持的导出格式。');
    const result = await dialog.showSaveDialog(window, { title: '导出 ' + filename, defaultPath: path.join(app.getPath('documents'), filename), filters: [{ name: args.type === 'zip' ? 'MOD ZIP' : 'PNG', extensions: [args.type === 'zip' ? 'zip' : 'png'] }] });
    if (result.canceled) return null; if (inside(p.root, result.filePath)) throw Error('请将导出文件保存在 MOD 文件夹外。');
    const temp = result.filePath + '.bdmodder-tmp'; await fs.writeFile(temp, bytes, { flag: 'wx' }); try { await fs.rename(temp, result.filePath); } finally { await fs.unlink(temp).catch(() => {}); } return result.filePath;
  }));
  handle('bd:reveal', () => { shell.showItemInFolder(path.join(requireProject().root, requireProject().atlasName)); return true; });
  handle('bd:settings', async patch => { if (patch?.profile) validateProfile(patch.profile); const result = await settings.save(patch || {}); menu(); return result; });
  handle('bd:zoom', direction => {
    if (!['in', 'out', 'reset'].includes(direction)) throw Error('缩放操作无效。');
    return changeInterfaceZoom(direction === 'in' ? 0.1 : direction === 'out' ? -0.1 : 0);
  });
  handle('bd:settings-screen', open => { settingsScreen = Boolean(open); menu(); return true; });
  handle('bd:workflow', async () => { const result = await dialog.showOpenDialog(window, { title: '导入 ComfyUI API 工作流或旧版重绘方案', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] }); if (result.canceled) return null; const bytes = await read(result.filePaths[0]); if (bytes.length > 10 * 1024 * 1024) throw Error('工作流文件过大。'); return normalizeProfile(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))); });
  handle('bd:check-service', provider => { if (!['ComfyUI', 'RunningHub'].includes(provider)) throw Error('服务类型无效。'); return generation.check(settings.value, provider, settings.key()); });
  handle('bd:generate', async args => {
    if (generating || busy) throw Error('正在执行其他操作。'); if (!['ComfyUI', 'RunningHub'].includes(args.provider)) throw Error('未知服务。');
    const p = requireProject(), page = p.page(args.page), revision = p.revision; validateProfile(settings.value.profile);
    const controller = new AbortController(); generating = controller; candidate = null;
    const session = path.join(app.getPath('userData'), 'jobs', new Date().toISOString().replace(/[:.]/g, '-')); await fs.mkdir(session, { recursive: true });
    try {
      const mask = Buffer.from(await task('mask', { bytes: page.bytes, rects: args.rects }));
      const request = String(args.request || '').trim(); if (!request || request.length > 10000) throw Error('请填写有效的修改要求。');
      const steps = Number(args.steps), denoise = Number(args.denoise), seed = Number(args.seed);
      if (!Number.isInteger(steps) || steps < 1 || steps > 100 || !Number.isFinite(denoise) || denoise < 0 || denoise > 1 || !Number.isSafeInteger(seed) || seed < 0) throw Error('重绘参数无效。');
      const output = await generation.generate(settings.value, args.provider, settings.value.profile, { image: page.bytes, mask, request, steps, denoise, seed, width: page.width, height: page.height }, settings.key(), controller.signal, message => window.webContents.send('bd:progress', message), record => fs.writeFile(path.join(session, 'job.json'), JSON.stringify(record, null, 2)));
      const validated = Buffer.from(await task('edit', { bytes: page.bytes, operation: 'merge', rects: args.rects, options: { image: output.image, preserveAlpha: true } }));
      candidate = { id: require('node:crypto').randomUUID(), projectId: p.id, revision, page: args.page, rects: args.rects, bytes: validated, session };
      await fs.writeFile(path.join(session, 'result.png'), validated); return { id: candidate.id, url: 'bdasset://candidate/' + candidate.id, taskId: output.id };
    } finally { generating = null; }
  });
  handle('bd:cancel-generation', () => { generating?.abort(); return true; });
  handle('bd:discard-generation', () => { candidate = null; return true; });
  handle('bd:apply-generation', id => serialized(async () => { const p = requireProject(); if (!candidate || candidate.id !== id || candidate.projectId !== p.id || candidate.revision !== p.revision) throw Error('项目已变化，请重新生成预览。'); const result = await p.mutate(candidate.page, 'merge', candidate.rects, { image: candidate.bytes }); candidate = null; return result; }));
  handle('bd:diagnostics', async value => { if (value && typeof value === 'object') await fs.writeFile(path.join(app.getPath('userData'), 'renderer-status.json'), JSON.stringify({ ...value, time: new Date().toISOString() }, null, 2)); return true; });
}
if (instanceLock) app.whenReady().then(async () => {
  settings = new Settings(app.getPath('userData'), safeStorage); await settings.load();
  protocol.handle('bdapp', async request => {
    const url = new URL(request.url), file = path.resolve(rendererRoot, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'editor' || !inside(rendererRoot, file) || !/\.(html|js|css|map|png)$/.test(file)) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href); response.headers.set('Content-Security-Policy', securityPolicy); response.headers.set('X-Content-Type-Options', 'nosniff'); return response;
  });
  protocol.handle('bdasset', async request => {
    const url = new URL(request.url); let bytes;
    if (url.host === 'candidate' && candidate?.id === url.pathname.slice(1)) bytes = candidate.bytes;
    else if (project && url.host === project.id) { const p = project, name = decodeURIComponent(url.pathname.slice(1)); if (p.pages.has(name)) bytes = url.searchParams.get('scene') === '1' ? await p.renderedPage(name) : p.page(name).bytes; }
    return bytes ? new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'bdapp://editor' } }) : new Response('Not found', { status: 404 });
  });
  const openAt = process.argv.indexOf('--open'); if (openAt !== -1 && process.argv[openAt + 1]) { try { startupProject = await loadProject(process.argv[openAt + 1]); } catch (e) { startupProject = { error: errorText(e) }; } }
  window = new BrowserWindow({ title: 'BD Modder', width: 1500, height: 960, minWidth: 740, minHeight: 620, backgroundColor: '#181c23', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
  window.webContents.setZoomFactor(settings.value.uiZoom);
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || input.alt || !(isMac ? input.meta && !input.control : input.control && !input.meta)) return;
    if (input.key === '+' || input.key === '=' || input.key === 'Add') { event.preventDefault(); void changeInterfaceZoom(0.1).catch(error => console.error('界面缩放设置失败：', error)); }
    else if (input.key === '-') { event.preventDefault(); void changeInterfaceZoom(-0.1).catch(error => console.error('界面缩放设置失败：', error)); }
    else if (input.key === '0') { event.preventDefault(); void changeInterfaceZoom(0).catch(error => console.error('界面缩放设置失败：', error)); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('bdapp://editor/')) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.on('render-process-gone', (_event, details) => { dialog.showErrorBox('BD Modder 渲染进程退出', details.reason + '。请重新启动；原文件只有在保存时才会更改。'); });
  let approvedClose = false;
  window.on('close', event => { if (!approvedClose && (busy || generating || project?.dirty())) { event.preventDefault(); if (busy) return; confirmLeave().then(ok => { if (ok) { approvedClose = true; window.close(); } }); } });
  menu(); setupHandlers(); await window.loadURL('bdapp://editor/index.html'); window.show();
}).catch(error => { dialog.showErrorBox('BD Modder 启动失败', errorText(error)); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
