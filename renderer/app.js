import { renderRepaintDetails } from './repaint-details.js';
import { repaintControls, isRepaintDistance, repaintOptions } from '../app/repaint-controls.cjs';
import { SpinePreview } from './spine-preview.js';
import { SettingsPage } from './settings-page.js';
import { DEFAULT_SHORTCUTS, actionForEvent, formatShortcut } from '../app/keybindings.cjs';
import { atlasOutlinePath, pickAtlasPart } from '../app/uv-coverage.cjs';
import { PartContextMenu } from './part-visibility.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const root = document.documentElement;
const isMac = window.bd.isMac;
const state = { project: null, info: null, settings: null, selected: new Set(), selectionAnchor: null, filter: 'visible', search: '', page: '', inspector: 'part', view: 'scene', target: 'scene', generating: false, atlasZoom: 1, atlasPan: { x: 0, y: 0 }, thumbnails: new Map(), visibleSignature: '', ready: false };
const preferences = { layout: 'studio', theme: 'dark', density: 'comfortable', grid: true, provider: 'ComfyUI' };
try { Object.assign(preferences, JSON.parse(localStorage.getItem('bdmodder-ui') || '{}')); } catch {}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const persist = () => localStorage.setItem('bdmodder-ui', JSON.stringify(preferences));
const repaintFirstDenoise = $('#repaint-first-denoise');
const repaintSecondDenoise = $('#repaint-second-denoise');
const repaintWriteback = $('#repaint-writeback');
const repaintDenoiseSettings = [
  ['firstRoundDenoise', repaintFirstDenoise, 1],
  ['secondRoundDenoise', repaintSecondDenoise, 0.88]
];
const isDenoise = value => Number.isFinite(value) && value >= 0 && value <= 1;
for (const [name, input, fallback] of repaintDenoiseSettings) {
  const saved = preferences.repaint?.[name];
  input.value = isDenoise(saved) ? saved : fallback;
  input.addEventListener('change', () => {
    const value = input.valueAsNumber;
    if (!isDenoise(value)) return;
    preferences.repaint = { ...preferences.repaint, [name]: value };
    persist();
  });
}
const repaintSecondRound = $('#repaint-second-round');
repaintSecondRound.checked = preferences.repaint?.secondRound !== false;
function repaintProgressMessage(hasResult) {
  if (hasResult) {
    return repaintSecondRound.checked
      ? '可播放动画检查效果，确认后应用到图集。'
      : '第二轮已关闭，可播放动画检查第一轮写回效果，确认后应用。';
  }
  return repaintSecondRound.checked
    ? '组装图重绘、UV 回写和缺口补绘会连续运行。'
    : '第二轮补绘已关闭，仅执行组装图重绘和 UV 回写。';
}
let generationProgressTimer = 0;
let activeTaskProgress = null;
function formatElapsedDuration(startedAt) {
  const elapsed = Math.max(0, Math.floor((Date.now() - Number(startedAt)) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  if (hours) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}
function setGenerationProgress(message) {
  const progress = $('#generation-progress');
  const label = $('#generation-progress-label');
  const meta = $('#generation-progress-meta');
  if (typeof message === 'string' || message?.kind !== 'task') {
    if (generationProgressTimer) clearInterval(generationProgressTimer);
    generationProgressTimer = 0;
    activeTaskProgress = null;
    progress.classList.remove('is-task-progress');
    meta.hidden = true;
    meta.textContent = '';
    label.textContent = typeof message === 'string' ? message : String(message ?? '');
    return;
  }

  activeTaskProgress = message;
  progress.classList.add('is-task-progress');
  const round = message.round ? `第 ${message.round} 轮 · ` : '';
  const status = message.status === 'queued' ? '排队中'
    : message.status === 'running' ? '正在生成' : '状态查询中';
  const nextLabel = round + status;
  if (label.textContent !== nextLabel) label.textContent = nextLabel;
  meta.hidden = false;
  const updateElapsed = () => {
    if (!activeTaskProgress) return;
    meta.textContent = `已持续 ${formatElapsedDuration(activeTaskProgress.startedAt)} · 任务 ID：${activeTaskProgress.id}`;
  };
  updateElapsed();
  if (!generationProgressTimer) generationProgressTimer = setInterval(updateElapsed, 1000);
}
setGenerationProgress(repaintProgressMessage(false));
repaintSecondRound.addEventListener('change', () => {
  preferences.repaint = { ...preferences.repaint, secondRound: repaintSecondRound.checked };
  persist();
  setGenerationProgress(repaintProgressMessage(false));
  renderProperties();
});
repaintWriteback.value = preferences.repaint?.writebackMode === 'argb' ? 'argb' : 'rgb';
repaintWriteback.addEventListener('change', () => {
  preferences.repaint = { ...preferences.repaint, writebackMode: repaintWriteback.value };
  persist();
});
const repaintInputs = $$('[data-repaint-option]');
for (const input of repaintInputs) {
  const name = input.dataset.repaintOption;
  const saved = preferences.repaint?.[name];
  input.value = isRepaintDistance(saved) ? saved : repaintControls[name].standard;
  input.addEventListener('change', () => {
    const value = input.valueAsNumber;
    if (!isRepaintDistance(value)) return;
    preferences.repaint = { ...preferences.repaint, [name]: value };
    persist();
  });
}
const region = name => state.info?.regions.find(r => r.name === name);
const primary = () => region([...state.selected].at(-1));
const isHidden = r => state.project?.hiddenParts?.some(p => p.page === r.page && p.name === r.name) || false;
const partMenu = new PartContextMenu();
const atlasOutlines = new WeakMap();
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
  isMac,
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
  const shortcut = id => formatShortcut(keys[id], isMac);
  $('.workspace-switch').title = '切换工作区（' + shortcut('switchWorkspace') + '）'; $('#fit-button .key-hint').textContent = shortcut('fit'); $('.search-box kbd').textContent = shortcut('search');
  $('#play-button').title = '播放 / 暂停（' + shortcut('play') + '）'; $('[data-action="undo"]').title = '撤销修改（' + shortcut('undo') + '）'; $('.save-button').title = '保存（' + shortcut('save') + '）';
  $('#hide-parts').title = '隐藏选中部件（' + shortcut('hide') + '）';
  $('#clear-selection').title = keys.clearSelection ? '清空选择（' + shortcut('clearSelection') + '）' : '清空选择';
}
function updateInterfaceZoom(value = state.settings?.uiZoom) { if (Number.isFinite(value)) $('#ui-zoom-value').textContent = Math.round(value * 100) + '%'; }

function setInspectorOpen(open) { root.dataset.inspector = open ? 'open' : 'closed'; $('#inspector-toggle').setAttribute('aria-expanded', String(open)); }
function setLayout(value) { preferences.layout = value === 'compare' ? 'compare' : 'studio'; root.dataset.layout = preferences.layout; $('#layout-select').value = preferences.layout; $$('.workspace-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.workspace === preferences.layout))); setInspectorOpen(preferences.layout === 'studio' && innerWidth >= 1100); persist(); preview?.invalidate(); }
function applyPreferences() { preferences.theme = preferences.theme === 'light' ? 'light' : 'dark'; preferences.density = preferences.density === 'compact' ? 'compact' : 'comfortable'; root.dataset.theme = preferences.theme; root.dataset.density = preferences.density; root.dataset.grid = String(Boolean(preferences.grid)); $('#theme-select').value = preferences.theme; $('#density-select').value = preferences.density; $('#grid-toggle').checked = preferences.grid; preferences.provider = preferences.provider === 'RunningHub' ? 'RunningHub' : 'ComfyUI'; $('#provider-select').value = preferences.provider; setLayout(preferences.layout); syncSettings(); }
function setView(view) { state.view = view; state.target = view; root.dataset.view = view; $$('.segmented [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view))); preview?.invalidate(); updateZoom(); }
function setSelectionOnly(enabled) {
  if (!preview) return;
  preview.selectionOnly = enabled;
  $('#scene-pick-hint').hidden = enabled;
  $('#restore-full-preview').hidden = !enabled;
  $('#scene-state').textContent = enabled ? '只看选中部件' : '选区定位已开启';
  if (enabled) setView('scene');
  else preview.invalidate();
}
function setInspector(page) { state.inspector = page; $$('.inspector-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.inspector === page))); $$('.inspector-page').forEach(el => el.hidden = el.dataset.page !== page); $('#inspector-scroll').scrollTop = 0; }
function status(result) {
  if (!result || !state.project) return; Object.assign(state.project, result);
  const dirty = Boolean(result.dirty); $('#project-state').textContent = dirty ? '未保存' : '已载入'; $('#dirty-state').textContent = dirty ? '有未保存的修改' : '所有修改已保存';
  $('.save-button').disabled = !dirty && !state.project.temporary; $('[data-action="undo"]').disabled = !result.undo; document.title = `${dirty ? '● ' : ''}${state.project.name} — BD Modder`; syncSettings();
}
function setControls(ready) { state.ready = ready; for (const selector of ['#play-button', '#step-back', '#step-forward', '#timeline-range', '#animation-select', '#skin-select', '#fit-button', '#zoom-in', '#zoom-out', '#mesh-toggle', '#bones-toggle', '#replace-page', '#export-page', '[data-action="export"]']) $(selector).disabled = !ready; renderProperties(); }
async function openDescriptor(descriptor) {
  if (!descriptor) return; if (descriptor.error) throw Error(descriptor.error); if (!preview) throw Error('WebGL 渲染器不可用。');
  setControls(false); $('#loading-mask').hidden = false; $('#canvas-empty').hidden = true; $('#status-message').textContent = '读取骨骼与原始图集…';
  try {
    const start = performance.now(); partMenu.close(); state.repaintPreview = null; state.project = descriptor; state.selected.clear(); state.thumbnails.clear();
    state.selectionAnchor = null;
    setSelectionOnly(false);
    if (state.settings && descriptor.recent) state.settings.recent = descriptor.recent;
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
    row.onclick = event => select(r.name, event.ctrlKey || event.metaKey, event.shiftKey ? parts : []);
    row.oncontextmenu = event => {
      event.preventDefault();
      if (!state.ready) return;
      if (!state.selected.has(r.name)) select(r.name);
      const parts = [...state.selected].map(region);
      const canIsolate = parts.some(part => !isHidden(part));
      const groups = groupedSelection();
      const canReplace = !state.generating && parts.length > 0 && (parts.length === 1 || groups.size === 1 && !parts.some(isHidden));
      partMenu.show(event, $$('.part-row').find(el => el.dataset.region === r.name), {
        count: parts.length, canHide: !state.generating && canIsolate, canShow: !state.generating && parts.some(isHidden),
        canReplace, canExport: !state.generating && parts.length > 0,
        canIsolate, selectionOnly: preview.selectionOnly, shortcut: state.settings?.shortcuts.hide || 'H',
        onHide: () => guard(() => changeVisibility(true)), onShow: () => guard(() => changeVisibility(false)),
        onReplace: () => guard(replaceSelectedPng), onExport: () => guard(exportSelectedPng),
        onToggleSelectionOnly: () => setSelectionOnly(!preview.selectionOnly)
      });
    };
    fragment.append(row);
  }
  list.append(fragment); $('#list-caption').textContent = `${parts.length} 个部件`; if (!parts.length) { const empty = document.createElement('p'); empty.className = 'list-empty'; empty.textContent = state.filter === 'hidden' && !hidden.size ? '还没有隐藏的部件' : '没有匹配的部件'; list.append(empty); }
}
function select(name, additive = false, rangeParts = []) {
  if (!region(name)) return;
  const anchorIndex = rangeParts.findIndex(part => part.name === state.selectionAnchor);
  const targetIndex = rangeParts.findIndex(part => part.name === name);
  if (!additive) state.selected.clear();
  if (anchorIndex >= 0 && targetIndex >= 0) {
    const from = Math.min(anchorIndex, targetIndex), to = Math.max(anchorIndex, targetIndex);
    for (let i = from; i <= to; i++) state.selected.add(rangeParts[i].name);
    // Keep the clicked endpoint as the primary selection.
    state.selected.delete(name);
    state.selected.add(name);
  } else {
    if (additive && state.selected.has(name)) state.selected.delete(name);
    else state.selected.add(name);
    state.selectionAnchor = name;
  }
  const r = primary();
  if (r) state.page = r.page;
  renderLibrary();
  renderProperties();
  renderAtlas();
  if (state.selected.size) preview.invalidate();
  else setSelectionOnly(false);
}
function clearSelection() {
  if (!state.ready) return;
  partMenu.close();
  state.selected.clear();
  state.selectionAnchor = null;
  setSelectionOnly(false);
  renderLibrary();
  renderProperties();
  renderAtlas();
}
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
  const replaceGroups = groupedSelection();
  const replaceUnavailable = count > 1 && (replaceGroups.size !== 1 || hiddenCount > 0);
  $('#replace-part').disabled = !state.ready || !count || state.generating || replaceUnavailable;
  $('#replace-part').textContent = count > 1 ? '替换组合 PNG' : '替换 PNG';
  $('#replace-part').title = count > 1 && replaceGroups.size !== 1 ? '组合替换仅支持同一图集页。' : count > 1 && hiddenCount ? '请先显示所有选中的部件，再替换组合 PNG。' : '';
  $('#export-part').disabled = !state.ready || !count || state.generating;
  $('#export-part').textContent = count > 1 ? '导出组合 PNG' : '导出部件';
  const unavailable = !state.ready || !r || state.generating || Boolean(state.repaintPreview);
  $('#generate-button').disabled = unavailable || hiddenCount > 0;
  $('#legacy-generate-button').disabled = unavailable || !state.settings?.profile;
  $('#repaint-result').hidden = !state.repaintPreview;
  repaintFirstDenoise.disabled = state.generating;
  repaintSecondDenoise.disabled = state.generating;
  repaintWriteback.disabled = state.generating;
  repaintSecondRound.disabled = state.generating;
  for (const input of repaintInputs) {
    input.disabled = state.generating || (!repaintSecondRound.checked &&
      ['maskExpand', 'maskFeather'].includes(input.dataset.repaintOption));
  }
}
function renderAtlas() {
  const p = state.project?.pages.find(p => p.name === state.page);
  if (!p || !state.info) return;
  const repaint = state.repaintPreview;
  const showingResult = repaint?.showingResult && repaint.page === p.name;
  $('#atlas-select').value = p.name;
  const source = new URL(showingResult ? repaint.url : `bdasset://${state.project.id}/${encodeURIComponent(p.name)}?revision=${state.project.revision}`);
  if (state.project.hiddenParts.some(part => part.page === p.name)) source.searchParams.set('hidden', 'gray');
  $('#atlas-image').src = source.href;
  $('#atlas-source').textContent = showingResult ? '重绘预览' : '当前贴图';
  $('#atlas-sheet').style.setProperty('--atlas-ratio', p.width / p.height); $('#atlas-size').textContent = `${p.width} × ${p.height}`; $('#texture-file').textContent = p.name; $('#texture-size').textContent = `${p.width} × ${p.height}`;
  const overlay = $('#atlas-overlay'); overlay.setAttribute('viewBox', `0 0 ${p.width} ${p.height}`); overlay.replaceChildren();
  const atlas = preview.pages.get(p.name);
  if (preview.outline && atlas && state.selected.size) {
    if (!atlasOutlines.has(atlas)) atlasOutlines.set(atlas, new Map());
    const paths = atlasOutlines.get(atlas);
    for (const part of state.info.regions) {
      if (part.page !== p.name || !state.selected.has(part.name)) continue;
      if (!paths.has(part.name)) paths.set(part.name, atlasOutlinePath(atlas, part, preview.partMeshes(part)));
      const d = paths.get(part.name);
      if (!d) continue;
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      outline.setAttribute('d', d);
      outline.setAttribute('class', 'atlas-outline');
      overlay.append(outline);
    }
  }
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
  const previewPage = state.repaintPreview?.page;
  state.repaintPreview = null;
  if (page && previewPage && previewPage !== page) page = undefined;
  status(result); state.thumbnails.clear(); await preview.refreshTextures(state.project, page); renderLibrary(); renderProperties(); renderAtlas();
}
async function edit(operation, options) {
  if (state.generating) throw Error('请先等待当前重绘任务。');
  if (!state.ready || !state.selected.size) return;
  const projectId = state.project.id;
  const edits = Array.from(groupedSelection(), ([page, rects]) => operation === 'restore'
    ? { page, parts: rects.map(part => ({ name: part.name, meshes: preview.partMeshes(part) })) }
    : { page, rects, options });
  for (const args of edits) {
    if (state.project?.id !== projectId) return;
    const result = await window.bd.edit({ ...args, operation, projectId });
    if (state.project?.id !== projectId) return;
    await refresh(result, args.page);
  }
  toast('修改已应用，可撤销；保存后写入 MOD。');
}
async function changeVisibility(hidden) {
  if (state.generating) throw Error('请先等待当前重绘任务。');
  if (!state.ready || !state.selected.size) return;
  partMenu.close(); const parts = [...state.selected].map(region).filter(Boolean);
  const result = await window.bd.visibility({ parts: parts.map(({ page, name }) => ({ page, name })), hidden });
  if (state.repaintPreview) await refresh(result);
  else { status(result); preview.setHiddenParts(result.hiddenParts); renderLibrary(); renderProperties(); renderAtlas(); }
  toast(hidden ? '选中部件已隐藏；导出时清除对应贴图像素，可撤销或右键显示。' : '选中部件已显示，保留已有的贴图编辑。');
}
async function save(asNew = false) { const result = await window.bd.save(asNew); if (result?.skeletonBytes) await openDescriptor(result); else if (result) { status(result); toast(result.backup ? '已保存，原文件备份在 .bdmodder-backups 中。' : '所有修改已保存。'); } }
function exportDialog() {
  if (!state.project) return;
  modal('导出制作结果', '<p>导出包含当前未保存的修改，并清除所有隐藏部件的贴图像素。原图集尺寸和骨骼坐标保持有效。</p><div class="dialog-options"><button class="choice-button" id="export-zip"><strong>完整 MOD ZIP</strong><small>保留骨骼、atlas、modfile 和纹理。</small></button><button class="choice-button" id="export-texture"><strong>当前图集 PNG</strong><small>导出原始分辨率，隐藏区域透明。</small></button><button class="choice-button" id="export-scene"><strong>当前角色透明 PNG</strong><small>按预览画布的实际像素导出，不含选区边框。</small></button><button class="choice-button" id="save-as"><strong>另存为 MOD 文件夹</strong><small>创建可用副本，隐藏部件的像素将被清除。</small></button></div>', [{ label: '返回', run: closeModal }]);
  $('#export-zip').onclick = () => guard(() => exportFile({ type: 'zip' })); $('#export-texture').onclick = () => guard(() => exportFile({ type: 'page', page: state.page })); $('#export-scene').onclick = () => guard(() => exportFile({ type: 'preview', data: preview.capture() })); $('#save-as').onclick = () => guard(async () => { closeModal(); await save(true); });
}
async function exportFile(payload) { closeModal(); const file = await window.bd.export(payload); if (file) toast('已导出：' + file); }
async function replaceSelectedPng() {
  if (state.selected.size > 1) {
    const groups = groupedSelection();
    if (groups.size !== 1) throw Error('组合替换请选择同一张图集页上的部件。');
    const [page, rects] = [...groups][0];
    if (rects.some(isHidden)) throw Error('请先显示所有选中的部件，再替换组合 PNG。');
    const playback = preview.playing;
    preview.setPlaying(false);
    try {
      const names = rects.map(part => part.name);
      const snapshot = preview.repaintSnapshot(page, names);
      await refresh(await window.bd.replace({
        composite: true, page, names, snapshot, projectId: state.project.id, revision: state.project.revision
      }), page);
    } finally { preview.setPlaying(playback); }
    return;
  }
  const r = primary();
  await refresh(await window.bd.replace({ part: true, page: r.page, name: r.name, meshes: preview.partMeshes(r) }), r.page);
}
function exportSelectedPng() {
  if (state.selected.size > 1) return exportFile({ type: 'parts', data: preview.captureSelection() });
  const r = primary();
  return exportFile({ type: 'part', page: r.page, name: r.name, meshes: preview.partMeshes(r) });
}
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
async function setRepaintPreview(showResult) {
  const result = state.repaintPreview;
  if (!result) return;
  await preview.refreshTextures(state.project, result.page, showResult ? result.url : undefined);
  if (state.repaintPreview !== result) return;
  result.showingResult = showResult;
  renderAtlas();
  $('#toggle-repaint-source').textContent = showResult ? '看原图' : '看重绘结果';
}

async function generateRepaint() {
  const groups = groupedSelection();
  if (groups.size !== 1) throw Error('一次局部重绘请选择同一张图集上的部件。');
  if (!state.settings?.hasKey) throw Error('请先在服务设置中启用 RunningHub API Key。');
  const [page, rects] = [...groups][0];
  const request = $('#prompt-input').value.trim();
  if (!request) throw Error('请先填写修改要求。');
  const seedText = $('#seed-input').value.trim();
  const seed = seedText ? Number(seedText) : Math.floor(Math.random() * 2 ** 32);
  const firstRoundDenoise = repaintFirstDenoise.valueAsNumber;
  const secondRoundDenoise = repaintSecondDenoise.valueAsNumber;
  if (!isDenoise(firstRoundDenoise) || !isDenoise(secondRoundDenoise)) {
    throw Error('第一轮和第二轮降噪强度须在 0 到 1 之间。');
  }
  const names = rects.map(rect => rect.name);
  const options = repaintOptions({
    ...Object.fromEntries(repaintInputs.map(input => [input.dataset.repaintOption, input.valueAsNumber])),
    writebackMode: repaintWriteback.value,
    secondRound: repaintSecondRound.checked
  });
  const playback = { animation: preview.animation, time: preview.time, playing: preview.playing };
  preview.setPlaying(false);
  const snapshot = preview.repaintSnapshot(page, names);
  state.generating = true;
  renderProperties();
  $('#cancel-generation').hidden = false;
  try {
    const result = await window.bd.repaint({
      page, names, snapshot, request, seed, revision: state.project.revision,
      steps: Number($('#steps-input').value), firstRoundDenoise, secondRoundDenoise,
      ...options
    });
    state.repaintPreview = { ...result, page };
    state.page = page;
    await setRepaintPreview(true);
    setView('scene');
    const { total, first, direct, neighbor, remaining } = result.stats;
    $('#repaint-result-stats').textContent = '候选 ' + total.toLocaleString() + ' · 第一轮 ' +
      first.toLocaleString() + ' · 第二轮 ' + (direct + neighbor).toLocaleString() +
      ' · 待补 ' + remaining.toLocaleString();
  } catch (error) {
    if (state.repaintPreview) {
      state.repaintPreview = null;
      await window.bd.discardGeneration();
      await preview.refreshTextures(state.project, page);
      renderAtlas();
    }
    throw error;
  } finally {
    state.generating = false;
    const animation = state.info.animations.find(item => item.name === playback.animation);
    if (animation) {
      $('#animation-select').value = animation.name;
      preview.setAnimation(animation.name);
      preview.seek(playback.time);
    }
    preview.setPlaying(playback.playing);
    $('#cancel-generation').hidden = true;
    setGenerationProgress(repaintProgressMessage(Boolean(state.repaintPreview)));
    renderProperties();
  }
}

function showRepaintDetails() {
  if (!state.repaintPreview?.details) return;
  const dialog = $('#repaint-details-dialog');
  renderRepaintDetails(dialog, state.repaintPreview, escape, () => {
    dialog.close();
    setView('scene');
    preview.setPlaying(true);
  });
}

async function finishRepaint(apply) {
  const result = state.repaintPreview;
  if (!result) return;
  if (apply) {
    const next = await window.bd.applyGeneration(result.id);
    await refresh(next, result.page);
    toast('局部重绘已应用，可撤销。');
  } else {
    await window.bd.discardGeneration();
    state.repaintPreview = null;
    await preview.refreshTextures(state.project, result.page);
    renderAtlas();
    renderProperties();
  }
  setGenerationProgress(repaintProgressMessage(false));
}

async function generate() {
  const groups = groupedSelection(); if (groups.size !== 1) throw Error('一次重绘请选择同一张图集上的部件。'); const [page, rects] = [...groups][0]; const provider = $('#provider-select').value;
  const request = $('#prompt-input').value.trim(); if (!request) throw Error('请先填写修改要求。');
  const seedText = $('#seed-input').value.trim(), seed = seedText ? Number(seedText) : Math.floor(Math.random() * 2 ** 48);
  state.generating = true; renderProperties(); $('#cancel-generation').hidden = false; preview.setPlaying(false);
  try {
    const result = await window.bd.generate({ provider, page, rects, request, seed, steps: Number($('#steps-input').value), denoise: Number($('#strength-input').value) });
    modal('确认重绘结果', `<p>结果尚未应用。确认后只更新所选部件所在的图集区域。</p><div class="generation-comparison"><figure><figcaption>当前图集</figcaption><img src="bdasset://${state.project.id}/${encodeURIComponent(page)}?revision=${state.project.revision}"></figure><figure><figcaption>生成结果</figcaption><img src="${escape(result.url)}"></figure></div><p class="help-text">任务：${escape(result.taskId)}</p>`, [{ label: '放弃结果', run: async () => { await window.bd.discardGeneration(); closeModal(); } }, { label: '应用到选区', primary: true, run: async () => { closeModal(); await refresh(await window.bd.applyGeneration(result.id), page); toast('已应用生成结果，可撤销。'); } }]);
  } finally { state.generating = false; renderProperties(); $('#cancel-generation').hidden = true; setGenerationProgress('生成结果会先预览，确认后再应用到选区。'); }
}
function metadataDialog() { if (!state.project) return; modal('MOD 配置', `<p>编辑原始 .modfile 配置。未知字段会保留，修改可以撤销。</p><textarea id="manifest-text" class="code-input" rows="15" spellcheck="false">${escape(state.project.manifestText)}</textarea>`, [{ label: '取消', run: closeModal }, { label: '应用配置', primary: true, run: async () => { status(await window.bd.manifest($('#manifest-text').value)); closeModal(); } }]); }
function setupPointer(id, target) {
  const viewport = $(id); let drag = null;
  viewport.addEventListener('pointerdown', event => { if (!state.ready || event.button !== 0 || event.target.closest('select,button')) return; state.target = target; updateZoom(); const pan = target === 'atlas' ? state.atlasPan : preview.pan; drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...pan }, moved: false }; viewport.setPointerCapture(event.pointerId); });
  viewport.addEventListener('pointermove', event => { if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return; if (target === 'atlas') { state.atlasPan = { x: drag.pan.x + dx, y: drag.pan.y + dy }; updateAtlasTransform(); } else { preview.pan = { x: drag.pan.x + dx, y: drag.pan.y + dy }; preview.invalidate(); } });
  viewport.addEventListener('pointerup', event => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (moved || !state.ready) return;

    const bounds = (target === 'atlas' ? $('#atlas-sheet') : viewport).getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    let name;
    if (target === 'atlas') {
      const page = preview.pages.get(state.page);
      if (!page || !bounds.width || !bounds.height) return;
      name = pickAtlasPart(state.info.regions, state.page, page, x / bounds.width * page.width, y / bounds.height * page.height, preview.partMeshes);
    } else name = preview.pick(x, y);
    if (name) select(name, event.ctrlKey || event.metaKey);
  });
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
$('#clear-selection').onclick = clearSelection;
$('#restore-full-preview').onclick = () => setSelectionOnly(false);
$('#animation-select').onchange = event => { preview.setAnimation(event.target.value); renderLibrary(); renderProperties(); };
$('#skin-select').onchange = event => { preview.setSkin(event.target.value); renderLibrary(); renderProperties(); };
$('#atlas-select').onchange = event => { state.page = event.target.value; state.atlasZoom = 1; state.atlasPan = { x: 0, y: 0 }; renderAtlas(); };
$('#play-button').onclick = () => preview?.setPlaying(!preview.playing); $('#step-back').onclick = () => { preview.setPlaying(false); preview.seek(0); }; $('#step-forward').onclick = () => { preview.setPlaying(false); preview.seek(preview.time + 1 / 60); };
$('#timeline-range').oninput = event => { preview.setPlaying(false); preview.seek(Number(event.target.value) / 1000); }; $('#speed-select').onchange = event => preview.speed = Number(event.target.value);
$('#zoom-in').onclick = () => zoom(.1); $('#zoom-out').onclick = () => zoom(-.1); $('#zoom-value').onclick = fit; $('#fit-button').onclick = fit;
$('#ui-zoom-in').onclick = () => guard(async () => updateInterfaceZoom(await window.bd.zoom('in'))); $('#ui-zoom-out').onclick = () => guard(async () => updateInterfaceZoom(await window.bd.zoom('out'))); $('#ui-zoom-reset').onclick = () => guard(async () => updateInterfaceZoom(await window.bd.zoom('reset')));
$('#inspector-toggle').onclick = () => setInspectorOpen(root.dataset.inspector !== 'open'); $('#inspector-close').onclick = () => setInspectorOpen(false);
$$('.inspector-tabs button').forEach(b => b.onclick = () => setInspector(b.dataset.inspector));
$('#go-ai').onclick = () => { setInspectorOpen(true); setInspector('ai'); }; $('#show-atlas').onclick = () => setView('atlas');
$('#mesh-toggle').onclick = () => { preview.mesh = !preview.mesh; $('#mesh-toggle').setAttribute('aria-pressed', String(preview.mesh)); preview.invalidate(); };
$('#bones-toggle').onclick = () => { preview.bones = !preview.bones; $('#bones-toggle').setAttribute('aria-pressed', String(preview.bones)); preview.invalidate(); };
$('#selection-toggle').onchange = event => { preview.outline = event.target.checked; preview.invalidate(); renderAtlas(); };
$('#locate-button').onclick = () => { state.target = 'scene'; if (preferences.layout !== 'compare') setView('scene'); if (!preview.locate(primary().name)) { setView('atlas'); toast('该部件在当前动画隐藏，已在图集中定位。'); } };
$('#tint-parts').onclick = () => guard(() => edit('tint', { color: $('#tint-color').value, strength: Number($('#tint-strength').value) })); $('#hide-parts').onclick = () => guard(() => changeVisibility(true)); $('#show-parts').onclick = () => guard(() => changeVisibility(false)); $('#restore-parts').onclick = () => guard(() => edit('restore'));
$('#replace-part').onclick = () => guard(replaceSelectedPng);
$('#replace-page').onclick = () => guard(async () => refresh(await window.bd.replace({ page: state.page }), state.page));
$('#export-part').onclick = () => guard(exportSelectedPng);
$('#export-page').onclick = () => guard(() => exportFile({ type: 'page', page: state.page }));
$('#generate-button').onclick = () => guard(generateRepaint);
$('#legacy-generate-button').onclick = () => guard(generate);
$('#toggle-repaint-source').onclick = () => guard(() => setRepaintPreview(!state.repaintPreview?.showingResult));
$('#open-repaint-details').onclick = () => guard(showRepaintDetails);
$('#close-repaint-details').onclick = () => $('#repaint-details-dialog').close();
$('#repaint-details-dialog').addEventListener('close', () => $('#repaint-details-content').replaceChildren());
$('#apply-repaint').onclick = () => guard(() => finishRepaint(true));
$('#discard-repaint').onclick = () => guard(() => finishRepaint(false));
  $('#cancel-generation').onclick = () => guard(async () => { await window.bd.cancelGeneration(); setGenerationProgress('已停止等待。远程已提交的任务可能继续执行，请检查服务端记录。'); }); $('#workflow-settings').onclick = () => workflowDialog();
$('#provider-select').onchange = event => { preferences.provider = event.target.value; persist(); syncSettings(); };
$('#prompt-input').oninput = event => $('#prompt-count').textContent = event.target.value.length; $('#strength-input').oninput = event => $('#strength-value').textContent = Number(event.target.value).toFixed(2);
$('#dialog-close').onclick = closeModal;
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || settingsPage.open || document.activeElement?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('dialog[open]')) return;
  const action = actionForEvent(event, state.settings?.shortcuts || DEFAULT_SHORTCUTS, isMac);
  if (!['play', 'switchWorkspace', 'fit', 'search', 'hide', 'clearSelection'].includes(action)) return; event.preventDefault();
  if (action === 'hide') { guard(() => changeVisibility(true)); return; }
  if (action === 'play' && state.ready) preview.setPlaying(!preview.playing);
  else if (action === 'switchWorkspace') setLayout(preferences.layout === 'compare' ? 'studio' : 'compare');
  else if (action === 'fit') fit(); else if (action === 'search') $('#part-search').focus();
  else if (action === 'clearSelection') clearSelection();
});
let wide = innerWidth >= 1100; addEventListener('resize', () => { if (wide && innerWidth < 1100) setInspectorOpen(false); wide = innerWidth >= 1100; });
document.addEventListener('visibilitychange', () => { if (document.hidden) preview?.setPlaying(false); });
setupPointer('#scene-viewport', 'scene'); setupPointer('#atlas-viewport', 'atlas');
window.bd.onProgress(setGenerationProgress);
window.bd.onZoomChanged(updateInterfaceZoom);
window.bd.onCommand(command => guard(async () => { if ((command === 'undo' || command === 'redo') && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { document.execCommand(command); return; } if (command === 'open') openChooser(); else if (command === 'save') await save(); else if (command === 'saveAs') await save(true); else if (command === 'export') exportDialog(); else if (command === 'undo' || command === 'redo') await refresh(await window.bd.undo(command === 'redo')); else if (command === 'fit') fit(); }));
applyPreferences(); setView('scene'); setControls(false);
if (isMac) {
  for (const hint of $$('[data-primary-key]')) hint.textContent = '⌘';
  for (const button of $$('.interface-zoom button[title]')) button.title = button.title.replaceAll('Ctrl', '⌘');
}
guard(async () => { const boot = await window.bd.boot(); state.settings = boot.settings; state.version = boot.version; updateInterfaceZoom(); settingsStatus(); setShortcutHints(state.settings.shortcuts); if (boot.project) await openDescriptor(boot.project); });
