const svg = (tag, attributes) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value); return el; };
export function grayHiddenRegions(overlay, parts, page, href) {
  if (!parts.length) return;
  const id = 'hidden-' + overlay.id, defs = svg('defs', {}), clip = svg('clipPath', { id: id + '-clip' });
  for (const part of parts) clip.append(svg('rect', { x: part.x, y: part.y, width: part.width, height: part.height }));
  const filter = svg('filter', { id: id + '-gray', x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
  filter.append(svg('feColorMatrix', { type: 'saturate', values: 0 })); defs.append(clip, filter); overlay.append(defs);
  const group = svg('g', { 'clip-path': `url(#${id}-clip)`, class: 'hidden-atlas-regions', 'aria-label': '已隐藏部件' });
  group.append(svg('rect', { width: page.width, height: page.height, class: 'hidden-atlas-background' }));
  group.append(svg('image', { href, width: page.width, height: page.height, filter: `url(#${id}-gray)`, opacity: '.55' })); overlay.append(group);
  for (const part of parts) { const rect = svg('rect', { x: part.x, y: part.y, width: part.width, height: part.height, class: 'hidden-atlas-border' }); const title = svg('title', {}); title.textContent = part.name + ' · 已隐藏'; rect.append(title); overlay.append(rect); }
}
export class PartContextMenu {
  constructor() {
    this.element = document.createElement('div'); this.element.className = 'part-context-menu'; this.element.setAttribute('role', 'menu'); this.element.setAttribute('aria-label', '部件操作'); this.element.hidden = true; document.body.append(this.element);
    document.addEventListener('pointerdown', event => { if (!this.element.contains(event.target)) this.close(); });
    document.addEventListener('keydown', event => {
      if (this.element.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const buttons = [...this.element.querySelectorAll('button:not(:disabled)')]; let i = buttons.indexOf(document.activeElement); i = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length; buttons[i]?.focus(); }
      else if (event.key === 'Tab') this.close();
    }, true);
    addEventListener('resize', () => this.close()); document.addEventListener('scroll', event => { if (!this.element.contains(event.target)) this.close(); }, true);
  }
  close(focus = false) { this.element.hidden = true; if (focus && this.origin?.isConnected) this.origin.focus(); }
  show(event, origin, { count, canHide, canShow, canReplace, canExport, canIsolate, selectionOnly, shortcut, onHide, onShow, onReplace, onExport, onToggleSelectionOnly }) {
    event.preventDefault(); this.origin = origin; this.element.replaceChildren();
    const suffix = count > 1 ? `（${count}）` : '';
    const actions = [
      ['隐藏选中部件' + suffix, shortcut, !canHide, onHide],
      ['显示隐藏部件' + suffix, '', !canShow, onShow],
      [count > 1 ? '替换组合 PNG' : '替换 PNG', '', !canReplace, onReplace],
      [count > 1 ? '导出组合 PNG' : '导出 PNG', '', !canExport, onExport],
      [selectionOnly ? '恢复完整预览' : '只看选中部件' + suffix, '', !selectionOnly && !canIsolate, onToggleSelectionOnly]
    ];
    for (const [label, key, disabled, run] of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.disabled = disabled;
      const text = document.createElement('span'); text.textContent = label; button.append(text);
      if (key) { const hint = document.createElement('kbd'); hint.textContent = key; button.append(hint); }
      button.onclick = () => { this.close(); run(); }; this.element.append(button);
    }
    this.element.hidden = false; const r = origin.getBoundingClientRect();
    this.element.style.left = Math.max(8, Math.min(event.clientX || r.right, innerWidth - this.element.offsetWidth - 8)) + 'px';
    this.element.style.top = Math.max(8, Math.min(event.clientY || r.top, innerHeight - this.element.offsetHeight - 8)) + 'px';
    this.element.querySelector('button:not(:disabled)')?.focus();
  }
}
