const tabs = ['选择部件', '组装图重绘', 'UV 回写', '原尺寸 UV 补绘'];
const count = value => value.toLocaleString();
const point = (x, y) => '(' + x + ', ' + y + ')';

function loadImage(image) {
  if (image.hasAttribute('src')) return;
  const label = image.closest('figure')?.querySelector('figcaption small');
  image.addEventListener('load', () => {
    if (label) label.textContent = image.naturalWidth + ' × ' + image.naturalHeight;
  }, { once: true });
  image.addEventListener('error', () => {
    if (label) label.textContent = '图像读取失败';
  }, { once: true });
  image.src = image.dataset.src;
}

function assetFigure(url, title, e) {
  return '<figure class="repaint-detail-figure"><figcaption><span>' + e(title) +
    '</span><small class="muted"></small></figcaption><div class="repaint-detail-zoom" data-repaint-zoom data-repaint-zoom-scale="1" data-repaint-zoom-label="滚轮缩放 · 空格拖动 · 100%" title="滚轮缩放，按住空格拖动" tabindex="0">' +
    '<img data-repaint-zoom-content draggable="false" alt="' + e(title) + '" data-src="' + e(url) + '"></div></figure>';
}

function compareFigure(inputUrl, outputUrl, inputTitle, outputTitle, e) {
  return '<figure class="repaint-detail-figure repaint-detail-compare"><figcaption><span>输入与输出对比</span><span class="muted">拖动竖线查看差异</span></figcaption>' +
    '<div class="repaint-detail-compare-stage repaint-detail-zoom" data-repaint-zoom data-repaint-zoom-scale="1" data-repaint-zoom-label="滚轮缩放 · 空格拖动 · 100%" title="滚轮缩放，按住空格拖动" tabindex="0" data-repaint-compare style="--repaint-compare-position: 50%">' +
    '<div class="repaint-detail-compare-canvas" data-repaint-zoom-content>' +
    '<img class="repaint-detail-compare-output" draggable="false" alt="' + e(outputTitle) + '" data-src="' + e(outputUrl) + '">' +
    '<img class="repaint-detail-compare-input" draggable="false" alt="' + e(inputTitle) + '" data-src="' + e(inputUrl) + '"></div>' +
    '<span class="repaint-detail-compare-label is-input">输入</span><span class="repaint-detail-compare-label is-output">输出</span>' +
    '<span class="repaint-detail-compare-divider" aria-hidden="true"></span>' +
    '<div class="repaint-detail-compare-handle" data-repaint-compare-handle role="slider" tabindex="0" aria-label="拖动竖线对比输入与输出" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="输入占画面 50%"><span>↔</span></div>' +
    '</div></figure>';
}

function bindRepaintCompare(content, signal) {
  for (const stage of content.querySelectorAll('[data-repaint-compare]')) {
    const handle = stage.querySelector('[data-repaint-compare-handle]');
    const update = value => {
      const position = Math.max(0, Math.min(100, Math.round(value)));
      stage.style.setProperty('--repaint-compare-position', position + '%');
      handle.setAttribute('aria-valuenow', String(position));
      handle.setAttribute('aria-valuetext', '输入占画面 ' + position + '%');
    };
    let activePointer = null;
    const moveDivider = event => {
      const bounds = stage.getBoundingClientRect();
      if (bounds.width) update((event.clientX - bounds.left) / bounds.width * 100);
    };
    handle.addEventListener('pointerdown', event => {
      if (activePointer !== null || event.button !== 0) return;
      event.preventDefault();
      activePointer = event.pointerId;
      handle.setPointerCapture(event.pointerId);
      moveDivider(event);
    }, { signal });
    handle.addEventListener('pointermove', event => {
      if (activePointer === event.pointerId) moveDivider(event);
    }, { signal });
    const finishPointer = event => {
      if (activePointer === event.pointerId) activePointer = null;
    };
    handle.addEventListener('pointerup', finishPointer, { signal });
    handle.addEventListener('pointercancel', finishPointer, { signal });
    handle.addEventListener('lostpointercapture', finishPointer, { signal });
    handle.addEventListener('keydown', event => {
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, Home: -100, End: 100 };
      if (!(event.key in steps)) return;
      event.preventDefault();
      const step = event.shiftKey && Math.abs(steps[event.key]) === 1 ? steps[event.key] * 10 : steps[event.key];
      update(Number(handle.getAttribute('aria-valuenow')) + step);
    }, { signal });
  }
}

