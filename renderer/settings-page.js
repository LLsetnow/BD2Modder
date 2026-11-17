import { ACTIONS, DEFAULT_SHORTCUTS, formatShortcut, validateShortcuts, shortcutFromEvent } from '../app/keybindings.cjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const categories = [
  ['general', '常规', '界面、工作区与画布外观。'],
  ['shortcuts', '快捷键', '为常用操作设置顺手的按键。'],
  ['ai', 'AI 绘图', '管理绘图服务和重绘工作流。'],
  ['project', '项目与文件', '项目配置、保存与文件位置。'],
  ['about', '关于', '应用版本与渲染环境。']
];
export class SettingsPage {
  constructor(options) {
    this.options = options; this.element = document.querySelector('#settings-page'); this.category = 'general'; this.shortcuts = { ...DEFAULT_SHORTCUTS }; this.serviceDirty = false;
    this.element.innerHTML = `
      <div class="settings-shell">
        <div class="settings-heading"><div><span class="eyebrow">PREFERENCES</span><h1>设置</h1></div><button type="button" class="button subtle" id="settings-back">← 返回工作台</button></div>
        <div class="settings-body">
          <nav class="settings-navigation" aria-label="设置分类" role="tablist" aria-orientation="vertical">${categories.map(([id, name], index) => `<button type="button" role="tab" id="settings-tab-${id}" data-settings-tab="${id}" aria-controls="settings-pane-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${name}<span aria-hidden="true">›</span></button>`).join('')}</nav>
          <div class="settings-content">
            <div class="settings-section-heading"><h2 id="settings-section-title">常规</h2><p id="settings-section-description">${categories[0][2]}</p></div>
            <section id="settings-pane-general" data-settings-pane="general" role="tabpanel" aria-labelledby="settings-tab-general">
              <div class="settings-card"><h3>外观</h3>
                <label class="settings-row" for="theme-select"><span><strong>界面主题</strong><small>选择适合当前光线的界面。</small></span><select class="field-select" id="theme-select"><option value="dark">石墨 · Graphite</option><option value="light">暖白 · Paper</option></select></label>
                <label class="settings-row" for="density-select"><span><strong>信息密度</strong><small>调整部件列表的间距。</small></span><select class="field-select" id="density-select"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
              </div>
              <div class="settings-card"><h3>工作区与画布</h3>
                <label class="settings-row" for="layout-select"><span><strong>工作区布局</strong><small>工作台右上角也可随时切换。</small></span><select class="field-select" id="layout-select"><option value="studio">标准</option><option value="compare">图集对照</option></select></label>
                <label class="settings-row toggle-row" for="grid-toggle"><span><strong>画布网点</strong><small>在画布背景显示定位网点。</small></span><input type="checkbox" id="grid-toggle"><span class="switch" aria-hidden="true"></span></label>
              </div>
              <div class="settings-section-footer"><span>外观调整即时生效，并自动保存。</span><button type="button" class="text-button" id="reset-preferences">恢复默认外观</button></div>
            </section>
            <section id="settings-pane-shortcuts" data-settings-pane="shortcuts" role="tabpanel" aria-labelledby="settings-tab-shortcuts" hidden>
              <div class="settings-card shortcut-settings"><h3>按键分配</h3><p class="settings-card-intro">点击快捷键后按下新组合。按 Esc 取消；文本编辑的常用按键会保留。</p>${ACTIONS.map(action => `<div class="settings-row"><span><strong>${action.name}</strong><small>${action.group}</small></span><button type="button" class="shortcut-binding" data-shortcut="${action.id}" aria-label="修改${action.name}快捷键">${escape(action.default)}</button></div>`).join('')}</div>
              <div class="settings-section-footer"><span id="shortcut-feedback" role="status">修改后自动保存。</span><button type="button" class="text-button" id="reset-shortcuts">恢复默认快捷键</button></div>
            </section>
            <section id="settings-pane-ai" data-settings-pane="ai" role="tabpanel" aria-labelledby="settings-tab-ai" hidden>
              <div class="settings-card"><h3>绘图服务</h3>
                <label class="settings-row" for="settings-provider"><span><strong>默认服务</strong><small>用于检查器中的局部重绘。</small></span><select class="field-select" id="settings-provider"><option value="ComfyUI">ComfyUI</option><option value="RunningHub">RunningHub</option></select></label>
                <div class="settings-form"><label class="field-label" for="settings-comfy-address">ComfyUI 地址</label><input class="settings-input" id="settings-comfy-address" type="url" spellcheck="false" autocomplete="off"><label class="field-label" for="settings-cloud-address">RunningHub 地址</label><input class="settings-input" id="settings-cloud-address" type="url" spellcheck="false" autocomplete="off"><label class="field-label" for="settings-cloud-key">RunningHub API Key</label><input class="settings-input" id="settings-cloud-key" type="password" autocomplete="off"><label class="dialog-check"><input id="settings-clear-key" type="checkbox">清除已保存的 Key</label><p class="help-text" id="settings-key-note">密钥通过系统加密保存，不会写入 MOD 或导出包。</p><div class="settings-actions"><button type="button" class="button" id="settings-save-service">保存连接</button><button type="button" class="button primary" id="settings-test-service">保存并测试连接</button></div><p class="settings-feedback" id="settings-service-feedback" role="status"></p></div>
              </div>
              <div class="settings-card"><h3>重绘工作流</h3><div class="settings-row"><span><strong id="settings-workflow-name">尚未配置工作流</strong><small>导入 API 工作流，设置图集、遮罩和提示词映射。</small></span><button type="button" class="button" id="settings-workflow">导入 / 配置</button></div></div>
            </section>
            <section id="settings-pane-project" data-settings-pane="project" role="tabpanel" aria-labelledby="settings-tab-project" hidden>
              <div class="settings-card"><h3>当前项目</h3><div class="settings-project-summary"><strong id="settings-project-name">未打开 MOD</strong><p id="settings-project-path">打开 MOD 后可管理配置和文件。</p></div>
                <div class="settings-row"><span><strong>MOD 配置</strong><small>编辑原始 .modfile，保留未识别的字段。</small></span><button type="button" class="button" data-project-setting="metadata">编辑配置</button></div>
                <div class="settings-row"><span><strong>项目文件夹</strong><small>在${this.options.isMac ? '访达' : '资源管理器'}中查看素材。</small></span><button type="button" class="button" data-project-setting="reveal">打开位置</button></div>
                <div class="settings-row"><span><strong>另存为副本</strong><small>创建包含当前修改的完整 MOD 文件夹。</small></span><button type="button" class="button" data-project-setting="saveAs">另存为</button></div>
                <div class="settings-row"><span><strong>重做修改</strong><small>重新应用刚刚撤销的编辑。</small></span><button type="button" class="button" data-project-setting="redo">重做</button></div>
              </div><p class="help-text">保存到原目录前会检查外部修改，并自动备份原文件。</p>
            </section>
            <section id="settings-pane-about" data-settings-pane="about" role="tabpanel" aria-labelledby="settings-tab-about" hidden>
              <div class="settings-card"><h3>BD Modder</h3><p class="settings-card-intro">Brown Dust MOD 图集编辑与 Spine 动画预览。</p><dl class="settings-about"><div><dt>应用版本</dt><dd id="settings-version">—</dd></div><div><dt>运行模式</dt><dd id="settings-runtime">Electron 桌面版</dd></div><div><dt>骨骼支持</dt><dd>Spine 4.1</dd></div><div><dt>渲染环境</dt><dd id="settings-device">打开 MOD 后显示</dd></div></dl></div>
            </section>
          </div>
        </div>
      </div>`;
    this.element.querySelector('#settings-back').onclick = () => this.hide();
    this.tabs = [...this.element.querySelectorAll('[data-settings-tab]')];
    this.tabs.forEach(button => { button.onclick = () => this.select(button.dataset.settingsTab); button.onkeydown = event => { if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const current = this.tabs.indexOf(button), index = event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + this.tabs.length) % this.tabs.length; this.select(this.tabs[index].dataset.settingsTab); this.tabs[index].focus(); }; });
    for (const [id, key] of [['theme-select', 'theme'], ['density-select', 'density'], ['layout-select', 'layout'], ['grid-toggle', 'grid'], ['settings-provider', 'provider']]) this.element.querySelector('#' + id).onchange = event => this.options.onPreference(key, key === 'grid' ? event.target.checked : event.target.value);
    this.element.querySelector('#reset-preferences').onclick = () => this.options.onResetPreferences();
    this.element.querySelectorAll('[data-shortcut]').forEach(button => button.onclick = () => this.capture(button.dataset.shortcut));
    this.element.querySelector('#reset-shortcuts').onclick = () => this.run(async () => this.setShortcuts(await this.options.onShortcuts({ ...DEFAULT_SHORTCUTS })), '#shortcut-feedback');
    this.element.querySelectorAll('.settings-form input').forEach(input => input.addEventListener('input', () => { this.serviceDirty = true; this.feedback('#settings-service-feedback', '连接有未保存的更改。'); }));
    this.element.querySelector('#settings-save-service').onclick = () => this.saveService(false);
    this.element.querySelector('#settings-test-service').onclick = () => this.saveService(true);
    this.element.querySelector('#settings-workflow').onclick = () => this.options.onWorkflow();
    this.element.querySelectorAll('[data-project-setting]').forEach(button => button.onclick = () => this.options.onProjectAction(button.dataset.projectSetting));
    document.addEventListener('keydown', event => this.keydown(event), true);
    this.setShortcuts(this.shortcuts);
    if (!this.options.native) { this.element.querySelector('#settings-cloud-key').disabled = true; this.element.querySelector('#settings-cloud-key').placeholder = '请在桌面版中设置密钥'; this.element.querySelector('#settings-clear-key').disabled = true; this.element.querySelector('#settings-test-service').disabled = true; this.element.querySelector('#settings-save-service').textContent = '保存预览设置'; this.element.querySelector('#settings-key-note').textContent = '当前为浏览器设计预览。实际服务和密钥请在桌面版中设置。'; }
  }
  get open() { return !this.element.hidden; }
  async show(category = this.category) {
    this.select(category); this.options.onPause?.(); await this.options.onVisibility?.(true); this.element.hidden = false; document.documentElement.dataset.screen = 'settings'; document.querySelector('#settings-open')?.setAttribute('aria-expanded', 'true'); this.tabs.find(button => button.dataset.settingsTab === this.category)?.focus();
  }
  async hide() {
    this.cancelCapture(); await this.options.onVisibility?.(false); this.element.hidden = true; delete document.documentElement.dataset.screen; document.querySelector('#settings-open')?.setAttribute('aria-expanded', 'false'); document.querySelector('#settings-open')?.focus(); this.options.onResume?.();
  }
  select(category) {
    const match = categories.find(c => c[0] === category) || categories[0]; this.category = match[0]; this.cancelCapture();
    this.tabs.forEach(button => { const active = button.dataset.settingsTab === this.category; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    this.element.querySelectorAll('[data-settings-pane]').forEach(pane => pane.hidden = pane.dataset.settingsPane !== this.category);
    this.element.querySelector('#settings-section-title').textContent = match[1]; this.element.querySelector('#settings-section-description').textContent = match[2]; this.element.querySelector('.settings-content').scrollTop = 0;
  }
  sync({ preferences, service, project, version, device }) {
    if (preferences) { for (const [id, key] of [['theme-select', 'theme'], ['density-select', 'density'], ['layout-select', 'layout'], ['settings-provider', 'provider']]) this.element.querySelector('#' + id).value = preferences[key] || (key === 'provider' ? 'ComfyUI' : ''); this.element.querySelector('#grid-toggle').checked = Boolean(preferences.grid); }
    if (service) {
      this.service = service; if (service.shortcuts) this.setShortcuts(service.shortcuts);
      if (!this.serviceDirty) { this.element.querySelector('#settings-comfy-address').value = service.address || 'http://127.0.0.1:8188/'; this.element.querySelector('#settings-cloud-address').value = service.cloudAddress || 'https://www.runninghub.cn/'; this.element.querySelector('#settings-cloud-key').value = ''; this.element.querySelector('#settings-clear-key').checked = false; if (this.options.native) this.element.querySelector('#settings-cloud-key').placeholder = service.hasKey ? '已加密保存，留空保留' : '填写 API Key'; }
      this.element.querySelector('#settings-workflow-name').textContent = service.profile?.name || '尚未配置工作流';
    }
    if (project !== undefined) {
      this.element.querySelector('#settings-project-name').textContent = project?.name || '未打开 MOD'; this.element.querySelector('#settings-project-path').textContent = project?.root || '打开 MOD 后可管理配置和文件。';
      this.element.querySelectorAll('[data-project-setting]').forEach(button => button.disabled = !project || !this.options.native || (button.dataset.projectSetting === 'redo' && !project.redo));
    }
    this.element.querySelector('#settings-version').textContent = version || '1.0'; this.element.querySelector('#settings-runtime').textContent = this.options.native ? 'Electron 桌面版' : 'HTML 设计预览'; if (device) this.element.querySelector('#settings-device').textContent = device;
  }
  setShortcuts(value) { this.shortcuts = validateShortcuts(value, this.options.isMac); this.element.querySelectorAll('[data-shortcut]').forEach(button => { button.textContent = formatShortcut(this.shortcuts[button.dataset.shortcut], this.options.isMac); button.dataset.recording = 'false'; button.setAttribute('aria-pressed', 'false'); }); }
  capture(id) { this.cancelCapture(); this.recording = id; const button = this.element.querySelector(`[data-shortcut="${id}"]`); button.textContent = '按下组合键…'; button.dataset.recording = 'true'; button.setAttribute('aria-pressed', 'true'); this.feedback('#shortcut-feedback', '按下新的快捷键，或按 Esc 取消。'); }
  cancelCapture() { if (!this.recording) return; const old = this.recording; this.recording = null; const button = this.element.querySelector(`[data-shortcut="${old}"]`); button.textContent = formatShortcut(this.shortcuts[old], this.options.isMac); button.dataset.recording = 'false'; button.setAttribute('aria-pressed', 'false'); }
  keydown(event) {
    if (!this.open) return;
    if (this.recording) {
      event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'Escape') { this.cancelCapture(); this.feedback('#shortcut-feedback', '已取消修改。'); return; }
      const shortcut = shortcutFromEvent(event, this.options.isMac); if (!shortcut) return; const id = this.recording; this.cancelCapture();
      this.run(async () => { const next = validateShortcuts({ ...this.shortcuts, [id]: shortcut }, this.options.isMac); this.setShortcuts(await this.options.onShortcuts(next)); this.feedback('#shortcut-feedback', '快捷键已保存。'); }, '#shortcut-feedback');
    } else if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); event.stopPropagation(); this.hide(); }
  }
  feedback(selector, message, error = false) { const target = this.element.querySelector(selector); target.textContent = message; target.dataset.error = String(error); }
  async run(fn, selector) { try { return await fn(); } catch (error) { this.feedback(selector, error.message, true); return null; } }
  async saveService(test) {
    const buttons = ['#settings-save-service', '#settings-test-service'].map(id => this.element.querySelector(id)); buttons.forEach(button => button.disabled = true);
    try {
      const patch = { address: this.element.querySelector('#settings-comfy-address').value, cloudAddress: this.element.querySelector('#settings-cloud-address').value, apiKey: this.element.querySelector('#settings-cloud-key').value, clearKey: this.element.querySelector('#settings-clear-key').checked };
      const result = await this.options.onSaveService(patch); this.serviceDirty = false; this.sync({ service: result }); this.feedback('#settings-service-feedback', test ? '正在测试连接…' : '连接配置已保存。');
      if (test) this.feedback('#settings-service-feedback', await this.options.onTestService(this.element.querySelector('#settings-provider').value));
    } catch (error) { this.feedback('#settings-service-feedback', error.message, true); }
    finally { buttons.forEach(button => button.disabled = !this.options.native && button.id === 'settings-test-service'); }
  }
}
