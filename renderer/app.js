import { SpinePreview } from './spine-preview.js';
import { SettingsPage } from './settings-page.js';
import { DEFAULT_SHORTCUTS, actionForEvent } from '../app/keybindings.cjs';
import { PartContextMenu, grayHiddenRegions } from './part-visibility.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const root = document.documentElement;
const state = { project: null, info: null, settings: null, selected: new Set(), filter: 'visible', search: '', page: '', inspector: 'part', view: 'scene', target: 'scene', generating: false, atlasZoom: 1, atlasPan: { x: 0, y: 0 }, thumbnails: new Map(), visibleSignature: '', ready: false };
const preferences = { layout: 'studio', theme: 'dark', density: 'comfortable', grid: true, provider: 'ComfyUI' };
try { Object.assign(preferences, JSON.parse(localStorage.getItem('bdmodder-ui') || '{}')); } catch {}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const persist = () => localStorage.setItem('bdmodder-ui', JSON.stringify(preferences));
const region = name => state.info?.regions.find(r => r.name === name);
const primary = () => region([...state.selected].at(-1));
const isHidden = r => state.project?.hiddenParts?.some(p => p.page === r.page && p.name === r.name) || false;
const partMenu = new PartContextMenu();
const seconds = value => { const t = Math.floor(value || 0); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
let toastTimer = 0;
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); }
function modal(title, content, actions = []) {
  if ($('#action-dialog').open) $('#action-dialog').close(); $('#dialog-title').textContent = title; $('#dialog-content').innerHTML = content; $('#dialog-actions').replaceChildren();
  for (const action of actions) { const button = document.createElement('button'); button.className = 'button' + (action.primary ? ' primary' : ''); button.textContent = action.label; button.addEventListener('click', () => guard(action.run)); $('#dialog-actions').append(button); }
  $('#action-dialog').showModal();
}
function closeModal() { $('#action-dialog').close(); }
function showError(error) { console.error(error); $('#status-message').textContent = error.message; modal('操作未完成', '<p class="error-message">' + escape(error.message) + '</p>', [{ label: '返回工作台', run: closeModal }]); }
async function guard(action) { try { return await action(); } catch (error) { showError(error); return null; } }
let preview;
state.version = '1.2.0';
try { preview = new SpinePreview($('#scene-canvas'), $('#scene-overlay'), updateFrame, showError); } catch (error) { showError(error); }
const settingsPage = new SettingsPage({
  native: true,
  onPause: () => preview?.setPlaying(false),
  onResume: () => preview?.invalidate(),
  onVisibility: open => window.bd.settingsScreen(open),
  onPreference: (key, value) => { preferences[key] = value; if (key === 'layout') setLayout(value); else if (key === 'provider') $('#provider-select').value = value; else root.dataset[key] = String(value); persist(); settingsPage.sync({ preferences }); preview?.invalidate(); },
  onResetPreferences: () => { Object.assign(preferences, { layout: 'studio', theme: 'dark', density: 'comfortable', grid: true, provider: 'ComfyUI' }); applyPreferences(); },
  onShortcuts: async shortcuts => { state.settings = await window.bd.settings({ shortcuts }); setShortcutHints(state.settings.shortcuts); return state.settings.shortcuts; },
  onSaveService: async patch => { state.settings = await window.bd.settings(patch); settingsStatus(); return state.settings; },
  onTestService: provider => window.bd.checkService(provider),
  onWorkflow: () => workflowDialog(),
  onProjectAction: action => guard(async () => { if (action === 'metadata') metadataDialog(); else if (action === 'reveal') await window.bd.reveal(); else if (action === 'saveAs') await save(true); else if (action === 'redo') await refresh(await window.bd.undo(true)); })
});
function syncSettings() { settingsPage.sync({ preferences, service: state.settings, project: state.project, version: state.version, device: state.info?.device }); }
function setShortcutHints(keys = DEFAULT_SHORTCUTS) {
  $('.workspace-switch').title = '切换工作区（' + keys.switchWorkspace + '）'; $('#fit-button .key-hint').textContent = keys.fit; $('.search-box kbd').textContent = keys.search;
  $('#play-button').title = '播放 / 暂停（' + keys.play + '）'; $('[data-action="undo"]').title = '撤销修改（' + keys.undo + '）'; $('.save-button').title = '保存（' + keys.save + '）';
  $('#hide-parts').title = '隐藏选中部件（' + keys.hide + '）';
}