function bindImageZoom(content, signal) {
  const stages = [...content.querySelectorAll('[data-repaint-zoom]')];
  const cancelDrags = [];
  let hoveredStage = null, spaceHeld = false;
  const clearSpaceMode = () => {
    spaceHeld = false;
    for (const stage of stages) {
      stage.classList.remove('is-pan-ready');
      stage.dataset.repaintSpaceHeld = 'false';
    }
  };
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || !hoveredStage || event.altKey || event.ctrlKey || event.metaKey ||
      Number(hoveredStage.dataset.repaintZoomScale || 1) <= 1) return;
    event.preventDefault();
    spaceHeld = true;
    hoveredStage.dataset.repaintSpaceHeld = 'true';
    hoveredStage.classList.add('is-pan-ready');
  }, { signal });
  document.addEventListener('keyup', event => {
    if (event.code === 'Space' && spaceHeld) clearSpaceMode();
  }, { signal });
  window.addEventListener('blur', () => {
    clearSpaceMode();
    for (const cancel of cancelDrags) cancel();
  }, { signal });

  for (const stage of content.querySelectorAll('[data-repaint-zoom]')) {
    const image = stage.querySelector('[data-repaint-zoom-content]');
    const state = { scale: 1, x: 0, y: 0 };
    let drag = null;
    const render = () => {
      image.style.transform = 'translate3d(' + state.x + 'px, ' + state.y + 'px, 0) scale(' + state.scale + ')';
    };
    const finishDrag = event => {
      if (!drag || (event && drag.pointerId !== event.pointerId)) return;
      drag = null;
      stage.classList.remove('is-panning');
      stage.classList.toggle('is-pan-ready', spaceHeld && hoveredStage === stage);
    };
    cancelDrags.push(() => {
      if (!drag) return;
      const pointerId = drag.pointerId;
      finishDrag();
      if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
    });
    stage.addEventListener('pointerenter', () => {
      hoveredStage = stage;
      stage.classList.toggle('is-pan-ready', spaceHeld && state.scale > 1);
    });
    stage.addEventListener('pointerleave', () => {
      if (drag) return;
      if (hoveredStage === stage) hoveredStage = null;
      stage.classList.remove('is-pan-ready');
    });
    stage.addEventListener('wheel', event => {
      if (!event.deltaY) return;
      event.preventDefault();
      const bounds = stage.getBoundingClientRect();
      const width = stage.clientWidth, height = stage.clientHeight;
      const imageWidth = image.offsetWidth, imageHeight = image.offsetHeight;
      if (!width || !height || !imageWidth || !imageHeight) return;

      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 :
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? height : 1);
      const scale = Math.min(8, Math.max(1, state.scale * Math.exp(-delta * .0015)));
      if (scale === state.scale) return;

      const pointerX = event.clientX - bounds.left - width / 2;
      const pointerY = event.clientY - bounds.top - height / 2;
      const ratio = scale / state.scale;
      const maxX = Math.max(0, (imageWidth * scale - width) / 2);
      const maxY = Math.max(0, (imageHeight * scale - height) / 2);
      state.x = Math.max(-maxX, Math.min(maxX, pointerX - (pointerX - state.x) * ratio));
      state.y = Math.max(-maxY, Math.min(maxY, pointerY - (pointerY - state.y) * ratio));
      state.scale = scale;
      render();
      stage.dataset.repaintZoomScale = String(scale);
      stage.dataset.repaintZoomLabel = '滚轮缩放 · 空格拖动 · ' + Math.round(scale * 100) + '%';
      stage.classList.toggle('is-pan-ready', spaceHeld && state.scale > 1);
    }, { passive: false });
    stage.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-repaint-compare-handle]')) return;
      if (!spaceHeld || state.scale <= 1 || event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      stage.classList.add('is-panning');
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const maxX = Math.max(0, (image.offsetWidth * state.scale - stage.clientWidth) / 2);
      const maxY = Math.max(0, (image.offsetHeight * state.scale - stage.clientHeight) / 2);
      state.x = Math.max(-maxX, Math.min(maxX, state.x + event.clientX - drag.x));
      state.y = Math.max(-maxY, Math.min(maxY, state.y + event.clientY - drag.y));
      drag.x = event.clientX;
      drag.y = event.clientY;
      render();
    });
    stage.addEventListener('pointerup', finishDrag);
    stage.addEventListener('pointercancel', finishDrag);
    stage.addEventListener('lostpointercapture', finishDrag);
  }
}

