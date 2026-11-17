(() => {
  'use strict';
  const root = document.documentElement;
  const $ = (query) => document.querySelector(query);
  const $$ = (query) => [...document.querySelectorAll(query)];
  const sample = window.MODSTUDIO_SAMPLE;
  if (!sample) { $('#status-message').textContent = '示例数据缺失，请保留完整草案目录。'; return; }
  const asset = (path) => '../' + path;
  const svgNS = 'http://www.w3.org/2000/svg';
  const state = { loaded: true, animation: sample.animations[0].id, selected: new Set(['B_face_2']), filter: 'visible', search: '', mesh: false, outline: true, zoom: 1, panX: 0, panY: 0, page: '', inspector: 'part', time: 0, playing: false, speed: 1, lastTime: 0 };
  const preferences = { layout: 'studio', theme: 'dark', density: 'comfortable', grid: true, provider: 'ComfyUI' };
  let toastTimer = 0, drag = null, frameRequest = 0;
  try { const saved = JSON.parse(localStorage.getItem('modstudio-draft-v0') || 'null'); if (saved) for (const key of Object.keys(preferences)) if (key in saved) preferences[key] = saved[key]; } catch { /* Local file contexts may disallow storage. */ }
  const settingsAPI = window.BDSettings;
  const hiddenParts = new Set(), hiddenHistory = [], hiddenFuture = [], partMenu = new settingsAPI.PartContextMenu();
  let shortcuts = { ...settingsAPI.DEFAULT_SHORTCUTS };
  let service = { address: 'http://127.0.0.1:8188/', cloudAddress: 'https://www.runninghub.cn/', hasKey: false, profile: null };
  try { shortcuts = settingsAPI.validateShortcuts(JSON.parse(localStorage.getItem('bdmodder-draft-shortcuts') || '{}')); const saved = JSON.parse(localStorage.getItem('bdmodder-draft-service') || '{}'); service = { ...service, ...saved }; } catch {}
  const settingsPage = new settingsAPI.SettingsPage({
    native: false, onPause: pause, onResume: renderSceneSelection,
    onPreference: (key, value) => { preferences[key] = value; if (key === 'layout') setLayout(value); else if (key === 'provider') $('#provider-select').value = value; else root.dataset[key] = String(value); persist(); settingsPage.sync({ preferences }); },
    onResetPreferences: () => { Object.assign(preferences, { layout: 'studio', theme: 'dark', density: 'comfortable', grid: true, provider: 'ComfyUI' }); applyPreferences(); },
    onShortcuts: value => { shortcuts = settingsAPI.validateShortcuts(value); localStorage.setItem('bdmodder-draft-shortcuts', JSON.stringify(shortcuts)); setShortcutHints(); return shortcuts; },
    onSaveService: patch => { for (const key of ['address', 'cloudAddress']) { const url = new URL(patch[key]); if (!['http:', 'https:'].includes(url.protocol)) throw Error('请输入 HTTP / HTTPS 服务地址。'); service[key] = url.href; } localStorage.setItem('bdmodder-draft-service', JSON.stringify({ address: service.address, cloudAddress: service.cloudAddress })); return service; },
    onWorkflow: () => modal('重绘工作流', 'AI WORKFLOW', '<p>在桌面版中导入 ComfyUI API 工作流或重绘方案，即可设置图集、遮罩和提示词映射。</p><p class="dialog-info">当前浏览器页面只提供设计预览。</p>', [{ label: '返回设置', action: closeModal }]),
    onProjectAction: () => {}
  });
  function setShortcutHints() { $('.workspace-switch').title = '切换工作区（' + shortcuts.switchWorkspace + '）'; $('#fit-button .key-hint').textContent = shortcuts.fit; $('.search-box kbd').textContent = shortcuts.search; $('#play-button').title = '播放控制条演示（' + shortcuts.play + '）'; }
  const currentPose = () => sample.animations.find((a) => a.id === state.animation) || sample.animations[0];
  const visibleNames = () => new Set(currentPose().geometry.map((d) => d.region));
  const primaryPart = () => sample.parts.find((p) => p.name === [...state.selected].at(-1));
  function renderVisibility() { renderLibrary(); renderProperties(); renderAtlas(); renderSceneSelection(); $('[data-action="undo"]').disabled = !hiddenHistory.length; }
  function changeVisibility(hidden) {
    if (!state.selected.size || !state.loaded) return; partMenu.close(); const before = [...hiddenParts];
    for (const name of state.selected) hidden ? hiddenParts.add(name) : hiddenParts.delete(name);
    if (JSON.stringify(before) === JSON.stringify([...hiddenParts])) return;
    hiddenHistory.push(before); hiddenFuture.length = 0; renderVisibility(); toast(hidden ? '已标灰隐藏部件。桌面版同步隐藏角色部件，导出时清除其像素。' : '选中部件已显示。');
  }
  function undoVisibility(redo = false) { const from = redo ? hiddenFuture : hiddenHistory, to = redo ? hiddenHistory : hiddenFuture, value = from.pop(); if (!value) return; to.push([...hiddenParts]); hiddenParts.clear(); value.forEach(name => hiddenParts.add(name)); renderVisibility(); }
  const category = (name) => /face|eye|mouth|nose/i.test(name) ? '面部' : /hair/i.test(name) ? '发型' : /sword|weapon|grip/i.test(name) ? '武器' : /flower|bg|far_/i.test(name) ? '场景' : '角色';
  const categoryRank = (name) => ({ 面部: 0, 角色: 1, 武器: 2, 发型: 3, 场景: 4 })[category(name)];
  const timeLabel = (ms) => '00:' + String(Math.floor(ms / 1000)).padStart(2, '0');
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3000); }
  function persist() { try { localStorage.setItem('modstudio-draft-v0', JSON.stringify(preferences)); } catch {} }
  function setInspectorOpen(open) {
    root.dataset.inspector = open ? 'open' : 'closed';
    $('#inspector-toggle').setAttribute('aria-expanded', String(open));
  }
  function setLayout(value) {
    preferences.layout = ['studio', 'compare'].includes(value) ? value : 'studio';
    root.dataset.layout = preferences.layout; $('#layout-select').value = preferences.layout;
    setInspectorOpen(preferences.layout === 'studio' && innerWidth >= 1100);
    $$('.workspace-switch [data-workspace]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.workspace === preferences.layout)));
    persist();
  }
  function applyPreferences() {
    preferences.theme = ['dark', 'light'].includes(preferences.theme) ? preferences.theme : 'dark';
    preferences.density = ['comfortable', 'compact'].includes(preferences.density) ? preferences.density : 'comfortable';
    root.dataset.theme = preferences.theme; root.dataset.density = preferences.density; root.dataset.grid = String(preferences.grid);
    $('#theme-select').value = preferences.theme; $('#density-select').value = preferences.density; $('#grid-toggle').checked = preferences.grid;
    preferences.provider = preferences.provider === 'RunningHub' ? 'RunningHub' : 'ComfyUI'; $('#provider-select').value = preferences.provider;
    setLayout(preferences.layout); settingsPage.sync({ preferences, service: { ...service, shortcuts }, project: { name: sample.title }, version: '1.1 设计预览', device: '720 × 720 静态 PNG' });
  }
  function setInspector(page) {
    state.inspector = page;
    $$('.inspector-tabs [data-inspector]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.inspector === page)));
    $$('.inspector-page[data-page]').forEach((section) => { section.hidden = section.dataset.page !== page; });
    $('#inspector-scroll').scrollTop = 0;
  }
  function openInspector() { setInspectorOpen(true); }
  function toggleInspector() { setInspectorOpen(root.dataset.inspector !== 'open'); }
  function svgElement(tag, attrs) { const el = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); return el; }
  function renderSceneSelection() {
    const overlay = $('#scene-overlay'); overlay.replaceChildren();
    if (!state.loaded || !state.outline) return;
    for (const draw of currentPose().geometry.filter((d) => state.selected.has(d.region) && !hiddenParts.has(d.region))) {
      const points = draw.vertices;
      if (state.mesh) {
        let path = '';
        for (let i = 0; i < draw.triangles.length; i += 3) { const [a, b, c] = draw.triangles.slice(i, i + 3).map((n) => n * 2); path += 'M' + points[a].toFixed(2) + ',' + points[a + 1].toFixed(2) + 'L' + points[b].toFixed(2) + ',' + points[b + 1].toFixed(2) + 'L' + points[c].toFixed(2) + ',' + points[c + 1].toFixed(2) + 'Z'; }
        overlay.append(svgElement('path', { d: path, class: 'selection-mesh' }));
      }
      const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y;
      overlay.append(svgElement('rect', { x, y, width, height, class: 'selection-box' }));
      for (const [px, py] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) overlay.append(svgElement('rect', { x: px - 2, y: py - 2, width: 4, height: 4, class: 'selection-corner' }));
    }
    $('#scene-state').textContent = state.selected.size ? state.selected.size + ' 个已选部件 · 选区定位' : '拖动平移 · 滚轮缩放';
  }
  function renderAtlas() {
    const primary = primaryPart();
    if (!state.page) state.page = primary?.page || sample.pages[0].name;
    const page = sample.pages.find((p) => p.name === state.page) || sample.pages[0];
    const image = $('#atlas-image'); if (image.dataset.atlasPage !== page.name) { image.src = asset(page.src); image.dataset.atlasPage = page.name; }
    $('#atlas-select').value = page.name; $('#atlas-select').title = page.name;
    $('#atlas-sheet').style.setProperty('--atlas-ratio', String(page.width / page.height));
    $('#atlas-size').textContent = page.width + ' × ' + page.height;
    $('#texture-file').textContent = page.name; $('#texture-size').textContent = page.width + ' × ' + page.height;
    const overlay = $('#atlas-overlay'); overlay.replaceChildren(); overlay.setAttribute('viewBox', '0 0 ' + page.width + ' ' + page.height);
    settingsAPI.grayHiddenRegions(overlay, sample.parts.filter(p => p.page === page.name && hiddenParts.has(p.name)), page, image.src);
    for (const part of sample.parts.filter((p) => state.selected.has(p.name) && p.page === page.name)) overlay.append(svgElement('rect', { x: part.x, y: part.y, width: part.width, height: part.height, class: 'atlas-rect' }));
  }
  function renderLibrary() {
    const list = $('#part-list'); list.replaceChildren(); const names = visibleNames();
    $('#filter-hidden-count').textContent = String(hiddenParts.size);
    const results = state.loaded ? sample.parts.filter((p) => (state.filter === 'all' || state.filter === 'visible' && names.has(p.name) || state.filter === 'selected' && state.selected.has(p.name) || state.filter === 'hidden' && hiddenParts.has(p.name)) && (p.name.toLowerCase().includes(state.search) || category(p.name).includes(state.search))) : [];
    results.sort((a, b) => categoryRank(a.name) - categoryRank(b.name) || Number(/^(A_face|B_face_2)$/.test(b.name)) - Number(/^(A_face|B_face_2)$/.test(a.name)) || a.name.localeCompare(b.name, 'en', { numeric: true }));
    $('#list-caption').textContent = results.length + ' 个部件';
    if (!results.length) { const empty = document.createElement('div'); empty.className = 'no-results'; empty.textContent = !state.loaded ? '打开素材后，部件会出现在这里。' : state.filter === 'hidden' && !hiddenParts.size ? '还没有隐藏的部件。' : state.search ? '没有匹配的部件，试试其他名称。' : '此处还没有部件。'; list.append(empty); return; }
    const fragment = document.createDocumentFragment();
    for (const part of results) {
      const button = document.createElement('button'); button.className = 'part-row'; button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(state.selected.has(part.name))); button.dataset.name = part.name; button.title = part.name;
      button.classList.toggle('is-hidden', hiddenParts.has(part.name));
      const thumbnail = document.createElement('span'); thumbnail.className = 'part-thumbnail';
      const image = document.createElement('img'); image.src = asset(part.thumb); image.alt = ''; image.loading = 'lazy'; thumbnail.append(image);
      const info = document.createElement('span'); info.className = 'part-info'; const name = document.createElement('strong'); name.textContent = part.name; const meta = document.createElement('small'); meta.textContent = category(part.name) + ' · ' + part.width + ' × ' + part.height; info.append(name, meta);
      if (hiddenParts.has(part.name)) meta.textContent = '已隐藏 · ' + part.width + ' × ' + part.height;
      const mark = document.createElement('span'); mark.className = 'selection-mark'; mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true');
      button.append(thumbnail, info, mark); button.addEventListener('click', (event) => selectPart(part.name, event.ctrlKey || event.metaKey));
      button.oncontextmenu = event => { event.preventDefault(); if (!state.selected.has(part.name)) selectPart(part.name); const names = [...state.selected]; partMenu.show(event, $$('.part-row').find(el => el.dataset.name === part.name), { count: names.length, canHide: names.some(n => !hiddenParts.has(n)), canShow: names.some(n => hiddenParts.has(n)), shortcut: shortcuts.hide, onHide: () => changeVisibility(true), onShow: () => changeVisibility(false) }); }; fragment.append(button);
    }
    list.append(fragment);
  }
  function renderProperties() {
    const part = primaryPart(), count = state.selected.size, visible = visibleNames();
    $('#selection-name').textContent = part ? (count > 1 ? '已选 ' + count + ' 个部件' : part.name) : '尚未选择部件';
    $('#selection-kind').textContent = part ? category(part.name) + ' · 图集附件' : '在画布或列表中选择';
    $('#selection-thumb').hidden = !part; if (part) $('#selection-thumb').src = asset(part.thumb);
    $('#selection-note').textContent = !part ? '点击角色或部件缩略图，查看选区信息。' : visible.has(part.name) ? '当前姿态可见 · 画布与图集同步定位' : '当前姿态隐藏 · 仍可查看图集位置';
    if (part && hiddenParts.has(part.name)) $('#selection-note').textContent = '已隐藏 · 导出 MOD 时清除该部件的贴图像素';
    if ($('#hide-parts')) { $('#hide-parts').disabled = !count || [...state.selected].every(n => hiddenParts.has(n)); $('#show-parts').disabled = ![...state.selected].some(n => hiddenParts.has(n)); }
    $('#property-name').textContent = part?.name || '—'; $('#property-position').textContent = part ? part.x + ', ' + part.y : '—'; $('#property-size').textContent = part ? part.width + ' × ' + part.height : '—'; $('#property-rotation').textContent = part ? part.rotation + '°' : '—'; $('#property-page').textContent = part?.page || '—';
    $('#locate-button').disabled = !part; $('#go-ai').disabled = !part;
    $('#filter-selected-count').textContent = String(count); $('#selected-count').textContent = count + ' 个已选部件';
    $('#ai-selection-hint').textContent = part ? (count === 1 ? '当前选区：' + part.name : '当前选区：' + count + ' 个部件') : '先选择需要修改的部件。';
  }
  function selectPart(name, additive = false) {
    if (!state.loaded) return;
    if (additive) { if (state.selected.has(name)) state.selected.delete(name); else state.selected.add(name); } else state.selected = new Set([name]);
    const part = primaryPart(); if (part) state.page = part.page;
    renderLibrary(); renderProperties(); renderSceneSelection(); renderAtlas();
  }
  function clearSelection() { state.selected.clear(); renderLibrary(); renderProperties(); renderSceneSelection(); renderAtlas(); }
  function setView(view) { root.dataset.view = view; $$('.segmented [data-view]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.view === view))); }
  function setZoom(value) { if (!Number.isFinite(value)) return; state.zoom = Math.max(.4, value); $('#artwork').style.setProperty('--zoom', state.zoom); $('#zoom-value').textContent = Math.round(state.zoom * 100) + '%'; }
  function fit() { state.panX = 0; state.panY = 0; $('#artwork').style.setProperty('--pan-x', '0px'); $('#artwork').style.setProperty('--pan-y', '0px'); setZoom(1); }
  function updateTime() { const duration = currentPose().duration * 1000; $('#timeline-range').max = String(duration); $('#timeline-range').value = String(state.time); $('#timeline-range').style.setProperty('--progress', state.time / duration * 100 + '%'); $('#time-current').textContent = timeLabel(state.time); $('#time-total').textContent = timeLabel(duration); }
  function pause() { state.playing = false; cancelAnimationFrame(frameRequest); $('#play-button').textContent = '▶'; $('#play-button').setAttribute('aria-pressed', 'false'); $('#play-button').setAttribute('aria-label', '演示播放控制条'); }
  function tick(timestamp) { if (!state.playing) return; if (state.lastTime) state.time = (state.time + (timestamp - state.lastTime) * state.speed) % (currentPose().duration * 1000); state.lastTime = timestamp; updateTime(); frameRequest = requestAnimationFrame(tick); }
  function togglePlaying() { if (!state.loaded) return; if (state.playing) return pause(); state.playing = true; state.lastTime = 0; $('#play-button').textContent = 'Ⅱ'; $('#play-button').setAttribute('aria-pressed', 'true'); $('#play-button').setAttribute('aria-label', '暂停控制条演示'); toast('播放控件演示中，角色目前为静态姿态。'); frameRequest = requestAnimationFrame(tick); }
  function setPose(id) { pause(); state.animation = id; state.time = 0; $('#scene-image').src = asset(currentPose().src); $('#animation-select').value = id; fit(); updateTime(); renderLibrary(); renderProperties(); renderSceneSelection(); }
  function modal(title, eyebrow, content, actions) {
    $('#dialog-title').textContent = title; $('#dialog-eyebrow').textContent = eyebrow; $('#dialog-content').innerHTML = content; const footer = $('#dialog-actions'); footer.replaceChildren();
    for (const { label, action, primary = false, disabled = false } of actions) { const button = document.createElement('button'); button.className = 'button' + (primary ? ' primary' : ''); button.textContent = label; button.disabled = disabled; button.addEventListener('click', action); footer.append(button); }
    $('#action-dialog').showModal();
  }
  const closeModal = () => $('#action-dialog').close();
  function loadSample() {
    closeModal(); pause(); $('#loading-mask').hidden = false; $('#canvas-empty').hidden = true;
    setTimeout(() => { state.loaded = true; state.selected = new Set(['B_face_2']); state.page = primaryPart()?.page || sample.pages[0].name; $('#artwork').hidden = false; $('#atlas-sheet').hidden = false; $('#status-message').textContent = '真实本地素材 · 界面草案'; setPose(sample.animations[0].id); renderAtlas(); $('#loading-mask').hidden = true; toast('已载入真实示例素材。原始文件保持只读。'); }, 550);
  }
  function clearCanvas() { closeModal(); pause(); state.loaded = false; state.selected.clear(); $('#artwork').hidden = true; $('#atlas-sheet').hidden = true; $('#canvas-empty').hidden = false; $('#status-message').textContent = '空白工作区 · 界面草案'; setView('scene'); if (preferences.layout === 'compare') setLayout('studio'); renderLibrary(); renderProperties(); renderSceneSelection(); }
  function openAction(action) {
    if (action === 'undo') return undoVisibility();
    if (action === 'load-sample') return loadSample();
    if (action === 'open') return modal('打开创作素材', 'OPEN WORKSPACE', '<p>从完整 MOD 素材目录开始，进入角色与图集编辑。</p><div class="dialog-options"><button class="choice-button" id="load-example"><strong>Blade 小公主 · 技能战损</strong><small>真实本地示例 · 11 个文件 · 6 张图集</small></button><button class="choice-button" disabled><strong>选择本机 MOD 文件夹</strong><small>Electron 桌面版接入后启用</small></button></div><p class="dialog-info">当前是 HTML 界面草案，可体验示例的部件选择与布局，不会修改你的 MOD。</p>', [{ label: '取消', action: closeModal }]);
    if (action === 'export') return modal('导出制作结果', 'EXPORT', '<p>在确认角色外观后，选择需要的交付格式。</p><div class="dialog-options"><button class="choice-button" disabled><strong>PNG 贴图</strong><small>导出修改过的图集页，保留透明通道</small></button><button class="choice-button" disabled><strong>MOD 压缩包</strong><small>检查素材结构并打包完整制作结果</small></button></div><p class="dialog-info">草案仅展示导出入口。文件保存与打包尚未接入。</p>', [{ label: '返回工作台', action: closeModal }]);
    if (action === 'connection') return settingsPage.show('ai');
    if (action === 'settings') return settingsPage.show();
  }
  function pickRegion(event) {
    const rect = $('#artwork').getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width * 720, y = (event.clientY - rect.top) / rect.height * 720;
    if (x < 0 || y < 0 || x > 720 || y > 720) return;
    for (const draw of [...currentPose().geometry].reverse()) {
      const v = draw.vertices, triangles = draw.triangles;
      for (let i = 0; i < triangles.length; i += 3) {
        const a = triangles[i] * 2, b = triangles[i + 1] * 2, c = triangles[i + 2] * 2;
        const denominator = (v[b + 1] - v[c + 1]) * (v[a] - v[c]) + (v[c] - v[b]) * (v[a + 1] - v[c + 1]); if (Math.abs(denominator) < .00001) continue;
        const u = ((v[b + 1] - v[c + 1]) * (x - v[c]) + (v[c] - v[b]) * (y - v[c + 1])) / denominator;
        const w = ((v[c + 1] - v[a + 1]) * (x - v[c]) + (v[a] - v[c]) * (y - v[c + 1])) / denominator;
        if (u >= 0 && w >= 0 && u + w <= 1 && sample.parts.some((p) => p.name === draw.region)) { selectPart(draw.region, event.ctrlKey || event.metaKey); return; }
      }
    }
  }

  // Populate only measured metadata and real local reference imagery.
  $('#part-count').textContent = String(sample.parts.length); $('#texture-page-count').textContent = String(sample.pages.length);
  $('#asset-title').textContent = sample.title; $('#spine-version').textContent = 'Spine ' + sample.spineVersion;
  $('#file-summary').textContent = sample.sourceFileCount + ' 个文件 · ' + (sample.sourceBytes / 1048576).toFixed(1) + ' MiB';
  for (const pose of sample.animations) { const option = document.createElement('option'); option.value = pose.id; option.textContent = pose.id; $('#animation-select').append(option); }
  for (const page of sample.pages) { const option = document.createElement('option'); option.value = page.name; option.textContent = page.name; $('#atlas-select').append(option); }
  $('#animation-select').addEventListener('change', (event) => setPose(event.target.value));
  $('#atlas-select').addEventListener('change', (event) => { state.page = event.target.value; renderAtlas(); });
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('[data-filter]').forEach((b) => b.setAttribute('aria-selected', String(b === button))); renderLibrary(); }));
  $('#part-search').addEventListener('input', (event) => { state.search = event.target.value.trim().toLowerCase(); renderLibrary(); });
  $('#clear-selection').addEventListener('click', clearSelection);
  $$('.segmented [data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('.inspector-tabs [data-inspector]').forEach((button) => button.addEventListener('click', () => setInspector(button.dataset.inspector)));
  $('#inspector-toggle').addEventListener('click', toggleInspector); $('#inspector-close').addEventListener('click', () => setInspectorOpen(false));
  $('#go-ai').addEventListener('click', () => { openInspector(); setInspector('ai'); });
  $('#show-atlas').addEventListener('click', () => setView('atlas'));
  $('#locate-button').addEventListener('click', () => { setView('scene'); fit(); renderSceneSelection(); if (primaryPart() && !visibleNames().has(primaryPart().name)) toast('该部件在当前姿态隐藏，可以在图集中查看。'); });
  $('#mesh-toggle').addEventListener('click', () => { state.mesh = !state.mesh; $('#mesh-toggle').setAttribute('aria-pressed', String(state.mesh)); renderSceneSelection(); });
  $('#selection-toggle').addEventListener('change', (event) => { state.outline = event.target.checked; renderSceneSelection(); });
  $('#zoom-out').addEventListener('click', () => setZoom(state.zoom - .1)); $('#zoom-in').addEventListener('click', () => setZoom(state.zoom + .1)); $('#zoom-value').addEventListener('click', fit); $('#fit-button').addEventListener('click', fit);
  $$('.workspace-switch [data-workspace]').forEach((button) => button.addEventListener('click', () => setLayout(button.dataset.workspace)));
  $('#play-button').addEventListener('click', togglePlaying); $('#step-back').addEventListener('click', () => { pause(); state.time = 0; updateTime(); }); $('#step-forward').addEventListener('click', () => { pause(); state.time = Math.min(currentPose().duration * 1000, state.time + 1000 / 12); updateTime(); });
  $('#timeline-range').addEventListener('input', (event) => { pause(); state.time = Number(event.target.value); updateTime(); }); $('#speed-select').addEventListener('change', (event) => { state.speed = Number(event.target.value); });
  $('#scene-viewport').addEventListener('wheel', (event) => { if (!state.loaded) return; event.preventDefault(); setZoom(state.zoom + (event.deltaY < 0 ? .05 : -.05)); }, { passive: false });
  $('#scene-viewport').addEventListener('pointerdown', (event) => { if (event.button !== 0 || !state.loaded || event.target.closest('button')) return; drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: state.panX, startY: state.panY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); });
  $('#scene-viewport').addEventListener('pointermove', (event) => { if (!drag || drag.id !== event.pointerId) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { state.panX = drag.startX + dx; state.panY = drag.startY + dy; $('#artwork').style.setProperty('--pan-x', state.panX + 'px'); $('#artwork').style.setProperty('--pan-y', state.panY + 'px'); } });
  $('#scene-viewport').addEventListener('pointerup', (event) => { if (!drag) return; if (!drag.moved) pickRegion(event); drag = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); });
  $('#scene-viewport').addEventListener('pointercancel', () => { drag = null; });
  $('#scene-viewport').addEventListener('dblclick', fit);
  $('#provider-select').addEventListener('change', event => { preferences.provider = event.target.value; persist(); settingsPage.sync({ preferences }); });
  $('#prompt-input').addEventListener('input', (event) => { $('#prompt-count').textContent = String(event.target.value.length); });
  $('#strength-input').addEventListener('input', (event) => { $('#strength-value').textContent = Number(event.target.value).toFixed(2); event.target.style.setProperty('--progress', Number(event.target.value) * 100 + '%'); }); $('#strength-input').style.setProperty('--progress', '40%');
  $$('[data-action]').forEach((button) => button.addEventListener('click', () => { openAction(button.dataset.action); const load = $('#load-example'), clear = $('#clear-canvas'); if (load) load.addEventListener('click', loadSample); if (clear) clear.addEventListener('click', clearCanvas); }));
  $('#dialog-close').addEventListener('click', closeModal); $('#action-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || settingsPage.open || document.activeElement?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || $('#action-dialog').open) return;
    const action = settingsAPI.actionForEvent(event, shortcuts); if (!action) return; event.preventDefault();
    if (action === 'hide') changeVisibility(true); else if (action === 'undo' || action === 'redo') undoVisibility(action === 'redo'); else if (action === 'play') togglePlaying(); else if (action === 'switchWorkspace') setLayout(preferences.layout === 'compare' ? 'studio' : 'compare'); else if (action === 'fit') fit(); else if (action === 'search') $('#part-search').focus(); else if (action === 'open') openAction('open'); else if (action === 'export') openAction('export'); else toast('该项目操作请在桌面版中使用。');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  let wasWide = innerWidth >= 1100; addEventListener('resize', () => { const isWide = innerWidth >= 1100; if (wasWide && !isWide) setInspectorOpen(false); wasWide = isWide; });
  $('#scene-image').addEventListener('error', () => toast('姿态图片缺失，请保留完整 assets 文件夹。'));
  if ($('#hide-parts')) { $('#hide-parts').onclick = () => changeVisibility(true); $('#show-parts').onclick = () => changeVisibility(false); }
  applyPreferences(); setShortcutHints(); setView('scene'); setPose(state.animation); state.page = primaryPart()?.page || sample.pages[0].name; renderAtlas();
  // Public read-only diagnostics for checking a standalone local draft.
  window.ModStudioDraft = Object.freeze({ version: 'v0', getState: () => ({ layout: preferences.layout, theme: preferences.theme, selected: [...state.selected], hiddenParts: [...hiddenParts], loaded: state.loaded, view: root.dataset.view, inspector: state.inspector, playing: state.playing, zoom: state.zoom, backendConnected: false }) });
})();
