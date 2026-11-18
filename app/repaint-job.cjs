'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { task } = require('./tasks.cjs');
const { repaintOptions } = require('./repaint-controls.cjs');
const assembled = require('./workflows/local-repaint-assembled.qwen21.json');
const uv = require('./workflows/local-repaint-uv.qwen21.json');

async function runRepaint({ generation, settings, key, signal, progress, session, atlasBytes, rects, snapshot, maskBytes, input }) {
  const options = repaintOptions(input);
  const save = (name, bytes) => fs.writeFile(path.join(session, name), bytes);
  const report = (name, value) => save(name, JSON.stringify(value, null, 2) + '\n');
  const generate = (round, graph, payload) => generation.generateBuiltIn(
    settings, graph, { ...input, ...payload }, key, signal,
    message => progress(typeof message === 'string' ? '第 ' + round + ' 轮 · ' + message : { ...message, round }),
    metadata => report('round-' + round + '-job.json', metadata)
  );

  signal.throwIfAborted();
  progress('正在渲染组装图和 UV 映射…');
  const prepared = await task('repaintPrepare', { atlasBytes, rects, snapshot, maskBytes, seamExpand: options.seamExpand });
  await Promise.all([
    save('round-1-input.png', prepared.image),
    save('round-1-mask.png', prepared.mask),
    save('selection-atlas.png', prepared.selectedAtlas)
  ]);
  const roundOneOutput = await generate(1, assembled, {
    image: prepared.image, denoise: input.firstRoundDenoise
  });
  signal.throwIfAborted();
  await save('round-1-output.png', roundOneOutput.image);
  progress('正在把组装图写回原有 UV…');
  const first = await task('repaintRoundOne', { atlasBytes, rects, prepared, generated: roundOneOutput.image, ...options });
  await Promise.all([
    save('round-1-atlas.png', first.atlas), save('round-1-samples.png', first.samples), save('round-1-trace.bin', first.trace)
  ]);

  let result;
  const taskIds = [roundOneOutput.id];
  const rounds = [{ denoise: input.firstRoundDenoise, prompt: roundOneOutput.prompt, model: roundOneOutput.model }];
  if (first.image && options.secondRound) {
    await Promise.all([
      save('round-2-input.png', first.image),
      save('round-2-mask.png', first.mask),
      save('round-2-model-mask.png', first.modelMask),
      report('round-2-layout.json', first.layout)
    ]);
    const roundTwoOutput = await generate(2, uv, { image: first.image, mask: first.modelMask, reference: roundOneOutput.image, denoise: input.secondRoundDenoise });
    signal.throwIfAborted();
    taskIds.push(roundTwoOutput.id);
    rounds.push({ denoise: input.secondRoundDenoise, prompt: roundTwoOutput.prompt, model: roundTwoOutput.model });
    await save('round-2-output.png', roundTwoOutput.image);
    progress('正在校准裙片轮廓，并按原 UV 缺口写回…');
    result = await task('repaintFinish', {
      prepared, roundOne: first, generated: roundTwoOutput.image, writebackMode: options.writebackMode
    });
  } else {
    const remaining = options.secondRound ? 0 : prepared.total - first.count;
    result = { atlas: first.atlas, stats: { total: prepared.total, first: first.count, direct: 0, neighbor: 0, remaining } };
  }

  signal.throwIfAborted();
  const atlas = Buffer.from(result.atlas);
  const details = {
    animation: snapshot.animation, time: snapshot.time, rects, parts: result.parts,
    workSize: prepared.size, rounds, layout: first.layout, alignment: result.alignment, options, seamCount: first.seamCount
  };
  await Promise.all([
    save('result.png', atlas),
    report('report.json', { animation: snapshot.animation, time: snapshot.time, taskIds, ...result.stats, parts: result.parts, secondRoundAlignment: result.alignment, rounds, options, seamCount: first.seamCount })
  ]);
  if (result.stats.total === result.stats.remaining) throw Error('两轮输出都未找到可信的贴图样本，请查看生成内容和对齐位置。');
  return { ...result, atlas, taskIds, details };
}
module.exports = { runRepaint };