function setInspectorOpen(open) { root.dataset.inspector = open ? 'open' : 'closed'; $('#inspector-toggle').setAttribute('aria-expanded', String(open)); }
function setLayout(value) { preferences.layout = value === 'compare' ? 'compare' : 'studio'; root.dataset.layout = preferences.layout; $('#layout-select').value = preferences.layout; $$('.workspace-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.workspace === preferences.layout))); setInspectorOpen(preferences.layout === 'studio' && innerWidth >= 1100); persist(); preview?.invalidate(); }
function applyPreferences() { preferences.theme = preferences.theme === 'light' ? 'light' : 'dark'; preferences.density = preferences.density === 'compact' ? 'compact' : 'comfortable'; root.dataset.theme = preferences.theme; root.dataset.density = preferences.density; root.dataset.grid = String(Boolean(preferences.grid)); $('#theme-select').value = preferences.theme; $('#density-select').value = preferences.density; $('#grid-toggle').checked = preferences.grid; preferences.provider = preferences.provider === 'RunningHub' ? 'RunningHub' : 'ComfyUI'; $('#provider-select').value = preferences.provider; setLayout(preferences.layout); syncSettings(); }
function setView(view) { state.view = view; state.target = view; root.dataset.view = view; $$('.segmented [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view))); preview?.invalidate(); updateZoom(); }
function setInspector(page) { state.inspector = page; $$('.inspector-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.inspector === page))); $$('.inspector-page').forEach(el => el.hidden = el.dataset.page !== page); $('#inspector-scroll').scrollTop = 0; }
function status(result) {
  if (!result || !state.project) return; Object.assign(state.project, result);
  const dirty = Boolean(result.dirty); $('#project-state').textContent = dirty ? '未保存' : '已载入'; $('#dirty-state').textContent = dirty ? '有未保存的修改' : '所有修改已保存';
  $('.save-button').disabled = !dirty && !state.project.temporary; $('[data-action="undo"]').disabled = !result.undo; document.title = `${dirty ? '● ' : ''}${state.project.name} — BD Modder`; syncSettings();
}
function setControls(ready) { state.ready = ready; for (const selector of ['#play-button', '#step-back', '#step-forward', '#timeline-range', '#animation-select', '#skin-select', '#fit-button', '#zoom-in', '#zoom-out', '#mesh-toggle', '#replace-page', '#export-page', '[data-action="export"]']) $(selector).disabled = !ready; renderProperties(); }
async function openDescriptor(descriptor) {
  if (!descriptor) return; if (descriptor.error) throw Error(descriptor.error); if (!preview) throw Error('WebGL 渲染器不可用。');
  setControls(false); $('#loading-mask').hidden = false; $('#canvas-empty').hidden = true; $('#status-message').textContent = '读取骨骼与原始图集…';
  try {
    const start = performance.now(); partMenu.close(); state.project = descriptor; state.selected.clear(); state.thumbnails.clear();
    if (state.settings && !descriptor.temporary) state.settings.recent = [descriptor.root, ...state.settings.recent.filter(p => p !== descriptor.root)].slice(0, 12);
    state.info = await preview.load(descriptor); state.page = state.info.regions[0]?.page || descriptor.pages[0].name;
    preview.selected = state.selected;
    $('#project-title').textContent = descriptor.name; $('#asset-title').textContent = descriptor.name; $('#file-summary').textContent = `${descriptor.fileCount} 个文件 · ${(descriptor.totalBytes / 1048576).toFixed(1)} MiB`;
    $('#spine-version').textContent = 'Spine ' + state.info.version; $('#part-count').textContent = state.info.regions.length; $('#texture-page-count').textContent = descriptor.pages.length;
    $('#render-backend').textContent = state.info.hardware ? 'GPU · WebGL' : 'WebGL · 软件渲染'; $('#render-backend').title = state.info.device;
    $('#animation-select').replaceChildren(...[new Option('绑定姿态', ''), ...state.info.animations.map(a => new Option(a.name, a.name))]); $('#animation-select').value = state.info.animation;
    $('#skin-select').replaceChildren(...state.info.skins.map(s => new Option(s, s))); $('#skin-select').value = preview.skeleton.skin?.name || state.info.skins[0] || '';
    $('#atlas-select').replaceChildren(...descriptor.pages.map(p => new Option(p.name, p.name))); state.atlasZoom = 1; state.atlasPan = { x: 0, y: 0 };
    setControls(true); status(descriptor); renderLibrary(); renderProperties(); renderAtlas();
    const loadMs = Math.round(performance.now() - start); $('#status-message').textContent = `已载入 · ${loadMs} ms · 原始图集实时渲染`;
    await window.bd.diagnostics({ loaded: true, project: descriptor.name, version: state.info.version, animations: state.info.animations.length, regions: state.info.regions.length, pages: descriptor.pages.length, hiddenParts: descriptor.hiddenParts.length, maskedPages: new Set(descriptor.hiddenParts.map(r => r.page)).size, device: state.info.device, hardware: state.info.hardware, loadMs, renderer: 'Spine WebGL 4.1' });
  } catch (error) { state.project = null; state.info = null; $('#canvas-empty').hidden = false; setControls(false); throw error; }
  finally { $('#loading-mask').hidden = true; }
}
async function open(kind) { closeModal(); await openDescriptor(await window.bd.open(kind)); }
function openChooser() {
  modal('打开 MOD', '<p>选择一份包含骨骼、atlas 和纹理的 MOD。</p><div class="dialog-options"><button class="choice-button" id="open-folder"><strong>打开 MOD 文件夹</strong><small>直接编辑现有素材，保存时自动备份。</small></button><button class="choice-button" id="open-modfile"><strong>打开 .modfile</strong><small>读取描述文件所在目录的完整素材。</small></button><button class="choice-button" id="open-zip"><strong>导入 ZIP</strong><small>解压到工作区，编辑完成后另存或导出。</small></button></div>' + (state.settings?.recent?.length ? '<h3 class="recent-heading">最近打开</h3><div class="recent-list">' + state.settings.recent.map((p, i) => `<button class="choice-button" data-recent="${i}" title="${escape(p)}">${escape(p.split(/[\\/]/).at(-1))}</button>`).join('') + '</div>' : ''), [{ label: '取消', run: closeModal }]);
  $('#open-folder').onclick = () => guard(() => open('folder')); $('#open-modfile').onclick = () => guard(() => open('file')); $('#open-zip').onclick = () => guard(() => open('zip'));
  $$('[data-recent]').forEach(b => b.onclick = () => guard(async () => { closeModal(); await openDescriptor(await window.bd.recent(Number(b.dataset.recent))); }));
}
function thumbnail(r) {
  const key = r.page + ':' + r.name; if (state.thumbnails.has(key)) return state.thumbnails.get(key);
  const page = preview.pages.get(r.page); if (!page) return '';
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120; const ctx = canvas.getContext('2d');
  const scale = Math.min(152 / r.width, 112 / r.height); ctx.drawImage(page.image, r.x, r.y, r.width, r.height, (160 - r.width * scale) / 2, (120 - r.height * scale) / 2, r.width * scale, r.height * scale);
  const url = canvas.toDataURL('image/png'); state.thumbnails.set(key, url); return url;
}
function renderLibrary() {
  const list = $('#part-list'); list.replaceChildren(); if (!state.info) return;
  const visible = new Set(preview.geometry(true).map(d => d.region)); state.visibleSignature = [...visible].sort().join('\0');
  const hidden = new Set(state.project.hiddenParts.map(r => r.name)); $('#filter-hidden-count').textContent = hidden.size;
  const parts = state.info.regions.filter(r => (!state.search || r.name.toLowerCase().includes(state.search)) && (state.filter === 'all' || state.filter === 'selected' && state.selected.has(r.name) || state.filter === 'visible' && visible.has(r.name) || state.filter === 'hidden' && hidden.has(r.name)));
  const fragment = document.createDocumentFragment();
  for (const r of parts) {
    const hidden = isHidden(r), row = document.createElement('button'); row.className = 'part-row' + (hidden ? ' is-hidden' : ''); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(state.selected.has(r.name))); row.dataset.region = r.name;
    row.innerHTML = `<span class="part-thumbnail checker"><img loading="lazy" src="${thumbnail(r)}" alt=""></span><span class="part-info"><strong>${escape(r.name)}</strong><small>${hidden ? '已隐藏 · ' : ''}${r.width} × ${r.height}</small></span><span class="part-check" aria-hidden="true">${state.selected.has(r.name) ? '✓' : ''}</span>`;
    row.onclick = event => select(r.name, event.ctrlKey || event.metaKey);
    row.oncontextmenu = event => { event.preventDefault(); if (!state.selected.has(r.name)) select(r.name); const parts = [...state.selected].map(region); partMenu.show(event, $$('.part-row').find(el => el.dataset.region === r.name), { count: parts.length, canHide: !state.generating && parts.some(p => !isHidden(p)), canShow: !state.generating && parts.some(isHidden), shortcut: state.settings?.shortcuts.hide || 'H', onHide: () => guard(() => changeVisibility(true)), onShow: () => guard(() => changeVisibility(false)) }); }; fragment.append(row);
  }
  list.append(fragment); $('#list-caption').textContent = `${parts.length} 个部件`; if (!parts.length) { const empty = document.createElement('p'); empty.className = 'list-empty'; empty.textContent = state.filter === 'hidden' && !hidden.size ? '还没有隐藏的部件' : '没有匹配的部件'; list.append(empty); }
}
function select(name, additive = false) { if (!region(name)) return; if (!additive) state.selected.clear(); if (additive && state.selected.has(name)) state.selected.delete(name); else state.selected.add(name); const r = primary(); if (r) state.page = r.page; renderLibrary(); renderProperties(); renderAtlas(); preview.invalidate(); }
function renderProperties() {
  const r = primary(), count = state.selected.size;
  $('#selection-name').textContent = r ? count > 1 ? `${count} 个部件` : r.name : '未选择部件'; $('#selection-kind').textContent = r ? r.page : '在角色或图集中点击选择';
  $('#selection-thumb').hidden = !r; if (r) $('#selection-thumb').src = thumbnail(r);
  const hiddenCount = [...state.selected].map(region).filter(p => p && isHidden(p)).length;
  $('#selection-note').textContent = r ? `${count} 个已选部件${hiddenCount ? ` · ${hiddenCount} 个已隐藏，导出时清除贴图像素` : ' · 图集和角色同步定位'}` : '修改会先保存在内存中，保存时自动备份原文件。';
  $('#property-name').textContent = r?.name || '—'; $('#property-position').textContent = r ? `${r.x}, ${r.y}` : '—'; $('#property-size').textContent = r ? `${r.width} × ${r.height}` : '—'; $('#property-rotation').textContent = r ? `${r.rotation}°` : '—'; $('#property-page').textContent = r?.page || '—';
  $('#filter-selected-count').textContent = count; $('#selected-count').textContent = `${count} 个已选部件`; $('#ai-selection-hint').textContent = count ? `当前选区：${count} 个部件。只修改选区所在的当前图集页。` : '先选择需要修改的部件。';
  for (const id of ['locate-button', 'go-ai', 'tint-parts', 'hide-parts', 'restore-parts']) $('#' + id).disabled = !state.ready || !r || state.generating;
  $('#hide-parts').disabled ||= hiddenCount === count; $('#show-parts').disabled = !state.ready || !hiddenCount || state.generating;
  for (const id of ['replace-part', 'export-part']) $('#' + id).disabled = !state.ready || count !== 1 || state.generating;
  $('#generate-button').disabled = !state.ready || !r || !state.settings?.profile || state.generating;
}
function renderAtlas() {
  if (!state.project || !state.page) return;
  const p = state.project.pages.find(p => p.name === state.page); $('#atlas-select').value = state.page; $('#atlas-image').src = `bdasset://${state.project.id}/${encodeURIComponent(state.page)}?revision=${state.project.revision}`;
  $('#atlas-sheet').style.setProperty('--atlas-ratio', p.width / p.height); $('#atlas-size').textContent = `${p.width} × ${p.height}`; $('#texture-file').textContent = p.name; $('#texture-size').textContent = `${p.width} × ${p.height}`;
  const overlay = $('#atlas-overlay'); overlay.setAttribute('viewBox', `0 0 ${p.width} ${p.height}`); overlay.replaceChildren();
  grayHiddenRegions(overlay, state.project.hiddenParts.filter(r => r.page === p.name), p, $('#atlas-image').src);
  for (const r of state.info.regions.filter(r => r.page === p.name && state.selected.has(r.name))) { const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); for (const key of ['x', 'y', 'width', 'height']) rect.setAttribute(key, r[key]); rect.setAttribute('class', 'atlas-rect'); overlay.append(rect); }
  updateAtlasTransform();
}
function updateAtlasTransform() { $('#atlas-sheet').style.transform = `translate(calc(-50% + ${state.atlasPan.x}px),calc(-50% + ${state.atlasPan.y}px)) scale(${state.atlasZoom})`; updateZoom(); }
function updateZoom() { $('#zoom-value').textContent = Math.round((state.target === 'atlas' ? state.atlasZoom : preview?.zoom || 1) * 100) + '%'; $('#zoom-value').title = (state.target === 'atlas' ? '图集' : '角色') + '缩放 · 点击适应'; }
function zoom(amount) { if (state.target === 'atlas') { state.atlasZoom = Math.max(.05, state.atlasZoom + amount); updateAtlasTransform(); } else preview?.setZoom(preview.zoom + amount); updateZoom(); }
function fit() { if (state.target === 'atlas') { state.atlasZoom = 1; state.atlasPan = { x: 0, y: 0 }; updateAtlasTransform(); } else preview?.fit(); updateZoom(); }
let lastFrameUI = 0, lastVisibleCheck = 0;
function updateFrame(frame) {
  const now = performance.now(); if (now - lastFrameUI > 80 || !frame.playing) { $('#time-current').textContent = seconds(frame.time); $('#time-total').textContent = seconds(frame.duration); $('#timeline-range').max = String(Math.max(1, Math.round(frame.duration * 1000))); $('#timeline-range').value = String(Math.round(frame.time * 1000)); $('#timeline-range').style.setProperty('--progress', `${frame.duration ? frame.time / frame.duration * 100 : 0}%`); $('#render-resolution').textContent = frame.resolution.join(' × '); $('#play-button').setAttribute('aria-pressed', String(frame.playing)); $('#play-button').setAttribute('aria-label', frame.playing ? '暂停动画' : '播放动画'); $('#play-button').textContent = frame.playing ? 'Ⅱ' : '▶'; updateZoom(); lastFrameUI = now; }
  if (frame.playing && state.filter === 'visible' && now - lastVisibleCheck > 500) { const signature = [...new Set(preview.geometry(true).map(d => d.region))].sort().join('\0'); if (signature !== state.visibleSignature) renderLibrary(); lastVisibleCheck = now; }
}
function groupedSelection() { const result = new Map(); for (const name of state.selected) { const r = region(name); if (r) { if (!result.has(r.page)) result.set(r.page, []); result.get(r.page).push(r); } } return result; }
async function refresh(result, page) {
  if (!result) return; if (result.skeletonBytes) return openDescriptor(result);
  status(result); state.thumbnails.clear(); await preview.refreshTextures(state.project, page); renderLibrary(); renderProperties(); renderAtlas();
}
async function edit(operation, options) { if (state.generating) throw Error('请先等待当前重绘任务。'); for (const [page, rects] of groupedSelection()) await refresh(await window.bd.edit({ page, operation, rects, options }), page); toast('修改已应用，可撤销；保存后写入 MOD。'); }
async function changeVisibility(hidden) {
  if (state.generating) throw Error('请先等待当前重绘任务。');
  if (!state.ready || !state.selected.size) return;
  partMenu.close(); const parts = [...state.selected].map(region).filter(Boolean), pages = [...new Set(parts.map(r => r.page))];
  const result = await window.bd.visibility({ parts: parts.map(({ page, name }) => ({ page, name })), hidden });
  status(result); await preview.refreshTextures(state.project, pages); renderLibrary(); renderProperties(); renderAtlas();
  toast(hidden ? '选中部件已隐藏；导出时清除对应贴图像素，可撤销或右键显示。' : '选中部件已显示，保留已有的贴图编辑。');
}
async function save(asNew = false) { const result = await window.bd.save(asNew); if (result?.skeletonBytes) await openDescriptor(result); else if (result) { status(result); toast(result.backup ? '已保存，原文件备份在 .bdmodder-backups 中。' : '所有修改已保存。'); } }
function exportDialog() {
  if (!state.project) return;
  modal('导出制作结果', '<p>导出包含当前未保存的修改，并清除所有隐藏部件的贴图像素。原图集尺寸和骨骼坐标保持有效。</p><div class="dialog-options"><button class="choice-button" id="export-zip"><strong>完整 MOD ZIP</strong><small>保留骨骼、atlas、modfile 和纹理。</small></button><button class="choice-button" id="export-texture"><strong>当前图集 PNG</strong><small>导出原始分辨率，隐藏区域透明。</small></button><button class="choice-button" id="export-scene"><strong>当前角色透明 PNG</strong><small>按预览画布的实际像素导出，不含选区边框。</small></button><button class="choice-button" id="save-as"><strong>另存为 MOD 文件夹</strong><small>创建可用副本，隐藏部件的像素将被清除。</small></button></div>', [{ label: '返回', run: closeModal }]);
  $('#export-zip').onclick = () => guard(() => exportFile({ type: 'zip' })); $('#export-texture').onclick = () => guard(() => exportFile({ type: 'page', page: state.page })); $('#export-scene').onclick = () => guard(() => exportFile({ type: 'preview', data: preview.capture() })); $('#save-as').onclick = () => guard(async () => { closeModal(); await save(true); });
}
async function exportFile(payload) { closeModal(); const file = await window.bd.export(payload); if (file) toast('已导出：' + file); }
function settingsStatus() { $('#workflow-name').textContent = state.settings?.profile?.name || '尚未配置工作流'; $('#service-state').textContent = state.settings?.profile ? '已配置方案' : '未配置'; renderProperties(); syncSettings(); }
function connectionDialog() { return settingsPage.show('ai'); }
const roles = ['image', 'mask', 'positive', 'negative', 'seed', 'steps', 'denoise', 'reference', 'width', 'height', 'resolution'];
const roleNames = { image: '输入图集', mask: '独立遮罩', positive: '修改要求', negative: '负向提示词', seed: '随机种子', steps: '步数', denoise: '重绘幅度', reference: '参考图', width: '宽度', height: '高度', resolution: '分辨率' };
function workflowDialog(profile = state.settings?.profile) {
  if (!profile) return guard(async () => { const imported = await window.bd.importWorkflow(); if (imported) workflowDialog(imported); });
  const fields = []; for (const [node, item] of Object.entries(profile.workflow)) for (const [field, value] of Object.entries(item.inputs || {})) if (!Array.isArray(value) && ['string', 'number', 'boolean'].includes(typeof value)) fields.push({ node, field, title: `${node} · ${item.class_type} · ${field}` });
  const mapping = roles.map(role => { const current = profile.bindings.find(b => b.value === role); return `<label class="field-label workflow-role">${roleNames[role]}<select class="field-select" data-role="${role}"><option value="">不映射</option>${fields.map(f => `<option value="${escape(f.node + '|' + f.field)}"${current?.node === f.node && current?.field === f.field ? ' selected' : ''}>${escape(f.title)}</option>`).join('')}</select></label>`; }).join('');
  modal('配置重绘工作流', `<p>已读取 ${Object.keys(profile.workflow).length} 个节点。确认图集、独立遮罩和提示词映射，保留工作流中的模型设置。</p><label class="dialog-field field-label">方案名称<input id="profile-name" value="${escape(profile.name)}"></label><label class="dialog-field field-label">RunningHub 工作流 ID（使用云端时填写）<input id="workflow-id" value="${escape(profile.workflowId)}"></label><div class="workflow-mappings">${mapping}</div><label class="field-label">图片输出节点<select class="field-select" id="output-node">${Object.entries(profile.workflow).map(([node, item]) => `<option value="${escape(node)}"${node === profile.outputNode ? ' selected' : ''}>${escape(node + ' · ' + item.class_type)}</option>`).join('')}</select></label><label class="dialog-field field-label">提示词模板（{request} 将替换为修改要求）<textarea id="positive-template" rows="3">${escape(profile.positiveTemplate || '{request}')}</textarea></label><label class="dialog-field field-label">负向提示词<textarea id="negative-template" rows="2">${escape(profile.negativeTemplate || '')}</textarea></label>`, [{ label: '导入其他工作流', run: async () => { const imported = await window.bd.importWorkflow(); if (imported) workflowDialog(imported); } }, { label: '取消', run: closeModal }, { label: '保存方案', primary: true, run: async () => {
    const bindings = []; for (const select of $$('[data-role]')) if (select.value) { const [node, field] = select.value.split('|'); bindings.push({ node, field, value: select.dataset.role }); }
    const next = { ...profile, name: $('#profile-name').value.trim() || '重绘方案', workflowId: $('#workflow-id').value.trim(), outputNode: $('#output-node').value, positiveTemplate: $('#positive-template').value, negativeTemplate: $('#negative-template').value, bindings };
    state.settings = await window.bd.settings({ profile: next }); closeModal(); settingsStatus(); toast('工作流已保存。');
  } }]);
}
async function generate() {
  const groups = groupedSelection(); if (groups.size !== 1) throw Error('一次重绘请选择同一张图集上的部件。'); const [page, rects] = [...groups][0]; const provider = $('#provider-select').value;
  const request = $('#prompt-input').value.trim(); if (!request) throw Error('请先填写修改要求。');
  const seedText = $('#seed-input').value.trim(), seed = seedText ? Number(seedText) : Math.floor(Math.random() * 2 ** 48);
  state.generating = true; renderProperties(); $('#cancel-generation').hidden = false; preview.setPlaying(false);
  try {
    const result = await window.bd.generate({ provider, page, rects, request, seed, steps: Number($('#steps-input').value), denoise: Number($('#strength-input').value) });
    modal('确认重绘结果', `<p>结果尚未应用。确认后只更新所选部件所在的图集区域。</p><div class="generation-comparison"><figure><figcaption>当前图集</figcaption><img src="bdasset://${state.project.id}/${encodeURIComponent(page)}?revision=${state.project.revision}"></figure><figure><figcaption>生成结果</figcaption><img src="${escape(result.url)}"></figure></div><p class="help-text">任务：${escape(result.taskId)}</p>`, [{ label: '放弃结果', run: async () => { await window.bd.discardGeneration(); closeModal(); } }, { label: '应用到选区', primary: true, run: async () => { closeModal(); await refresh(await window.bd.applyGeneration(result.id), page); toast('已应用生成结果，可撤销。'); } }]);
  } finally { state.generating = false; renderProperties(); $('#cancel-generation').hidden = true; $('#generation-progress').textContent = '生成结果会先预览，确认后再应用到选区。'; }
}
function metadataDialog() { if (!state.project) return; modal('MOD 配置', `<p>编辑原始 .modfile 配置。未知字段会保留，修改可以撤销。</p><textarea id="manifest-text" class="code-input" rows="15" spellcheck="false">${escape(state.project.manifestText)}</textarea>`, [{ label: '取消', run: closeModal }, { label: '应用配置', primary: true, run: async () => { status(await window.bd.manifest($('#manifest-text').value)); closeModal(); } }]); }
function setupPointer(id, target) {
  const viewport = $(id); let drag = null;
  viewport.addEventListener('pointerdown', event => { if (!state.ready || event.button !== 0 || event.target.closest('select,button')) return; state.target = target; updateZoom(); const pan = target === 'atlas' ? state.atlasPan : preview.pan; drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...pan }, moved: false }; viewport.setPointerCapture(event.pointerId); });
  viewport.addEventListener('pointermove', event => { if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return; if (target === 'atlas') { state.atlasPan = { x: drag.pan.x + dx, y: drag.pan.y + dy }; updateAtlasTransform(); } else { preview.pan = { x: drag.pan.x + dx, y: drag.pan.y + dy }; preview.invalidate(); } });
  viewport.addEventListener('pointerup', event => { if (!drag) return; if (!drag.moved) { let name; if (target === 'scene') { const b = viewport.getBoundingClientRect(); name = preview.pick(event.clientX - b.left, event.clientY - b.top); } else { const b = $('#atlas-sheet').getBoundingClientRect(), page = preview.pages.get(state.page); const x = (event.clientX - b.left) / b.width * page.width, y = (event.clientY - b.top) / b.height * page.height; name = [...state.info.regions].reverse().find(r => r.page === state.page && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)?.name; } if (name) select(name, event.ctrlKey || event.metaKey); } drag = null; if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); });
  viewport.addEventListener('pointercancel', () => drag = null);
  viewport.addEventListener('wheel', event => { if (!state.ready || event.target.closest('select')) return; event.preventDefault(); state.target = target; zoom(event.deltaY < 0 ? .1 : -.1); }, { passive: false });
  viewport.addEventListener('dblclick', () => { state.target = target; fit(); });
}
$$('[data-action]').forEach(button => button.onclick = () => guard(async () => { const action = button.dataset.action; if (action === 'open') openChooser(); else if (action === 'export') exportDialog(); else if (action === 'undo') await refresh(await window.bd.undo(false)); else if (action === 'connection') await connectionDialog(); else if (action === 'settings') await settingsPage.show(); }));
$('.save-button').onclick = () => guard(() => save());
$$('.workspace-switch button').forEach(b => b.onclick = () => setLayout(b.dataset.workspace));
$$('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$$('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; $$('[data-filter]').forEach(el => el.setAttribute('aria-selected', String(el === b))); renderLibrary(); });
$('#part-search').oninput = event => { state.search = event.target.value.toLowerCase().trim(); renderLibrary(); };
$('#clear-selection').onclick = () => { state.selected.clear(); renderLibrary(); renderProperties(); renderAtlas(); preview?.invalidate(); };
$('#animation-select').onchange = event => { preview.setAnimation(event.target.value); renderLibrary(); renderProperties(); };
$('#skin-select').onchange = event => { preview.setSkin(event.target.value); renderLibrary(); renderProperties(); };
$('#atlas-select').onchange = event => { state.page = event.target.value; state.atlasZoom = 1; state.atlasPan = { x: 0, y: 0 }; renderAtlas(); };
$('#play-button').onclick = () => preview?.setPlaying(!preview.playing); $('#step-back').onclick = () => { preview.setPlaying(false); preview.seek(0); }; $('#step-forward').onclick = () => { preview.setPlaying(false); preview.seek(preview.time + 1 / 60); };
$('#timeline-range').oninput = event => { preview.setPlaying(false); preview.seek(Number(event.target.value) / 1000); }; $('#speed-select').onchange = event => preview.speed = Number(event.target.value);
$('#zoom-in').onclick = () => zoom(.1); $('#zoom-out').onclick = () => zoom(-.1); $('#zoom-value').onclick = fit; $('#fit-button').onclick = fit;
$('#inspector-toggle').onclick = () => setInspectorOpen(root.dataset.inspector !== 'open'); $('#inspector-close').onclick = () => setInspectorOpen(false);
$$('.inspector-tabs button').forEach(b => b.onclick = () => setInspector(b.dataset.inspector));
$('#go-ai').onclick = () => { setInspectorOpen(true); setInspector('ai'); }; $('#show-atlas').onclick = () => setView('atlas');
$('#mesh-toggle').onclick = () => { preview.mesh = !preview.mesh; $('#mesh-toggle').setAttribute('aria-pressed', String(preview.mesh)); preview.invalidate(); };
$('#selection-toggle').onchange = event => { preview.outline = event.target.checked; preview.invalidate(); };
$('#locate-button').onclick = () => { state.target = 'scene'; if (preferences.layout !== 'compare') setView('scene'); if (!preview.locate(primary().name)) { setView('atlas'); toast('该部件在当前动画隐藏，已在图集中定位。'); } };
$('#tint-parts').onclick = () => guard(() => edit('tint', { color: $('#tint-color').value, strength: Number($('#tint-strength').value) })); $('#hide-parts').onclick = () => guard(() => changeVisibility(true)); $('#show-parts').onclick = () => guard(() => changeVisibility(false)); $('#restore-parts').onclick = () => guard(() => edit('restore'));
$('#replace-part').onclick = () => guard(async () => { const r = primary(); await refresh(await window.bd.replace({ page: r.page, part: true, rects: [r] }), r.page); });
$('#replace-page').onclick = () => guard(async () => refresh(await window.bd.replace({ page: state.page }), state.page));
$('#export-part').onclick = () => guard(() => exportFile({ type: 'part', page: primary().page, rect: primary() })); $('#export-page').onclick = () => guard(() => exportFile({ type: 'page', page: state.page }));
$('#generate-button').onclick = () => guard(generate); $('#cancel-generation').onclick = () => guard(async () => { await window.bd.cancelGeneration(); $('#generation-progress').textContent = '已停止等待。远程已提交的任务可能继续执行，请检查服务端记录。'; }); $('#workflow-settings').onclick = () => workflowDialog();
$('#provider-select').onchange = event => { preferences.provider = event.target.value; persist(); syncSettings(); };
$('#prompt-input').oninput = event => $('#prompt-count').textContent = event.target.value.length; $('#strength-input').oninput = event => $('#strength-value').textContent = Number(event.target.value).toFixed(2);
$('#dialog-close').onclick = closeModal;
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || settingsPage.open || document.activeElement?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || $('#action-dialog').open) return;
  const action = actionForEvent(event, state.settings?.shortcuts || DEFAULT_SHORTCUTS);
  if (!['play', 'switchWorkspace', 'fit', 'search', 'hide'].includes(action)) return; event.preventDefault();
  if (action === 'hide') { guard(() => changeVisibility(true)); return; }
  if (action === 'play' && state.ready) preview.setPlaying(!preview.playing);
  else if (action === 'switchWorkspace') setLayout(preferences.layout === 'compare' ? 'studio' : 'compare');
  else if (action === 'fit') fit(); else if (action === 'search') $('#part-search').focus();
});
let wide = innerWidth >= 1100; addEventListener('resize', () => { if (wide && innerWidth < 1100) setInspectorOpen(false); wide = innerWidth >= 1100; });
document.addEventListener('visibilitychange', () => { if (document.hidden) preview?.setPlaying(false); });
setupPointer('#scene-viewport', 'scene'); setupPointer('#atlas-viewport', 'atlas');
window.bd.onProgress(message => $('#generation-progress').textContent = message);
window.bd.onCommand(command => guard(async () => { if ((command === 'undo' || command === 'redo') && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { document.execCommand(command); return; } if (command === 'open') openChooser(); else if (command === 'save') await save(); else if (command === 'saveAs') await save(true); else if (command === 'export') exportDialog(); else if (command === 'undo' || command === 'redo') await refresh(await window.bd.undo(command === 'redo')); else if (command === 'fit') fit(); }));
applyPreferences(); setView('scene'); setControls(false);
guard(async () => { const boot = await window.bd.boot(); state.settings = boot.settings; state.version = boot.version; settingsStatus(); setShortcutHints(state.settings.shortcuts); if (boot.project) await openDescriptor(boot.project); });
