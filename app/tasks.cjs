'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
function task(name, args) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'task-worker.cjs'), { workerData: { task: name, args } });
    const timer = setTimeout(() => { worker.terminate(); reject(Error('后台任务超时，请检查素材尺寸。')); }, 120000);
    worker.once('message', data => { clearTimeout(timer); data.error ? reject(Error(data.error)) : resolve(data.result); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(Error('后台任务意外退出：' + code)); });
  });
}
module.exports = { task };
