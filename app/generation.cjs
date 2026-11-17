'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const crypto = require('node:crypto');
const ROLES = ['image', 'mask', 'reference', 'positive', 'negative', 'seed', 'steps', 'denoise', 'width', 'height', 'resolution'];
function normalizeProfile(source) {
  const lower = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
  if (lower.flow === 'character') throw Error('此版本使用图集局部重绘，请导入 Flow 为 atlas 的方案或 ComfyUI API 工作流。');
  if (lower.workflow) return { name: lower.name || '重绘方案', workflow: lower.workflow, bindings: (lower.bindings || []).map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k.toLowerCase(), v]))), outputNode: String(lower.outputnode || ''), workflowId: String(lower.workflowid || ''), positiveTemplate: lower.positivetemplate || '{request}', negativeTemplate: lower.negativetemplate || '' };
  const workflow = source.prompt || source;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || Object.values(workflow).some(n => !n || typeof n.class_type !== 'string' || !n.inputs)) throw Error('需要 ComfyUI 的 API 格式工作流或 .redraw.json 方案。');
  const bindings = []; let imageFound = false, positiveFound = false;
  for (const [id, node] of Object.entries(workflow)) {
    const title = (node._meta?.title || '').toLowerCase();
    for (const [field, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue; let role;
      if (node.class_type === 'LoadImageMask' && field === 'image') role = 'mask';
      else if (node.class_type === 'LoadImage' && field === 'image') { role = /mask|遮罩/.test(title) ? 'mask' : imageFound ? 'reference' : 'image'; if (role === 'image') imageFound = true; }
      else if (field === 'text' && /CLIPTextEncode/.test(node.class_type)) { role = /negative|负向/.test(title) || positiveFound ? 'negative' : 'positive'; if (role === 'positive') positiveFound = true; }
      else if (['seed', 'noise_seed', 'steps', 'denoise'].includes(field)) role = field === 'noise_seed' ? 'seed' : field;
      if (role) bindings.push({ node: id, field, value: role });
    }
  }
  return { name: '导入的工作流', workflow, bindings, outputNode: Object.entries(workflow).find(([, n]) => n.class_type === 'SaveImage')?.[0] || '', workflowId: '', positiveTemplate: '{request}', negativeTemplate: '' };
}
function validateProfile(profile) {
  if (!profile?.workflow || !profile.workflow[profile.outputNode] || !Array.isArray(profile.bindings)) throw Error('请选择工作流输出节点并设置输入映射。');
  const seen = new Set();
  for (const b of profile.bindings) {
    const node = profile.workflow[b.node], field = node?.inputs?.[b.field];
    if (!ROLES.includes(b.value) || field === undefined || Array.isArray(field) || seen.has(b.node + '.' + b.field)) throw Error('无效或重复的工作流映射：' + b.node + '.' + b.field); seen.add(b.node + '.' + b.field);
  }
  for (const role of ['image', 'mask', 'positive']) if (!profile.bindings.some(b => b.value === role)) throw Error('局部重绘需要映射 ' + role + ' 输入。');
  for (const b of profile.bindings.filter(b => b.value === 'mask')) {
    const n = profile.workflow[b.node];
    if (n.class_type !== 'LoadImageMask' && !Object.values(profile.workflow).some(node => node.class_type === 'ImageToMask' && node.inputs.image?.[0] === b.node)) throw Error('独立遮罩需要 LoadImageMask 或 LoadImage → ImageToMask（red 通道）。');
  }
  return profile;
}
function bind(profile, input, uploads) {
  validateProfile(profile); const graph = structuredClone(profile.workflow);
  const values = { ...input, ...uploads, positive: (profile.positiveTemplate || '{request}').replaceAll('{request}', input.request), negative: profile.negativeTemplate || '', resolution: Math.max(input.width, input.height) };
  for (const b of profile.bindings) { if (values[b.value] === undefined) throw Error('缺少输入：' + b.value); graph[b.node].inputs[b.field] = values[b.value]; if (b.value === 'mask' && graph[b.node].class_type === 'LoadImageMask') graph[b.node].inputs.channel = 'red'; }
  for (const b of profile.bindings.filter(b => b.value === 'mask')) for (const n of Object.values(graph)) if (n.class_type === 'ImageToMask' && n.inputs.image?.[0] === b.node) n.inputs.channel = 'red';
  return graph;
}
function workflowId(value) { const match = String(value).match(/(?:^|\/workflow\/)(\d{1,30})(?:$|[/?#])/); if (!match) throw Error('请输入 RunningHub 工作流 ID 或 /workflow/ID 链接。'); return match[1]; }
class Generation {
  constructor(options = {}) { this.fetch = options.fetch || fetch; this.pollMs = options.pollMs || 1500; }
  async request(base, endpoint, options = {}, signal) {
    const result = await this.fetch(new URL(endpoint, base), { ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    if (!result.ok) throw Error('服务返回 HTTP ' + result.status); return result;
  }
  async json(base, endpoint, body, signal, key) {
    const headers = body ? { 'Content-Type': 'application/json' } : {}; if (key) headers.Authorization = 'Bearer ' + key;
    const response = await this.request(base, endpoint, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }, signal); return response.json();
  }
  async check(settings, provider, key) {
    if (provider === 'RunningHub') { if (!key) throw Error('请先保存 RunningHub API Key。'); const result = await this.json(settings.cloudAddress, 'uc/openapi/accountStatus', { apikey: key }, null, key); if (result.code !== 0) throw Error('RunningHub 连接失败：' + result.code); return 'RunningHub 连接正常'; }
    const result = await this.json(settings.address, 'system_stats'); if (!result.system && !result.devices) throw Error('服务未返回有效 ComfyUI 状态。'); return 'ComfyUI 连接正常';
  }
  async generate(settings, provider, profile, input, key, signal, progress, record = async () => {}) {
    validateProfile(profile); const base = provider === 'RunningHub' ? settings.cloudAddress : settings.address, uploads = {};
    if (provider === 'RunningHub' && !key) throw Error('请先配置 RunningHub API Key。');
    if (provider === 'ComfyUI') {
      progress('检查 ComfyUI 节点…'); const info = await this.json(base, 'object_info', null, signal);
      const missing = [...new Set(Object.values(profile.workflow).map(n => n.class_type))].filter(n => !info[n]); if (missing.length) throw Error('服务缺少节点：' + missing.join('、'));
    } else {
      workflowId(profile.workflowId); progress('检查云端工作流…');
      const remote = await this.json(base, 'api/openapi/getJsonApiFormat', { apiKey: key, workflowId: workflowId(profile.workflowId) }, signal, key);
      if (remote.code !== 0) throw Error('云端工作流校验失败：' + remote.code);
      const graph = typeof remote.data?.prompt === 'string' ? JSON.parse(remote.data.prompt) : remote.data?.prompt;
      if (!graph || [profile.outputNode, ...profile.bindings.map(b => b.node)].some(id => graph[id]?.class_type !== profile.workflow[id]?.class_type)) throw Error('云端节点与导入的工作流不一致，请重新导入。');
      profile = { ...profile, workflow: graph };
    }
    for (const role of ['image', 'mask', 'reference']) {
      if (!profile.bindings.some(b => b.value === role)) continue;
      const image = input[role] || (role === 'reference' ? input.image : null); if (!image) throw Error('缺少 ' + role + ' 图片。'); progress('上传 ' + role + '…');
      const form = new FormData(); form.append(provider === 'RunningHub' ? 'file' : 'image', new Blob([image], { type: 'image/png' }), role + '.png');
      if (provider === 'ComfyUI') form.append('subfolder', 'BDModder/' + crypto.randomUUID());
      const response = await this.request(base, provider === 'RunningHub' ? 'openapi/v2/media/upload/binary' : 'upload/image', { method: 'POST', body: form, ...(provider === 'RunningHub' ? { headers: { Authorization: 'Bearer ' + key } } : {}) }, signal);
      const result = await response.json(); if (provider === 'RunningHub' && result.code !== 0) throw Error('上传失败：' + result.code);
      uploads[role] = provider === 'RunningHub' ? result.data?.fileName : [result.subfolder, result.name].filter(Boolean).join('/'); if (!uploads[role]) throw Error('上传未返回文件名。');
    }
    const graph = bind(profile, input, uploads); let id;
    if (provider === 'RunningHub') {
      const fields = profile.bindings.map(b => ({ nodeId: b.node, fieldName: b.field, fieldValue: String(graph[b.node].inputs[b.field]) }));
      for (const [nodeId, n] of Object.entries(graph)) if (['LoadImageMask', 'ImageToMask'].includes(n.class_type) && n.inputs.channel === 'red') fields.push({ nodeId, fieldName: 'channel', fieldValue: 'red' });
      let result; try { result = await this.json(base, 'task/openapi/create', { workflowId: workflowId(profile.workflowId), apiKey: key, nodeInfoList: fields }, signal, key); } catch (error) { throw Error('云端提交结果未知，请先检查 RunningHub 任务记录后再重试。' + (error.name === 'AbortError' ? ' 已停止等待。' : '')); } if (result.code !== 0) throw Error('提交失败：' + result.code); id = result.data?.taskId;
    } else { const result = await this.json(base, 'prompt', { prompt: graph, client_id: crypto.randomUUID() }, signal); id = result.prompt_id; }
    if (!id) throw Error('服务未返回任务 ID，请检查服务端记录后再重试。');
    await record({ id, provider, outputNode: profile.outputNode, submittedAt: new Date().toISOString() });
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted(); progress('排队 / 生成中 · ' + id);
      if (provider === 'ComfyUI') {
        const history = await this.json(base, 'history/' + encodeURIComponent(id), null, signal), job = history[id];
        if (job?.status?.status_str === 'error') throw Error('ComfyUI 执行失败，请检查服务端任务 ' + id);
        const image = job?.outputs?.[profile.outputNode]?.images?.[0];
        if (image) { const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' }); const response = await this.request(base, 'view?' + query, {}, signal); return { image: Buffer.from(await response.arrayBuffer()), id }; }
        if (job?.status?.completed) throw Error('任务完成但指定节点没有返回图片。');
      } else {
        const result = await this.json(base, 'task/openapi/outputs', { apiKey: key, taskId: id }, signal, key);
        if (![0, 804, 813].includes(result.code)) throw Error('RunningHub 任务失败：' + result.code);
        if (result.code === 0 && Array.isArray(result.data) && result.data.length) {
          const output = result.data.find(o => String(o.nodeId) === String(profile.outputNode)) || (result.data.length === 1 && result.data[0].nodeId == null ? result.data[0] : null);
          if (!output) throw Error('云端没有返回指定输出节点。'); const url = new URL(output.fileUrl); if (url.protocol !== 'https:') throw Error('云端结果必须使用 HTTPS。');
          const response = await this.request(url.href, '', {}, signal); return { image: Buffer.from(await response.arrayBuffer()), id };
        }
      }
      await delay(this.pollMs, undefined, { signal });
    }
    throw Error('等待超过 30 分钟，服务任务可能继续执行。任务 ID：' + id);
  }
}
module.exports = { Generation, normalizeProfile, validateProfile, bind, workflowId, ROLES };
