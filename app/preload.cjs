'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = async (channel, payload) => { const result = await ipcRenderer.invoke(channel, payload); if (!result.ok) throw Error(result.error); return result.value; };
contextBridge.exposeInMainWorld('bd', Object.freeze({
  isMac: process.platform === 'darwin',
  boot: () => call('bd:boot'),
  open: kind => call('bd:open', kind),
  recent: index => call('bd:recent', index),
  save: asNew => call('bd:save', Boolean(asNew)),
  edit: payload => call('bd:edit', payload),
  visibility: payload => call('bd:visibility', payload),
  replace: payload => call('bd:replace', payload),
  undo: redo => call('bd:undo', Boolean(redo)),
  manifest: text => call('bd:manifest', text),
  export: payload => call('bd:export', payload),
  reveal: () => call('bd:reveal'),
  settings: patch => call('bd:settings', patch),
  zoom: direction => call('bd:zoom', direction),
  settingsScreen: open => call('bd:settings-screen', Boolean(open)),
  importWorkflow: () => call('bd:workflow'),
  checkService: provider => call('bd:check-service', provider),
  generate: payload => call('bd:generate', payload),
  cancelGeneration: () => call('bd:cancel-generation'),
  applyGeneration: id => call('bd:apply-generation', id),
  discardGeneration: () => call('bd:discard-generation'),
  onProgress: callback => { const listener = (_event, message) => callback(message); ipcRenderer.on('bd:progress', listener); return () => ipcRenderer.removeListener('bd:progress', listener); },
  onCommand: callback => { const listener = (_event, command) => callback(command); ipcRenderer.on('bd:command', listener); return () => ipcRenderer.removeListener('bd:command', listener); },
  onZoomChanged: callback => { const listener = (_event, zoom) => callback(zoom); ipcRenderer.on('bd:zoom-changed', listener); return () => ipcRenderer.removeListener('bd:zoom-changed', listener); },
  diagnostics: value => call('bd:diagnostics', value)
}));
