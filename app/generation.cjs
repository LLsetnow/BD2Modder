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
function queueTaskStatus(queue, id) {
  queue = queue?.data ?? queue;
  const taskId = entry => Array.isArray(entry) ? entry[1] : entry?.prompt_id ?? entry?.id;
  const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
  if (pending.some(entry => String(taskId(entry)) === String(id))) return 'queued';
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : [];
  if (running.some(entry => String(taskId(entry)) === String(id))) return 'running';
  return null;
}
function historyTaskStatus(entry) {
  const status = String(entry?.status?.status_str || '').toLowerCase();
  if (status === 'queued' || status === 'pending') return 'queued';
  if (status === 'running' || status === 'executing') return 'running';
  return null;
}
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
    if (provider === 'RunningHub') { if (!key) throw Error('请先启用 RunningHub API Key。'); const result = await this.json(settings.cloudAddress, 'uc/openapi/accountStatus', { apikey: key }, null, key); if (result.code !== 0) throw Error('RunningHub 连接失败：' + result.code); return 'RunningHub 连接正常'; }
    const result = await this.json(settings.address, 'system_stats'); if (!result.system && !result.devices) throw Error('服务未返回有效 ComfyUI 状态。'); return 'ComfyUI 连接正常';
  }


  async downloadBuiltInImage(base, image, signal) {
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
    let url = new URL('view?' + query, base);
    const resultSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    for (let hops = 0; hops <= 4; hops++) {
      const response = await this.fetch(url, { redirect: 'manual', signal: resultSignal });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      const location = response.headers.get('Location');
      if (response.status < 300 || response.status > 399 || !location) {
        throw Error('RunningHub 成图下载失败 · HTTP ' + response.status);
      }
      await response.body?.cancel();
      url = new URL(location, url);
      if (url.protocol !== 'https:' || url.username || url.password ||
          !['runninghub.ai', 'runninghub.cn', 'xiaoyaoyou.com', 'myqcloud.com'].some(
            domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) {
        throw Error('RunningHub 成图跳转地址无效。');
      }
    }
    throw Error('RunningHub 成图下载跳转过多。');
  }

  async generateBuiltIn(settings, workflow, input, key, signal, progress, record = async () => {}) {
    if (!key) throw Error('请在服务设置中启用 RunningHub API Key。');
    const server = new URL(settings.cloudAddress);
    if (server.protocol !== 'https:' || !['www.runninghub.cn', 'www.runninghub.ai', 'runninghub.cn', 'runninghub.ai'].includes(server.hostname)) {
      throw Error('局部重绘需要 RunningHub 官方 HTTPS 地址。');
    }
    const base = new URL('proxy-plus/' + encodeURIComponent(key) + '/', server.origin);
    const graph = structuredClone(workflow);
    const files = [['1', 'image', input.image], ['2', 'mask', input.mask], ['3', 'reference', input.reference]];
    for (const [node, role, bytes] of files) {
      if (!graph[node]) continue;
      if (!bytes) throw Error('局部重绘缺少输入：' + role);
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: 'image/png' }), role + '.png');
      progress('上传 ' + role + '…');
      const response = await this.request(base, 'upload/image', { method: 'POST', body: form }, signal);
      const envelope = await response.json();
      const upload = envelope.data ?? envelope;
      if (!upload.name) throw Error('RunningHub 上传失败：' + (envelope.msg || envelope.message || '未返回文件名'));
      graph[node].inputs.image = [upload.subfolder, upload.name].filter(Boolean).join('/');
    }
    graph['7'].inputs.prompt = input.request + '\n\n' + graph['7'].inputs.prompt;
    graph['8'].inputs.seed = input.seed;
    graph['8'].inputs.steps = input.steps;
    if (graph['8']?.inputs && Object.hasOwn(graph['8'].inputs, 'denoise')) {
      graph['8'].inputs.denoise = input.denoise;
    }

    let submission;
    try {
      // Validation errors can be HTTP 400 with useful per-node details.
      const response = await this.fetch(new URL('prompt', base), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ prompt: graph }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)])
      });
      submission = await response.json();
      if (!response.ok && !submission.error && !submission.msg) throw Error('HTTP ' + response.status);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw Error('RunningHub 提交未确认。请先核对云端任务记录，再决定是否重试。');
    }
    const job = submission.data ?? submission;
    const id = job.prompt_id;
    if (!id) {
      const errors = Object.entries(job.node_errors ?? {}).flatMap(([id, node]) =>
        (node.errors ?? []).map(error => id + ' ' + (error.details || error.message))
      );
      const detail = errors.join(' · ') || job.error?.message || job.msg || submission.msg;
      throw Error('RunningHub 未返回任务 ID' + (detail ? '：' + detail : '。请检查云端任务记录和模型可用性。'));
    }
    const startedAt = Date.now();
    await record({ id, provider: 'RunningHub', outputNode: '10', submittedAt: new Date(startedAt).toISOString() });
    const deadline = Date.now() + 30 * 60 * 1000;
    progress({ kind: 'task', id, startedAt, status: 'unknown' });
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      let queueStatus = null;
      try { queueStatus = queueTaskStatus(await this.json(base, 'queue', null, signal), id); }
      catch (error) { if (signal.aborted) throw error; }
      const envelope = await this.json(base, 'history/' + encodeURIComponent(id), null, signal);
      const history = envelope.data ?? envelope;
      const entry = history[id];
      if (entry?.status?.status_str === 'error') {
        const message = entry.status.messages?.find(item => item[0] === 'execution_error')?.[1]?.exception_message;
        throw Error('RunningHub 执行失败 · ' + id + (message ? '：' + message : ''));
      }
      const image = entry?.outputs?.['10']?.images?.[0];
      if (image) return {
        image: await this.downloadBuiltInImage(base, image, signal), id,
        prompt: graph['7'].inputs.prompt, model: graph['4'].inputs.unet_name
      };
      if (entry?.status?.completed) throw Error('任务完成但未返回工作图 · ' + id);
      progress({ kind: 'task', id, startedAt, status: queueStatus || historyTaskStatus(entry) || 'unknown' });
      await delay(this.pollMs, undefined, { signal });
    }
    throw Error('RunningHub 任务等待超时 · ' + id);
  }

  async generate(settings, provider, profile, input, key, signal, progress, record = async () => {}) {
    validateProfile(profile); const base = provider === 'RunningHub' ? settings.cloudAddress : settings.address, uploads = {};
    if (provider === 'RunningHub' && !key) throw Error('请先启用 RunningHub API Key。');
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
    const startedAt = Date.now();
    await record({ id, provider, outputNode: profile.outputNode, submittedAt: new Date(startedAt).toISOString() });
    const deadline = Date.now() + 30 * 60 * 1000;
    progress({ kind: 'task', id, startedAt, status: 'unknown' });
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (provider === 'ComfyUI') {
        let queueStatus = null;
        try { queueStatus = queueTaskStatus(await this.json(base, 'queue', null, signal), id); }
        catch (error) { if (signal?.aborted) throw error; }
        const history = await this.json(base, 'history/' + encodeURIComponent(id), null, signal), job = history[id];
        if (job?.status?.status_str === 'error') throw Error('ComfyUI 执行失败，请检查服务端任务 ' + id);
        const image = job?.outputs?.[profile.outputNode]?.images?.[0];
        if (image) { const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' }); const response = await this.request(base, 'view?' + query, {}, signal); return { image: Buffer.from(await response.arrayBuffer()), id }; }
        if (job?.status?.completed) throw Error('任务完成但指定节点没有返回图片。');
        progress({ kind: 'task', id, startedAt, status: queueStatus || historyTaskStatus(job) || 'unknown' });
      } else {
        const result = await this.json(base, 'task/openapi/outputs', { apiKey: key, taskId: id }, signal, key);
        if (![0, 804, 813].includes(result.code)) throw Error('RunningHub 任务失败：' + result.code);
        if (result.code === 0 && Array.isArray(result.data) && result.data.length) {
          const output = result.data.find(o => String(o.nodeId) === String(profile.outputNode)) || (result.data.length === 1 && result.data[0].nodeId == null ? result.data[0] : null);
          if (!output) throw Error('云端没有返回指定输出节点。'); const url = new URL(output.fileUrl); if (url.protocol !== 'https:') throw Error('云端结果必须使用 HTTPS。');
          const response = await this.request(url.href, '', {}, signal); return { image: Buffer.from(await response.arrayBuffer()), id };
        }
        progress({ kind: 'task', id, startedAt, status: result.code === 813 ? 'queued' : result.code === 804 ? 'running' : 'unknown' });
      }
      await delay(this.pollMs, undefined, { signal });
    }
    throw Error('等待超过 30 分钟，服务任务可能继续执行。任务 ID：' + id);
  }
}
module.exports = { Generation, normalizeProfile, validateProfile, bind, workflowId, ROLES };
