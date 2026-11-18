'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const texture = require('./texture.cjs');
const repaint = require('./local-repaint.cjs');
const { zipSync, unzipSync } = require('fflate');
(async () => {
  const { task, args } = workerData; let result;
  if (task === 'texture') { const data = await fs.readFile(args.path); const bytes = args.path.toLowerCase().endsWith('.bytes') ? texture.decodeBytes(data) : data; const image = texture.png(bytes); result = { bytes, width: image.width, height: image.height, hash: require('node:crypto').createHash('sha256').update(data).digest('hex') }; }
  else if (task === 'edit') result = texture.edit(args.bytes, args.operation, args.rects, args.options);
  else if (task === 'repaintPrepare') result = repaint.prepare(args);
  else if (task === 'repaintReplace') result = repaint.replaceAssembled(args);
  else if (task === 'repaintRoundOne') result = repaint.projectRoundOne(args);
  else if (task === 'repaintFinish') result = repaint.finish(args);
  else if (task === 'mask') result = texture.mask(args.bytes, args.rects);
  else if (task === 'encode') result = texture.encodeBytes(args.bytes, args.original);
  else if (task === 'zip') result = zipSync(args.entries, { level: 6 });
  else if (task === 'unzip') {
    let total = 0, count = 0;
    result = unzipSync(Buffer.from(args.bytes), { filter: file => {
      if (++count > 10000 || (total += file.originalSize) > 1024 * 1024 * 1024) throw Error('ZIP 内容过大。');
      if (file.originalSize > 256 * 1024 * 1024) throw Error('ZIP 中单个文件过大。'); return true;
    } });
  } else if (task === 'crop') result = texture.crop(args.bytes, args.rect, args.meshes);
  else throw Error('未知后台任务。');
  parentPort.postMessage({ result });
})().catch(error => parentPort.postMessage({ error: error.message }));
