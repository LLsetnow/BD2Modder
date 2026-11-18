'use strict';

const repaintControls = Object.freeze({
  seamExpand: { standard: 3, label: '第一轮交界宽度' },
  maskExpand: { standard: 12, label: '第二轮蒙版扩展' },
  maskFeather: { standard: 4, label: '第二轮羽化宽度' }
});

function isRepaintDistance(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function repaintOptions(values = {}) {
  const secondRound = values.secondRound ?? true;
  if (typeof secondRound !== 'boolean') throw Error('第二轮补绘开关无效。');
  const writebackMode = values.writebackMode ?? 'rgb';
  if (writebackMode !== 'rgb' && writebackMode !== 'argb') throw Error('无效的 UV 回写通道。');
  const geometry = Object.fromEntries(Object.entries(repaintControls).map(([name, control]) => {
    const value = values[name] ?? control.standard;
    if (!isRepaintDistance(value)) throw Error(control.label + '须为非负整数（px）。');
    return [name, value];
  }));
  return { ...geometry, writebackMode, secondRound };
}

module.exports = { repaintControls, isRepaintDistance, repaintOptions };