function promptDetails(round, e) {
  if (!round?.prompt) return '';
  return '<details class="repaint-detail-parts"><summary>查看实际发送的提示词</summary><p class="muted">' +
    e(round.model ?? '') + '</p><pre class="repaint-detail-prompt">' + e(round.prompt) + '</pre></details>';
}

function writebackTable({ rects, parts, layout, alignment }, e) {
  const byName = new Map(parts?.map(part => [part.name, part]));
  const workByName = new Map(layout?.map(rect => [rect.name, rect]));
  const alignByName = new Map(alignment?.map(part => [part.name, part]));
  const rows = rects.map(rect => {
    const part = byName.get(rect.name);
    const work = workByName.get(rect.name);
    const offset = alignByName.get(rect.name);
    return '<tr><th scope="row">' + e(rect.name) + '</th><td>' + point(rect.x, rect.y) +
      '</td><td>' + rect.width + ' × ' + rect.height + '</td><td>' + (work ? point(work.workX, work.workY) : '—') +
      '</td><td>' + (offset ? point(offset.dx, offset.dy) : '—') + '</td><td>' + (part ? count(part.first) : '—') + '</td><td>' +
      (part ? count(part.direct + part.neighbor) : '—') + '</td><td>' +
      (part ? count(part.remaining) : '—') + '</td></tr>';
  }).join('');
  return '<details class="repaint-detail-parts"><summary>查看图集坐标和逐部件写回</summary><div class="repaint-detail-table-wrap">' +
    '<table><thead><tr><th scope="col">部件</th><th scope="col">图集原点</th><th scope="col">原 UV 尺寸</th>' +
    '<th scope="col">补绘图原点</th><th scope="col">第二轮取色偏移</th><th scope="col">第一轮</th><th scope="col">第二轮</th><th scope="col">待补</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div></details>';
}

