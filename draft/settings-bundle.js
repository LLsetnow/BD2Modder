(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // app/keybindings.cjs
  var require_keybindings = __commonJS({
    "app/keybindings.cjs"(exports, module) {
      "use strict";
      var ACTIONS2 = Object.freeze([
        { id: "open", name: "\u6253\u5F00 MOD", group: "\u9879\u76EE\u64CD\u4F5C", default: "Ctrl+O", native: true },
        { id: "save", name: "\u4FDD\u5B58\u4FEE\u6539", group: "\u9879\u76EE\u64CD\u4F5C", default: "Ctrl+S", native: true },
        { id: "saveAs", name: "\u53E6\u5B58\u4E3A", group: "\u9879\u76EE\u64CD\u4F5C", default: "Ctrl+Shift+S", native: true },
        { id: "export", name: "\u5BFC\u51FA", group: "\u9879\u76EE\u64CD\u4F5C", default: "Ctrl+E", native: true },
        { id: "undo", name: "\u64A4\u9500\u4FEE\u6539", group: "\u7F16\u8F91\u64CD\u4F5C", default: "Ctrl+Z", native: true },
        { id: "redo", name: "\u91CD\u505A\u4FEE\u6539", group: "\u7F16\u8F91\u64CD\u4F5C", default: "Ctrl+Shift+Z", native: true },
        { id: "hide", name: "\u9690\u85CF\u9009\u4E2D\u90E8\u4EF6", group: "\u7F16\u8F91\u64CD\u4F5C", default: "H" },
        { id: "clearSelection", name: "\u6E05\u7A7A\u9009\u62E9", group: "\u7F16\u8F91\u64CD\u4F5C", default: "Ctrl+D" },
        { id: "play", name: "\u64AD\u653E / \u6682\u505C", group: "\u753B\u5E03\u64CD\u4F5C", default: "Space" },
        { id: "switchWorkspace", name: "\u6807\u51C6 / \u56FE\u96C6\u5BF9\u7167", group: "\u753B\u5E03\u64CD\u4F5C", default: "F" },
        { id: "fit", name: "\u9002\u5E94\u5F53\u524D\u753B\u5E03", group: "\u753B\u5E03\u64CD\u4F5C", default: "0" },
        { id: "search", name: "\u641C\u7D22\u90E8\u4EF6", group: "\u753B\u5E03\u64CD\u4F5C", default: "/" }
      ]);
      var DEFAULT_SHORTCUTS3 = Object.freeze(Object.fromEntries(ACTIONS2.map((action) => [action.id, action.default])));
      var RESERVED = /* @__PURE__ */ new Set(["Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+A", "Ctrl+=", "Ctrl+Shift+=", "Ctrl+-", "Ctrl+0", "F11", "Alt+F4", "Alt+Tab", "Ctrl+Alt+Delete"]);
      var MAC_RESERVED = /* @__PURE__ */ new Set(["Ctrl+Q", "Ctrl+H", "Ctrl+Alt+H", "Ctrl+M", "Ctrl+W", "Ctrl+Space"]);
      function formatShortcut2(shortcut, isMac) {
        if (shortcut === "") return "\u672A\u8BBE\u7F6E";
        return isMac ? shortcut.replace(/^Ctrl\+/, "\u2318+") : shortcut;
      }
      function normalizeShortcut(value, isMac = false) {
        if (typeof value !== "string" || value.length > 50) throw Error("\u5FEB\u6377\u952E\u683C\u5F0F\u65E0\u6548\u3002");
        const parts = value.split("+"), key = parts.pop(), mods = new Set(parts);
        if (mods.size !== parts.length || parts.some((p) => !["Ctrl", "Alt", "Shift"].includes(p)) || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|[\/\[\]\\;\-',.`=])$/.test(key || "")) throw Error("\u8BF7\u4F7F\u7528\u5B57\u6BCD\u3001\u6570\u5B57\u3001F1\u2013F12\u3001\u7A7A\u683C\u6216\u5E38\u7528\u7B26\u53F7\uFF0C\u53EF\u642D\u914D Ctrl / Alt / Shift\u3002");
        const normalized = ["Ctrl", "Alt", "Shift"].filter((m) => mods.has(m)).concat(key).join("+");
        if (RESERVED.has(normalized) || isMac && MAC_RESERVED.has(normalized)) throw Error("\u8BE5\u7EC4\u5408\u7531\u7CFB\u7EDF\u6216\u6587\u672C\u7F16\u8F91\u4F7F\u7528\uFF0C\u8BF7\u6362\u4E00\u4E2A\u5FEB\u6377\u952E\u3002");
        return normalized;
      }
      function validateShortcuts3(input = {}, isMac = false) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("\u5FEB\u6377\u952E\u914D\u7F6E\u65E0\u6548\u3002");
        const output = {}, occupied = /* @__PURE__ */ new Map();
        const clearDefaultInUse = input.clearSelection == null && ACTIONS2.some((action) => input[action.id] === DEFAULT_SHORTCUTS3.clearSelection);
        for (const action of ACTIONS2) {
          if (action.id === "clearSelection" && (input.clearSelection === "" || clearDefaultInUse)) {
            output.clearSelection = "";
            continue;
          }
          const key = normalizeShortcut(input[action.id] ?? action.default, isMac);
          if (action.native && !key.includes("+") && !/^F\d+$/.test(key)) throw Error("\u9879\u76EE\u548C\u7F16\u8F91\u64CD\u4F5C\u8BF7\u4F7F\u7528\u7EC4\u5408\u952E\u6216 F1\u2013F12\uFF0C\u907F\u514D\u5F71\u54CD\u6587\u5B57\u8F93\u5165\u3002");
          if (occupied.has(key)) throw Error(`\u5FEB\u6377\u952E ${formatShortcut2(key, isMac)} \u5DF2\u7528\u4E8E\u201C${occupied.get(key)}\u201D\u3002`);
          output[action.id] = key;
          occupied.set(key, action.name);
        }
        return output;
      }
      function shortcutFromEvent2(event, isMac = false) {
        if (event.isComposing || (isMac ? event.ctrlKey : event.metaKey) || ["Control", "Alt", "Shift", "Meta", "Escape", "Tab", "Enter", "Backspace", "Delete"].includes(event.key)) return null;
        const punctuation = { Space: "Space", Slash: "/", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Minus: "-", Equal: "=", Comma: ",", Period: ".", Backquote: "`" };
        const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : punctuation[event.code] || (/^F(?:[1-9]|1[0-2])$/.test(event.key) ? event.key : null);
        if (!key) return null;
        return [(isMac ? event.metaKey : event.ctrlKey) && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
      }
      function actionForEvent2(event, shortcuts, isMac) {
        const key = shortcutFromEvent2(event, isMac);
        return key ? ACTIONS2.find((action) => shortcuts[action.id] === key)?.id || null : null;
      }
      module.exports = { ACTIONS: ACTIONS2, DEFAULT_SHORTCUTS: DEFAULT_SHORTCUTS3, formatShortcut: formatShortcut2, normalizeShortcut, validateShortcuts: validateShortcuts3, shortcutFromEvent: shortcutFromEvent2, actionForEvent: actionForEvent2 };
    }
  });

  // renderer/settings-page.js
  var import_keybindings = __toESM(require_keybindings());
  var escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var categories = [
    ["general", "\u5E38\u89C4", "\u754C\u9762\u3001\u5DE5\u4F5C\u533A\u4E0E\u753B\u5E03\u5916\u89C2\u3002"],
    ["shortcuts", "\u5FEB\u6377\u952E", "\u4E3A\u5E38\u7528\u64CD\u4F5C\u8BBE\u7F6E\u987A\u624B\u7684\u6309\u952E\u3002"],
    ["ai", "AI \u7ED8\u56FE", "\u7BA1\u7406\u7ED8\u56FE\u670D\u52A1\u548C\u91CD\u7ED8\u5DE5\u4F5C\u6D41\u3002"],
    ["project", "\u9879\u76EE\u4E0E\u6587\u4EF6", "\u9879\u76EE\u914D\u7F6E\u3001\u4FDD\u5B58\u4E0E\u6587\u4EF6\u4F4D\u7F6E\u3002"],
    ["about", "\u5173\u4E8E", "\u5E94\u7528\u7248\u672C\u4E0E\u6E32\u67D3\u73AF\u5883\u3002"]
  ];
  var SettingsPage = class {
    constructor(options) {
      this.options = options;
      this.element = document.querySelector("#settings-page");
      this.category = "general";
      this.shortcuts = { ...import_keybindings.DEFAULT_SHORTCUTS };
      this.serviceDirty = false;
      this.serviceBusy = false;
      this.element.innerHTML = `
      <div class="settings-shell">
        <div class="settings-heading"><div><span class="eyebrow">PREFERENCES</span><h1>\u8BBE\u7F6E</h1></div><button type="button" class="button subtle" id="settings-back">\u2190 \u8FD4\u56DE\u5DE5\u4F5C\u53F0</button></div>
        <div class="settings-body">
          <nav class="settings-navigation" aria-label="\u8BBE\u7F6E\u5206\u7C7B" role="tablist" aria-orientation="vertical">${categories.map(([id, name], index) => `<button type="button" role="tab" id="settings-tab-${id}" data-settings-tab="${id}" aria-controls="settings-pane-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${name}<span aria-hidden="true">\u203A</span></button>`).join("")}</nav>
          <div class="settings-content">
            <div class="settings-section-heading"><h2 id="settings-section-title">\u5E38\u89C4</h2><p id="settings-section-description">${categories[0][2]}</p></div>
            <section id="settings-pane-general" data-settings-pane="general" role="tabpanel" aria-labelledby="settings-tab-general">
              <div class="settings-card"><h3>\u5916\u89C2</h3>
                <label class="settings-row" for="theme-select"><span><strong>\u754C\u9762\u4E3B\u9898</strong><small>\u9009\u62E9\u9002\u5408\u5F53\u524D\u5149\u7EBF\u7684\u754C\u9762\u3002</small></span><select class="field-select" id="theme-select"><option value="dark">\u77F3\u58A8 \xB7 Graphite</option><option value="light">\u6696\u767D \xB7 Paper</option></select></label>
                <label class="settings-row" for="density-select"><span><strong>\u4FE1\u606F\u5BC6\u5EA6</strong><small>\u8C03\u6574\u90E8\u4EF6\u5217\u8868\u7684\u95F4\u8DDD\u3002</small></span><select class="field-select" id="density-select"><option value="comfortable">\u8212\u9002</option><option value="compact">\u7D27\u51D1</option></select></label>
              </div>
              <div class="settings-card"><h3>\u5DE5\u4F5C\u533A\u4E0E\u753B\u5E03</h3>
                <label class="settings-row" for="layout-select"><span><strong>\u5DE5\u4F5C\u533A\u5E03\u5C40</strong><small>\u5DE5\u4F5C\u53F0\u53F3\u4E0A\u89D2\u4E5F\u53EF\u968F\u65F6\u5207\u6362\u3002</small></span><select class="field-select" id="layout-select"><option value="studio">\u6807\u51C6</option><option value="compare">\u56FE\u96C6\u5BF9\u7167</option></select></label>
                <label class="settings-row toggle-row" for="grid-toggle"><span><strong>\u753B\u5E03\u7F51\u70B9</strong><small>\u5728\u753B\u5E03\u80CC\u666F\u663E\u793A\u5B9A\u4F4D\u7F51\u70B9\u3002</small></span><input type="checkbox" id="grid-toggle"><span class="switch" aria-hidden="true"></span></label>
              </div>
              <div class="settings-section-footer"><span>\u5916\u89C2\u8C03\u6574\u5373\u65F6\u751F\u6548\uFF0C\u5E76\u81EA\u52A8\u4FDD\u5B58\u3002</span><button type="button" class="text-button" id="reset-preferences">\u6062\u590D\u9ED8\u8BA4\u5916\u89C2</button></div>
            </section>
            <section id="settings-pane-shortcuts" data-settings-pane="shortcuts" role="tabpanel" aria-labelledby="settings-tab-shortcuts" hidden>
              <div class="settings-card shortcut-settings"><h3>\u6309\u952E\u5206\u914D</h3><p class="settings-card-intro">\u70B9\u51FB\u5FEB\u6377\u952E\u540E\u6309\u4E0B\u65B0\u7EC4\u5408\u3002\u6309 Esc \u53D6\u6D88\uFF1B\u6587\u672C\u7F16\u8F91\u7684\u5E38\u7528\u6309\u952E\u4F1A\u4FDD\u7559\u3002</p>${import_keybindings.ACTIONS.map((action) => `<div class="settings-row"><span><strong>${action.name}</strong><small>${action.group}</small></span><button type="button" class="shortcut-binding" data-shortcut="${action.id}" aria-label="\u4FEE\u6539${action.name}\u5FEB\u6377\u952E">${escape(action.default)}</button></div>`).join("")}</div>
              <div class="settings-section-footer"><span id="shortcut-feedback" role="status">\u4FEE\u6539\u540E\u81EA\u52A8\u4FDD\u5B58\u3002</span><button type="button" class="text-button" id="reset-shortcuts">\u6062\u590D\u9ED8\u8BA4\u5FEB\u6377\u952E</button></div>
            </section>
            <section id="settings-pane-ai" data-settings-pane="ai" role="tabpanel" aria-labelledby="settings-tab-ai" hidden>
              <div class="settings-card"><h3>\u7ED8\u56FE\u670D\u52A1</h3>
                <label class="settings-row" for="settings-provider"><span><strong>\u9ED8\u8BA4\u670D\u52A1</strong><small>\u7528\u4E8E\u81EA\u5B9A\u4E49\u56FE\u96C6\u5DE5\u4F5C\u6D41\u3002</small></span><select class="field-select" id="settings-provider"><option value="ComfyUI">ComfyUI</option><option value="RunningHub">RunningHub</option></select></label>
                <div class="settings-form" id="settings-connection-form">
                  <label class="field-label" for="settings-comfy-address">ComfyUI \u5730\u5740</label><input class="settings-input" id="settings-comfy-address" type="url" spellcheck="false" autocomplete="off">
                  <label class="field-label" for="settings-cloud-address">RunningHub \u5730\u5740</label><input class="settings-input" id="settings-cloud-address" type="url" spellcheck="false" autocomplete="off">
                  <div class="settings-actions"><button type="button" class="button" id="settings-save-service">\u4FDD\u5B58\u8FDE\u63A5</button><button type="button" class="button primary" id="settings-test-service">\u4FDD\u5B58\u5E76\u6D4B\u8BD5\u8FDE\u63A5</button></div>
                  <p class="settings-feedback" id="settings-service-feedback" role="status"></p>
                </div>
              </div>
              <div class="settings-card" ${this.options.native ? "" : "hidden"}>
                <h3>RunningHub API Key</h3>
                <div class="settings-form">
                  <label class="field-label" for="settings-active-cloud-key">\u542F\u7528\u5BC6\u94A5</label>
                  <div class="settings-key-picker"><select class="settings-input" id="settings-active-cloud-key"></select><button type="button" class="button" id="settings-remove-cloud-key">\u5220\u9664\u5F53\u524D\u5BC6\u94A5</button></div>
                  <label class="field-label" for="settings-cloud-key-name">\u5BC6\u94A5\u540D\u79F0</label><input class="settings-input" id="settings-cloud-key-name" type="text" placeholder="\u53EF\u9009\uFF0C\u4F8B\u5982\u4E2A\u4EBA\u5DE5\u4F5C\u533A" autocomplete="off">
                  <label class="field-label" for="settings-cloud-key">\u65B0\u7684 API Key</label><input class="settings-input" id="settings-cloud-key" type="password" autocomplete="off" spellcheck="false">
                  <div class="settings-actions"><button type="button" class="button primary" id="settings-add-cloud-key">\u6DFB\u52A0\u5E76\u542F\u7528</button></div>
                  <p class="help-text" id="settings-key-note"></p>
                  <p class="settings-feedback" id="settings-key-feedback" role="status"></p>
                </div>
              </div>
              <div class="settings-card"><h3>\u91CD\u7ED8\u5DE5\u4F5C\u6D41</h3><div class="settings-row"><span><strong id="settings-workflow-name">\u5C1A\u672A\u914D\u7F6E\u5DE5\u4F5C\u6D41</strong><small>\u5BFC\u5165 API \u5DE5\u4F5C\u6D41\uFF0C\u8BBE\u7F6E\u56FE\u96C6\u3001\u906E\u7F69\u548C\u63D0\u793A\u8BCD\u6620\u5C04\u3002</small></span><button type="button" class="button" id="settings-workflow">\u5BFC\u5165 / \u914D\u7F6E</button></div></div>
            </section>
            <section id="settings-pane-project" data-settings-pane="project" role="tabpanel" aria-labelledby="settings-tab-project" hidden>
              <div class="settings-card"><h3>\u5F53\u524D\u9879\u76EE</h3><div class="settings-project-summary"><strong id="settings-project-name">\u672A\u6253\u5F00 MOD</strong><p id="settings-project-path">\u6253\u5F00 MOD \u540E\u53EF\u7BA1\u7406\u914D\u7F6E\u548C\u6587\u4EF6\u3002</p></div>
                <div class="settings-row"><span><strong>MOD \u914D\u7F6E</strong><small>\u7F16\u8F91\u539F\u59CB .modfile\uFF0C\u4FDD\u7559\u672A\u8BC6\u522B\u7684\u5B57\u6BB5\u3002</small></span><button type="button" class="button" data-project-setting="metadata">\u7F16\u8F91\u914D\u7F6E</button></div>
                <div class="settings-row"><span><strong>\u9879\u76EE\u6587\u4EF6\u5939</strong><small>\u5728${this.options.isMac ? "\u8BBF\u8FBE" : "\u8D44\u6E90\u7BA1\u7406\u5668"}\u4E2D\u67E5\u770B\u7D20\u6750\u3002</small></span><button type="button" class="button" data-project-setting="reveal">\u6253\u5F00\u4F4D\u7F6E</button></div>
                <div class="settings-row"><span><strong>\u53E6\u5B58\u4E3A\u526F\u672C</strong><small>\u521B\u5EFA\u5305\u542B\u5F53\u524D\u4FEE\u6539\u7684\u5B8C\u6574 MOD \u6587\u4EF6\u5939\u3002</small></span><button type="button" class="button" data-project-setting="saveAs">\u53E6\u5B58\u4E3A</button></div>
                <div class="settings-row"><span><strong>\u91CD\u505A\u4FEE\u6539</strong><small>\u91CD\u65B0\u5E94\u7528\u521A\u521A\u64A4\u9500\u7684\u7F16\u8F91\u3002</small></span><button type="button" class="button" data-project-setting="redo">\u91CD\u505A</button></div>
              </div><p class="help-text">\u4FDD\u5B58\u5230\u539F\u76EE\u5F55\u524D\u4F1A\u68C0\u67E5\u5916\u90E8\u4FEE\u6539\uFF0C\u5E76\u81EA\u52A8\u5907\u4EFD\u539F\u6587\u4EF6\u3002</p>
            </section>
            <section id="settings-pane-about" data-settings-pane="about" role="tabpanel" aria-labelledby="settings-tab-about" hidden>
              <div class="settings-card"><h3>BD Modder</h3><p class="settings-card-intro">Brown Dust MOD \u56FE\u96C6\u7F16\u8F91\u4E0E Spine \u52A8\u753B\u9884\u89C8\u3002</p><dl class="settings-about"><div><dt>\u5E94\u7528\u7248\u672C</dt><dd id="settings-version">\u2014</dd></div><div><dt>\u8FD0\u884C\u6A21\u5F0F</dt><dd id="settings-runtime">Electron \u684C\u9762\u7248</dd></div><div><dt>\u9AA8\u9ABC\u652F\u6301</dt><dd>Spine 4.1</dd></div><div><dt>\u6E32\u67D3\u73AF\u5883</dt><dd id="settings-device">\u6253\u5F00 MOD \u540E\u663E\u793A</dd></div></dl></div>
            </section>
          </div>
        </div>
      </div>`;
      this.element.querySelector("#settings-back").onclick = () => this.hide();
      this.tabs = [...this.element.querySelectorAll("[data-settings-tab]")];
      this.tabs.forEach((button) => {
        button.onclick = () => this.select(button.dataset.settingsTab);
        button.onkeydown = (event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const current = this.tabs.indexOf(button), index = event.key === "Home" ? 0 : event.key === "End" ? this.tabs.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + this.tabs.length) % this.tabs.length;
          this.select(this.tabs[index].dataset.settingsTab);
          this.tabs[index].focus();
        };
      });
      for (const [id, key] of [["theme-select", "theme"], ["density-select", "density"], ["layout-select", "layout"], ["grid-toggle", "grid"], ["settings-provider", "provider"]]) this.element.querySelector("#" + id).onchange = (event) => this.options.onPreference(key, key === "grid" ? event.target.checked : event.target.value);
      this.element.querySelector("#reset-preferences").onclick = () => this.options.onResetPreferences();
      this.element.querySelectorAll("[data-shortcut]").forEach((button) => button.onclick = () => this.capture(button.dataset.shortcut));
      this.element.querySelector("#reset-shortcuts").onclick = () => this.run(async () => this.setShortcuts(await this.options.onShortcuts({ ...import_keybindings.DEFAULT_SHORTCUTS })), "#shortcut-feedback");
      this.connectionFields = [...this.element.querySelectorAll("#settings-connection-form input")];
      this.connectionFields.forEach((input) => input.addEventListener("input", () => {
        this.serviceDirty = true;
        this.feedback("#settings-service-feedback", "\u8FDE\u63A5\u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539\u3002");
      }));
      this.element.querySelector("#settings-save-service").onclick = () => this.saveService(false);
      this.element.querySelector("#settings-test-service").onclick = () => this.saveService(true);
      this.element.querySelector("#settings-active-cloud-key").onchange = (event) => {
        const id = event.target.value || null;
        return this.saveKeyChange({ activeRunningHubKeyId: id }, id ? "\u5DF2\u5207\u6362\u542F\u7528\u5BC6\u94A5\u3002" : "\u5DF2\u505C\u7528 RunningHub \u5BC6\u94A5\u3002");
      };
      this.element.querySelector("#settings-cloud-key").oninput = () => this.updateServiceControls();
      this.element.querySelector("#settings-add-cloud-key").onclick = () => this.saveKeyChange({ addRunningHubKey: {
        name: this.element.querySelector("#settings-cloud-key-name").value,
        apiKey: this.element.querySelector("#settings-cloud-key").value
      } }, "\u5BC6\u94A5\u5DF2\u52A0\u5BC6\u4FDD\u5B58\u5E76\u542F\u7528\u3002");
      this.element.querySelector("#settings-remove-cloud-key").onclick = () => {
        const entry = this.service?.runningHubKeys?.find((item) => item.id === this.service.activeRunningHubKeyId);
        if (entry && window.confirm(`\u5220\u9664\u5BC6\u94A5\u300C${entry.name}\u300D\uFF1F`)) return this.saveKeyChange({ removeRunningHubKeyId: entry.id }, "\u5DF2\u5220\u9664\u5BC6\u94A5\u3002");
      };
      this.element.querySelector("#settings-workflow").onclick = () => this.options.onWorkflow();
      this.element.querySelectorAll("[data-project-setting]").forEach((button) => button.onclick = () => this.options.onProjectAction(button.dataset.projectSetting));
      document.addEventListener("keydown", (event) => this.keydown(event), true);
      this.setShortcuts(this.shortcuts);
      if (!this.options.native) this.element.querySelector("#settings-save-service").textContent = "\u4FDD\u5B58\u9884\u89C8\u8BBE\u7F6E";
      this.renderKeyPicker();
    }
    get open() {
      return !this.element.hidden;
    }
    async show(category = this.category) {
      this.select(category);
      this.options.onPause?.();
      await this.options.onVisibility?.(true);
      this.element.hidden = false;
      document.documentElement.dataset.screen = "settings";
      document.querySelector("#settings-open")?.setAttribute("aria-expanded", "true");
      this.tabs.find((button) => button.dataset.settingsTab === this.category)?.focus();
    }
    async hide() {
      this.cancelCapture();
      await this.options.onVisibility?.(false);
      this.element.querySelector("#settings-cloud-key").value = "";
      this.updateServiceControls();
      this.element.hidden = true;
      delete document.documentElement.dataset.screen;
      document.querySelector("#settings-open")?.setAttribute("aria-expanded", "false");
      document.querySelector("#settings-open")?.focus();
      this.options.onResume?.();
    }
    select(category) {
      const match = categories.find((c) => c[0] === category) || categories[0];
      this.category = match[0];
      this.cancelCapture();
      this.tabs.forEach((button) => {
        const active = button.dataset.settingsTab === this.category;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      this.element.querySelectorAll("[data-settings-pane]").forEach((pane) => pane.hidden = pane.dataset.settingsPane !== this.category);
      this.element.querySelector("#settings-section-title").textContent = match[1];
      this.element.querySelector("#settings-section-description").textContent = match[2];
      this.element.querySelector(".settings-content").scrollTop = 0;
    }
    sync({ preferences, service, project, version, device }) {
      if (preferences) {
        for (const [id, key] of [["theme-select", "theme"], ["density-select", "density"], ["layout-select", "layout"], ["settings-provider", "provider"]]) this.element.querySelector("#" + id).value = preferences[key] || (key === "provider" ? "ComfyUI" : "");
        this.element.querySelector("#grid-toggle").checked = Boolean(preferences.grid);
      }
      if (service) {
        this.service = service;
        if (service.shortcuts) this.setShortcuts(service.shortcuts);
        if (!this.serviceDirty) {
          this.element.querySelector("#settings-comfy-address").value = service.address || "http://127.0.0.1:8188/";
          this.element.querySelector("#settings-cloud-address").value = service.cloudAddress || "https://www.runninghub.ai/";
        }
        this.renderKeyPicker();
        this.element.querySelector("#settings-workflow-name").textContent = service.profile?.name || "\u5C1A\u672A\u914D\u7F6E\u5DE5\u4F5C\u6D41";
      }
      if (project !== void 0) {
        this.element.querySelector("#settings-project-name").textContent = project?.name || "\u672A\u6253\u5F00 MOD";
        this.element.querySelector("#settings-project-path").textContent = project?.root || "\u6253\u5F00 MOD \u540E\u53EF\u7BA1\u7406\u914D\u7F6E\u548C\u6587\u4EF6\u3002";
        this.element.querySelectorAll("[data-project-setting]").forEach((button) => button.disabled = !project || !this.options.native || button.dataset.projectSetting === "redo" && !project.redo);
      }
      this.element.querySelector("#settings-version").textContent = version || "1.0";
      this.element.querySelector("#settings-runtime").textContent = this.options.native ? "Electron \u684C\u9762\u7248" : "HTML \u8BBE\u8BA1\u9884\u89C8";
      if (device) this.element.querySelector("#settings-device").textContent = device;
    }
    setShortcuts(value) {
      this.shortcuts = (0, import_keybindings.validateShortcuts)(value, this.options.isMac);
      this.element.querySelectorAll("[data-shortcut]").forEach((button) => {
        button.textContent = (0, import_keybindings.formatShortcut)(this.shortcuts[button.dataset.shortcut], this.options.isMac);
        button.dataset.recording = "false";
        button.setAttribute("aria-pressed", "false");
      });
    }
    capture(id) {
      this.cancelCapture();
      this.recording = id;
      const button = this.element.querySelector(`[data-shortcut="${id}"]`);
      button.textContent = "\u6309\u4E0B\u7EC4\u5408\u952E\u2026";
      button.dataset.recording = "true";
      button.setAttribute("aria-pressed", "true");
      this.feedback("#shortcut-feedback", "\u6309\u4E0B\u65B0\u7684\u5FEB\u6377\u952E\uFF0C\u6216\u6309 Esc \u53D6\u6D88\u3002");
    }
    cancelCapture() {
      if (!this.recording) return;
      const old = this.recording;
      this.recording = null;
      const button = this.element.querySelector(`[data-shortcut="${old}"]`);
      button.textContent = (0, import_keybindings.formatShortcut)(this.shortcuts[old], this.options.isMac);
      button.dataset.recording = "false";
      button.setAttribute("aria-pressed", "false");
    }
    keydown(event) {
      if (!this.open) return;
      if (this.recording) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") {
          this.cancelCapture();
          this.feedback("#shortcut-feedback", "\u5DF2\u53D6\u6D88\u4FEE\u6539\u3002");
          return;
        }
        const shortcut = (0, import_keybindings.shortcutFromEvent)(event, this.options.isMac);
        if (!shortcut) return;
        const id = this.recording;
        this.cancelCapture();
        this.run(async () => {
          const next = (0, import_keybindings.validateShortcuts)({ ...this.shortcuts, [id]: shortcut }, this.options.isMac);
          this.setShortcuts(await this.options.onShortcuts(next));
          this.feedback("#shortcut-feedback", "\u5FEB\u6377\u952E\u5DF2\u4FDD\u5B58\u3002");
        }, "#shortcut-feedback");
      } else if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      }
    }
    feedback(selector, message, error = false) {
      const target = this.element.querySelector(selector);
      target.textContent = message;
      target.dataset.error = String(error);
    }
    async run(fn, selector) {
      try {
        return await fn();
      } catch (error) {
        this.feedback(selector, error.message, true);
        return null;
      }
    }
    updateServiceControls() {
      const busy = this.serviceBusy, canEncrypt = this.options.native && this.service?.encryptionAvailable;
      const keyInput = this.element.querySelector("#settings-cloud-key");
      for (const input of this.connectionFields) input.disabled = busy;
      this.element.querySelector("#settings-save-service").disabled = busy;
      this.element.querySelector("#settings-test-service").disabled = busy || !this.options.native;
      this.element.querySelector("#settings-active-cloud-key").disabled = busy || !this.service?.runningHubKeys?.length;
      this.element.querySelector("#settings-remove-cloud-key").disabled = busy || !this.service?.activeRunningHubKeyId;
      this.element.querySelector("#settings-cloud-key-name").disabled = keyInput.disabled = busy || !canEncrypt;
      this.element.querySelector("#settings-add-cloud-key").disabled = keyInput.disabled || !keyInput.value.trim();
    }
    renderKeyPicker() {
      const select = this.element.querySelector("#settings-active-cloud-key");
      const keys = this.service?.runningHubKeys || [];
      select.replaceChildren(new Option(keys.length ? "\u672A\u542F\u7528\u5BC6\u94A5" : "\u5C1A\u672A\u6DFB\u52A0\u5BC6\u94A5", ""), ...keys.map(({ id, name }) => new Option(name, id)));
      select.value = this.service?.activeRunningHubKeyId || "";
      const note = this.element.querySelector("#settings-key-note");
      note.textContent = this.service && !this.service.encryptionAvailable ? "\u5F53\u524D\u65E0\u6CD5\u4F7F\u7528\u7CFB\u7EDF\u5BC6\u94A5\u52A0\u5BC6\u3002" : this.service?.activeRunningHubKeyId && !this.service.hasKey ? "\u65E0\u6CD5\u89E3\u5BC6\u5F53\u524D\u5BC6\u94A5\uFF0C\u8BF7\u9009\u62E9\u53E6\u4E00\u6761\u6216\u91CD\u65B0\u6DFB\u52A0\u3002" : "\u5BC6\u94A5\u4F7F\u7528\u7CFB\u7EDF\u52A0\u5BC6\u4FDD\u5B58\u3002\u65B0\u4EFB\u52A1\u4F7F\u7528\u5F53\u524D\u542F\u7528\u7684\u5BC6\u94A5\u3002";
      this.updateServiceControls();
    }
    async runServiceAction(action, feedback) {
      if (this.serviceBusy) return;
      this.serviceBusy = true;
      this.updateServiceControls();
      try {
        await this.run(action, feedback);
      } finally {
        this.serviceBusy = false;
        this.renderKeyPicker();
      }
    }
    saveKeyChange(patch, message) {
      return this.runServiceAction(async () => {
        const result = await this.options.onSaveService(patch);
        if (patch.addRunningHubKey) {
          this.element.querySelector("#settings-cloud-key").value = "";
          this.element.querySelector("#settings-cloud-key-name").value = "";
        }
        this.sync({ service: result });
        this.feedback("#settings-key-feedback", message);
      }, "#settings-key-feedback");
    }
    saveService(test) {
      return this.runServiceAction(async () => {
        const patch = { address: this.element.querySelector("#settings-comfy-address").value, cloudAddress: this.element.querySelector("#settings-cloud-address").value };
        const provider = this.element.querySelector("#settings-provider").value;
        const result = await this.options.onSaveService(patch);
        this.serviceDirty = false;
        this.sync({ service: result });
        this.feedback("#settings-service-feedback", test ? "\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026" : "\u8FDE\u63A5\u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002");
        if (test) this.feedback("#settings-service-feedback", await this.options.onTestService(provider));
      }, "#settings-service-feedback");
    }
  };

  // renderer/settings-draft.js
  var import_keybindings2 = __toESM(require_keybindings());

  // renderer/part-visibility.js
  var svg = (tag, attributes) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    return el;
  };
  function grayHiddenRegions(overlay, parts, page, href) {
    if (!parts.length) return;
    const id = "hidden-" + overlay.id, defs = svg("defs", {}), clip = svg("clipPath", { id: id + "-clip" });
    for (const part of parts) clip.append(svg("rect", { x: part.x, y: part.y, width: part.width, height: part.height }));
    const filter = svg("filter", { id: id + "-gray", x: "0%", y: "0%", width: "100%", height: "100%", "color-interpolation-filters": "sRGB" });
    filter.append(svg("feColorMatrix", { type: "saturate", values: 0 }));
    defs.append(clip, filter);
    overlay.append(defs);
    const group = svg("g", { "clip-path": `url(#${id}-clip)`, class: "hidden-atlas-regions", "aria-label": "\u5DF2\u9690\u85CF\u90E8\u4EF6" });
    group.append(svg("rect", { width: page.width, height: page.height, class: "hidden-atlas-background" }));
    group.append(svg("image", { href, width: page.width, height: page.height, filter: `url(#${id}-gray)`, opacity: ".55" }));
    overlay.append(group);
    for (const part of parts) {
      const rect = svg("rect", { x: part.x, y: part.y, width: part.width, height: part.height, class: "hidden-atlas-border" });
      const title = svg("title", {});
      title.textContent = part.name + " \xB7 \u5DF2\u9690\u85CF";
      rect.append(title);
      overlay.append(rect);
    }
  }
  var PartContextMenu = class {
    constructor() {
      this.element = document.createElement("div");
      this.element.className = "part-context-menu";
      this.element.setAttribute("role", "menu");
      this.element.setAttribute("aria-label", "\u90E8\u4EF6\u64CD\u4F5C");
      this.element.hidden = true;
      document.body.append(this.element);
      document.addEventListener("pointerdown", (event) => {
        if (!this.element.contains(event.target)) this.close();
      });
      document.addEventListener("keydown", (event) => {
        if (this.element.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = [...this.element.querySelectorAll("button:not(:disabled)")];
          let i = buttons.indexOf(document.activeElement);
          i = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (i + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[i]?.focus();
        } else if (event.key === "Tab") this.close();
      }, true);
      addEventListener("resize", () => this.close());
      document.addEventListener("scroll", (event) => {
        if (!this.element.contains(event.target)) this.close();
      }, true);
    }
    close(focus = false) {
      this.element.hidden = true;
      if (focus && this.origin?.isConnected) this.origin.focus();
    }
    show(event, origin, { count, canHide, canShow, canReplace, canExport, canIsolate, selectionOnly, shortcut, onHide, onShow, onReplace, onExport, onToggleSelectionOnly }) {
      event.preventDefault();
      this.origin = origin;
      this.element.replaceChildren();
      const suffix = count > 1 ? `\uFF08${count}\uFF09` : "";
      const actions = [
        ["\u9690\u85CF\u9009\u4E2D\u90E8\u4EF6" + suffix, shortcut, !canHide, onHide],
        ["\u663E\u793A\u9690\u85CF\u90E8\u4EF6" + suffix, "", !canShow, onShow],
        [count > 1 ? "\u66FF\u6362\u7EC4\u5408 PNG" : "\u66FF\u6362 PNG", "", !canReplace, onReplace],
        [count > 1 ? "\u5BFC\u51FA\u7EC4\u5408 PNG" : "\u5BFC\u51FA PNG", "", !canExport, onExport],
        [selectionOnly ? "\u6062\u590D\u5B8C\u6574\u9884\u89C8" : "\u53EA\u770B\u9009\u4E2D\u90E8\u4EF6" + suffix, "", !selectionOnly && !canIsolate, onToggleSelectionOnly]
      ];
      for (const [label, key, disabled, run] of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.disabled = disabled;
        const text = document.createElement("span");
        text.textContent = label;
        button.append(text);
        if (key) {
          const hint = document.createElement("kbd");
          hint.textContent = key;
          button.append(hint);
        }
        button.onclick = () => {
          this.close();
          run();
        };
        this.element.append(button);
      }
      this.element.hidden = false;
      const r = origin.getBoundingClientRect();
      this.element.style.left = Math.max(8, Math.min(event.clientX || r.right, innerWidth - this.element.offsetWidth - 8)) + "px";
      this.element.style.top = Math.max(8, Math.min(event.clientY || r.top, innerHeight - this.element.offsetHeight - 8)) + "px";
      this.element.querySelector("button:not(:disabled)")?.focus();
    }
  };

  // renderer/settings-draft.js
  window.BDSettings = Object.freeze({ SettingsPage, DEFAULT_SHORTCUTS: import_keybindings2.DEFAULT_SHORTCUTS, validateShortcuts: import_keybindings2.validateShortcuts, actionForEvent: import_keybindings2.actionForEvent, PartContextMenu, grayHiddenRegions });
})();
