'use strict';
// Pure shared logic: consumed by Electron's menu and the browser renderer.
const ACTIONS = Object.freeze([
  { id: 'open', name: '打开 MOD', group: '项目操作', default: 'Ctrl+O', native: true },
  { id: 'save', name: '保存修改', group: '项目操作', default: 'Ctrl+S', native: true },
  { id: 'saveAs', name: '另存为', group: '项目操作', default: 'Ctrl+Shift+S', native: true },
  { id: 'export', name: '导出', group: '项目操作', default: 'Ctrl+E', native: true },
  { id: 'undo', name: '撤销修改', group: '编辑操作', default: 'Ctrl+Z', native: true },
  { id: 'redo', name: '重做修改', group: '编辑操作', default: 'Ctrl+Shift+Z', native: true },
  { id: 'hide', name: '隐藏选中部件', group: '编辑操作', default: 'H' },
  { id: 'play', name: '播放 / 暂停', group: '画布操作', default: 'Space' },
  { id: 'switchWorkspace', name: '标准 / 图集对照', group: '画布操作', default: 'F' },
  { id: 'fit', name: '适应当前画布', group: '画布操作', default: '0' },
  { id: 'search', name: '搜索部件', group: '画布操作', default: '/' }
]);
const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(ACTIONS.map(action => [action.id, action.default])));
const RESERVED = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+=', 'Ctrl+Shift+=', 'Ctrl+-', 'Ctrl+0', 'F11', 'Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete']);
const MAC_RESERVED = new Set(['Ctrl+Q', 'Ctrl+H', 'Ctrl+Alt+H', 'Ctrl+M', 'Ctrl+W', 'Ctrl+Space']);
function formatShortcut(shortcut, isMac) {
  return isMac ? shortcut.replace(/^Ctrl\+/, '⌘+') : shortcut;
}
function normalizeShortcut(value, isMac = false) {
  if (typeof value !== 'string' || value.length > 50) throw Error('快捷键格式无效。');
  const parts = value.split('+'), key = parts.pop(), mods = new Set(parts);
  if (mods.size !== parts.length || parts.some(p => !['Ctrl', 'Alt', 'Shift'].includes(p)) || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|[\/\[\]\\;\-',.`=])$/.test(key || '')) throw Error('请使用字母、数字、F1–F12、空格或常用符号，可搭配 Ctrl / Alt / Shift。');
  const normalized = ['Ctrl', 'Alt', 'Shift'].filter(m => mods.has(m)).concat(key).join('+');
  if (RESERVED.has(normalized) || (isMac && MAC_RESERVED.has(normalized))) throw Error('该组合由系统或文本编辑使用，请换一个快捷键。'); return normalized;
}
function validateShortcuts(input = {}, isMac = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('快捷键配置无效。');
  const output = {}, occupied = new Map();
  for (const action of ACTIONS) {
    const key = normalizeShortcut(input[action.id] ?? action.default, isMac);
    if (action.native && !key.includes('+') && !/^F\d+$/.test(key)) throw Error('项目和编辑操作请使用组合键或 F1–F12，避免影响文字输入。');
    if (occupied.has(key)) throw Error(`快捷键 ${formatShortcut(key, isMac)} 已用于“${occupied.get(key)}”。`);
    output[action.id] = key; occupied.set(key, action.name);
  }
  return output;
}
function shortcutFromEvent(event, isMac = false) {
  if (event.isComposing || (isMac ? event.ctrlKey : event.metaKey) || ['Control', 'Alt', 'Shift', 'Meta', 'Escape', 'Tab', 'Enter', 'Backspace', 'Delete'].includes(event.key)) return null;
  const punctuation = { Space: 'Space', Slash: '/', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', Comma: ',', Period: '.', Backquote: '`' };
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : punctuation[event.code] || (/^F(?:[1-9]|1[0-2])$/.test(event.key) ? event.key : null);
  if (!key) return null;
  // Keep the persisted shortcut format shared across platforms.
  return [(isMac ? event.metaKey : event.ctrlKey) && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
}
function actionForEvent(event, shortcuts, isMac) { const key = shortcutFromEvent(event, isMac); return key ? ACTIONS.find(action => shortcuts[action.id] === key)?.id || null : null; }
module.exports = { ACTIONS, DEFAULT_SHORTCUTS, formatShortcut, normalizeShortcut, validateShortcuts, shortcutFromEvent, actionForEvent };