async function bindUvInspector(panel, result, signal) {
  const { rects, workSize } = result.details;
  const output = panel.querySelector('[data-uv-source]');
  const atlas = new Image();
  atlas.src = result.url + '/round-1-atlas.png';
  const status = panel.querySelector('[data-uv-status]');
  const loadTrace = async () => {
    const response = await fetch(result.url + '/round-1-trace.bin', { signal });
    if (!response.ok) throw Error('采样记录读取失败');
    const data = await response.arrayBuffer();
    if (data.byteLength % 8) throw Error('采样记录格式无效');
    return new DataView(data);
  };
  const [data] = await Promise.all([loadTrace(), output.decode(), atlas.decode()]);
  signal.throwIfAborted();

  const canvas = panel.querySelector('[data-uv-atlas]');
  const ctx = canvas.getContext('2d');
  const sourceMarker = panel.querySelector('[data-uv-source-cursor]');
  const atlasMarker = panel.querySelector('[data-uv-atlas-cursor]');
  const sourceSurface = panel.querySelector('[data-uv-source-surface]');
  const atlasCaption = canvas.closest('figure')?.querySelector('figcaption');
  const atlasWidth = atlas.naturalWidth;
  const workArea = workSize * workSize;
  const workAtlas = new Int32Array(workArea).fill(-1);
  const workPart = new Int16Array(workArea).fill(-1);
  const workValue = new Int32Array(workArea);
  const recordCount = data.byteLength / 8;
  for (let i = 0; i < recordCount; i++) {
    const offset = i * 8;
    const atlasIndex = data.getUint32(offset, true);
    const value = data.getInt32(offset + 4, true);
    const sourceIndex = Math.abs(value) - 2;
    if (sourceIndex < 0 || sourceIndex >= workArea) continue;

    const atlasX = atlasIndex % atlasWidth;
    const atlasY = Math.floor(atlasIndex / atlasWidth);
    const partIndex = rects.findIndex(rect => atlasX >= rect.x && atlasX < rect.x + rect.width &&
      atlasY >= rect.y && atlasY < rect.y + rect.height);
    if (partIndex < 0) continue;
    if (workPart[sourceIndex] < 0 || (value < 0 && workValue[sourceIndex] >= 0)) {
      workAtlas[sourceIndex] = atlasIndex;
      workPart[sourceIndex] = partIndex;
      workValue[sourceIndex] = value;
    }
  }

  const place = (mark, x, y, w, h, written) => {
    mark.hidden = false;
    mark.style.left = (x + .5) / w * 100 + '%';
    mark.style.top = (y + .5) / h * 100 + '%';
    mark.classList.toggle('waiting', !written);
  };

  let rectIndex = -1;
  let x = Math.floor(workSize / 2), y = Math.floor(workSize / 2);
  function showPart(nextIndex) {
    if (nextIndex === rectIndex) return;
    rectIndex = nextIndex;
    const rect = rects[rectIndex];
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.parentElement.style.setProperty('--uv-aspect', rect.width / rect.height);
    ctx.drawImage(atlas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    if (atlasCaption) atlasCaption.textContent = '第一轮图集写入点 · ' + rect.name;
  }

  const searchRadius = Math.min(32, Math.max(8, Math.ceil(workSize * .04)));
  function nearestSourceIndex(sourceX, sourceY) {
    const direct = sourceY * workSize + sourceX;
    if (workPart[direct] >= 0) return direct;
    let nearest = -1;
    let nearestDistance = searchRadius * searchRadius + 1;
    const minX = Math.max(0, sourceX - searchRadius), maxX = Math.min(workSize - 1, sourceX + searchRadius);
    const minY = Math.max(0, sourceY - searchRadius), maxY = Math.min(workSize - 1, sourceY + searchRadius);
    for (let py = minY; py <= maxY; py++) {
      const dy = py - sourceY;
      for (let px = minX; px <= maxX; px++) {
        const dx = px - sourceX;
        const distance = dx * dx + dy * dy;
        if (distance >= nearestDistance) continue;
        const index = py * workSize + px;
        if (workPart[index] < 0) continue;
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function pickWork(nextX, nextY) {
    x = Math.min(workSize - 1, Math.max(0, Math.floor(nextX)));
    y = Math.min(workSize - 1, Math.max(0, Math.floor(nextY)));
    const sourceIndex = nearestSourceIndex(x, y);
    if (sourceIndex < 0) {
      place(sourceMarker, x, y, workSize, workSize, false);
      atlasMarker.hidden = true;
      status.textContent = '生成图 ' + point(x, y) + ' · 附近没有可取色的部件';
      return;
    }

    const nextPartIndex = workPart[sourceIndex];
    showPart(nextPartIndex);
    const rect = rects[nextPartIndex];
    const atlasIndex = workAtlas[sourceIndex];
    const atlasX = atlasIndex % atlasWidth;
    const atlasY = Math.floor(atlasIndex / atlasWidth);
    const localX = atlasX - rect.x, localY = atlasY - rect.y;
    const value = workValue[sourceIndex];
    const matchedX = sourceIndex % workSize, matchedY = Math.floor(sourceIndex / workSize);
    place(sourceMarker, x, y, workSize, workSize, value < 0);
    place(atlasMarker, localX, localY, rect.width, rect.height, value < 0);
    status.textContent = '生成图 ' + point(x, y) + ' · 部件 ' + rect.name + ' · 图集 ' +
      point(atlasX, atlasY) + ' · 部件内 ' + point(localX, localY) +
      (sourceIndex === y * workSize + x ? '' : ' · 最近取色点 ' + point(matchedX, matchedY)) +
      (value < 0 ? ' · 第一轮已写回' : ' · 第一轮未写回');
  }

  let activePointer = null;
  const pickPointer = event => {
    const box = sourceSurface.getBoundingClientRect();
    if (!box.width || !box.height) return;
    pickWork((event.clientX - box.left) * workSize / box.width,
      (event.clientY - box.top) * workSize / box.height);
  };
  sourceSurface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || activePointer !== null ||
      sourceSurface.closest('[data-repaint-zoom]')?.dataset.repaintSpaceHeld === 'true') return;
    event.preventDefault();
    activePointer = event.pointerId;
    sourceSurface.setPointerCapture(event.pointerId);
    sourceSurface.focus({ preventScroll: true });
    pickPointer(event);
  });
  sourceSurface.addEventListener('pointermove', event => {
    if (activePointer === event.pointerId) pickPointer(event);
  });
  const finishPointer = event => {
    if (event.pointerId === activePointer) activePointer = null;
  };
  sourceSurface.addEventListener('pointerup', finishPointer);
  sourceSurface.addEventListener('pointercancel', finishPointer);
  sourceSurface.addEventListener('lostpointercapture', finishPointer);
  sourceSurface.addEventListener('keydown', event => {
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = offsets[event.key];
    if (!move) return;
    event.preventDefault();
    const stride = event.shiftKey ? 10 : 1;
    pickWork(x + move[0] * stride, y + move[1] * stride);
  });

  let initialSource = -1;
  for (let i = 0; i < workPart.length; i++) {
    if (workPart[i] === 0) { initialSource = i; break; }
  }
  if (initialSource < 0) initialSource = workPart.findIndex(part => part >= 0);
  if (initialSource >= 0) pickWork(initialSource % workSize, Math.floor(initialSource / workSize));
  else status.textContent = '本次生成图没有可定位的 UV 取色点';
}

export function renderRepaintDetails(dialog, result, e, onReview) {
  const detail = result.details;
  const { animation, time, rects, rounds, page, options, seamCount } = detail;
  const { total, first, direct, neighbor, remaining } = result.stats;
  const hasSecond = result.taskIds.length > 1;
  const url = file => result.url + '/' + file;
  const image = (file, title) => assetFigure(url(file), title, e);
  const images = items => '<div class="repaint-detail-images">' + items.join('') + '</div>';
  const heading = (title, note) => '<div class="repaint-detail-stage-heading"><h3>' + title + '</h3><span>' + note + '</span></div>';
  const pose = animation ? animation + ' · ' + Number(time).toFixed(2) + ' s' : '绑定姿态';
  dialog.querySelector('#repaint-details-pose').textContent = pose + ' · ' + rects.length + ' 个部件 · 写回率 ' +
    ((total - remaining) / total * 100).toFixed(2) + '%';
  const uv = '<div class="repaint-detail-images">' +
     '<figure class="repaint-detail-figure"><figcaption>生成图取色点</figcaption><div class="repaint-uv-stage repaint-detail-zoom" data-repaint-zoom data-repaint-zoom-scale="1" data-repaint-zoom-label="滚轮缩放 · 空格拖动 · 100%" title="滚轮缩放，按住空格拖动" tabindex="0">' +
     '<div class="repaint-uv-surface" data-repaint-zoom-content data-uv-source-surface tabindex="0" aria-label="拖动取色点，右侧自动显示对应部件"><img data-uv-source draggable="false" data-src="' + e(url('round-1-output.png')) +
    '" alt="第一轮生成图，显示图集像素对应的取色位置"><span class="repaint-uv-cursor" data-uv-source-cursor hidden></span></div></div></figure>' +
     '<figure class="repaint-detail-figure"><figcaption>第一轮图集写入点</figcaption><div class="repaint-uv-stage repaint-detail-zoom" data-repaint-zoom data-repaint-zoom-scale="1" data-repaint-zoom-label="滚轮缩放 · 空格拖动 · 100%" title="滚轮缩放，按住空格拖动" tabindex="0">' +
     '<div class="repaint-uv-surface" data-repaint-zoom-content><canvas data-uv-atlas aria-label="当前部件的图集局部和写入点"></canvas>' +
    '<span class="repaint-uv-cursor" data-uv-atlas-cursor hidden></span></div></div></figure></div>' +
    '<p class="repaint-uv-status" data-uv-status aria-live="polite">正在读取本次 UV 采样…</p>';
  const panels = [
    heading('本次重绘选区', count(total) + ' 个候选像素') +
      images([image('round-1-input.png', '当前姿势下的组装选区'), image('selection-atlas.png', '图集选区 · ' + page)]) +
      '<div class="repaint-part-list">' + rects.map(rect => '<code>' + e(rect.name) + '</code>').join('') + '</div>',
    heading('第一轮 · Alpha 选区裁切与组装图重绘', count(first) + ' 个像素写回 · ComfyUI 按 Alpha 选区裁切并 Stitch') +
      images([compareFigure(url('round-1-input.png'), url('round-1-output.png'), 'Alpha 选区工作图', 'ComfyUI Stitch 后的模型输出', e), image('round-1-mask.png', '从输入 Alpha 派生的选区预览'), image('round-1-samples.png', '有效 UV 取色点（白色）')]) +
      promptDetails(rounds[0], e),
    heading('第一轮 · UV 写回', count(total - first) + ' 个像素未在第一轮写入') +
      '<p class="repaint-detail-note">' + (options.writebackMode === 'argb' ? 'ARGB 回写' : '仅 RGB 回写') +
      ' · 交界宽度 ' + options.seamExpand + ' px · 交界共用取色写回 ' + count(seamCount) +
      ' 个像素。拖动左侧生成图上的点，右侧自动显示对应部件和图集位置。青色表示第一轮已写回，琥珀色表示第一轮未写回或附近没有取色点。</p>' + uv,
    heading('第二轮 · 原尺寸 UV 补绘', options.secondRound
      ? '补写 ' + count(direct + neighbor) + ' · 待补 ' + count(remaining)
      : '已关闭 · 待补 ' + count(remaining)) +
      (hasSecond ? '<p class="repaint-detail-note">蒙版扩展 ' + options.maskExpand + ' px · 羽化 ' + options.maskFeather +
        ' px。原始缺口限定图集写入范围。</p>' + images([
        compareFigure(url('round-2-input.png'), url('round-2-output.png'), '原尺寸 UV 输入', '补绘模型原始输出', e),
        image('round-1-output.png', '独立参考图（第一轮输出）'),
        image('round-2-mask.png', '原始缺口遮罩'),
        image('round-2-model-mask.png', '模型输入遮罩（扩展与羽化）')
      ]) + promptDetails(rounds[1], e) + writebackTable(detail, e)
        : '<p class="repaint-detail-note">' +
          (options.secondRound
            ? '第一轮已覆盖全部候选像素，本次无需补绘。'
            : '你关闭了第二轮补绘。贴图保留第一轮结果，未覆盖像素仍待补。') +
          '</p>') +
      images([assetFigure(result.url, '最终写回图集', e)]) +
      '<div class="repaint-detail-review"><button type="button" class="button primary" data-review-idle>返回工作台播放动画</button></div>'
  ];
  const content = dialog.querySelector('#repaint-details-content');
  content.innerHTML = '<div class="repaint-detail-tabs" role="tablist" aria-label="重绘步骤">' +
    tabs.map((title, i) => '<button type="button" role="tab" id="repaint-step-' + i + '" aria-controls="repaint-panel-' + i +
      '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '"><small>0' + (i + 1) + '</small>' + title + '</button>').join('') +
    '</div>' + panels.map((html, i) => '<section class="repaint-detail-stage" role="tabpanel" id="repaint-panel-' + i +
      '" aria-labelledby="repaint-step-' + i + '" tabindex="0"' + (i ? ' hidden' : '') + '>' + html + '</section>').join('');
  const controller = new AbortController();
  dialog.addEventListener('close', () => controller.abort(), { once: true });
  bindImageZoom(content, controller.signal);
  bindRepaintCompare(content, controller.signal);

  const buttons = [...content.querySelectorAll('[role=tab]')];
  const sections = [...content.querySelectorAll('[role=tabpanel]')];
  let uvLoaded = false;
  function activate(index, focus = false) {
    for (const [i, button] of buttons.entries()) {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      sections[i].hidden = i !== index;
    }
    for (const img of sections[index].querySelectorAll('img[data-src]')) loadImage(img);
    if (index === 2 && !uvLoaded) {
      uvLoaded = true;
      bindUvInspector(sections[index], result, controller.signal).catch(() => {
        if (!controller.signal.aborted) sections[index].querySelector('[data-uv-status]').textContent = '无法读取本次 UV 采样。';
      });
    }
    dialog.scrollTop = 0;
    if (focus) buttons[index].focus();
  }
  for (const [i, button] of buttons.entries()) {
    button.addEventListener('click', () => activate(i));
    button.addEventListener('keydown', event => {
      const destinations = { ArrowLeft: (i + 3) % 4, ArrowRight: (i + 1) % 4, Home: 0, End: 3 };
      if (!(event.key in destinations)) return;
      event.preventDefault();
      activate(destinations[event.key], true);
    });
  }
  content.querySelector('[data-review-idle]').addEventListener('click', onReview);
  dialog.showModal();
  const header = dialog.querySelector('.repaint-details-header');
  const observer = new ResizeObserver(() => dialog.style.setProperty('--repaint-header-height', header.offsetHeight + 'px'));
  observer.observe(header);
  dialog.addEventListener('close', () => observer.disconnect(), { once: true });
  activate(0);
}
