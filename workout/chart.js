// A single-series line chart drawn as SVG: the progress of one exercise over
// time. Thin line, ringed dots, a faint area wash, hairline grid, the latest
// value labeled at the end, and a crosshair tooltip on touch, hover or the
// arrow keys. The session table under the chart carries every value too.

import { niceTicks } from './logic.js';

const SVG = 'http://www.w3.org/2000/svg';
const HEIGHT = 200;
const MARGIN = { top: 22, right: 14, bottom: 26, left: 44 };

function svgEl(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

/**
 * Draws the chart into `host`. `points` are { t, value, detail } oldest first.
 * `formatValue` turns a value into text such as "84.2 kg". Returns a function
 * that removes the resize listener.
 */
export function drawLineChart(host, { points, formatValue, formatTick, formatDate, label }) {
  let frame = 0;
  const render = () => {
    frame = 0;
    paint(host, { points, formatValue, formatTick, formatDate, label });
  };
  render();
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(render);
  });
  observer.observe(host);
  return () => observer.disconnect();
}

function paint(host, { points, formatValue, formatTick, formatDate, label }) {
  const width = Math.max(260, Math.round(host.clientWidth));
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const bottom = MARGIN.top + plotH;

  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t) => (t1 === t0 ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - t0) / (t1 - t0)) * plotW);
  const y = (v) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const xy = points.map((p) => [x(p.t), y(p.value)]);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    role: 'img',
    tabindex: '0',
    'aria-label': label,
  });

  for (const tick of ticks) {
    svgEl('line', { class: tick === yMin ? 'c-axis' : 'c-grid', x1: MARGIN.left, x2: width - MARGIN.right, y1: y(tick), y2: y(tick) }, svg);
    const text = svgEl('text', { class: 'c-tick', x: MARGIN.left - 8, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg);
    text.textContent = formatTick(tick);
  }

  const first = svgEl('text', { class: 'c-tick', x: MARGIN.left, y: HEIGHT - 6, 'text-anchor': points.length > 1 ? 'start' : 'middle' }, svg);
  first.textContent = formatDate(t0);
  if (points.length > 1) {
    first.setAttribute('x', xy[0][0]);
    const last = svgEl('text', { class: 'c-tick', x: xy[xy.length - 1][0], y: HEIGHT - 6, 'text-anchor': 'end' }, svg);
    last.textContent = formatDate(t1);
  } else {
    first.setAttribute('x', xy[0][0]);
  }

  if (points.length > 1) {
    const line = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    svgEl('path', { class: 'c-area', d: `${line}L${xy[xy.length - 1][0].toFixed(1)},${bottom}L${xy[0][0].toFixed(1)},${bottom}Z` }, svg);
    svgEl('path', { class: 'c-line', d: line }, svg);
  }

  const cross = svgEl('line', { class: 'c-cross', y1: MARGIN.top - 6, y2: bottom, visibility: 'hidden' }, svg);
  const dots = xy.map(([px, py]) => svgEl('circle', { class: 'c-dot', cx: px, cy: py, r: 4 }, svg));

  // Direct label on the latest value only.
  const [endX, endY] = xy[xy.length - 1];
  const endLabel = svgEl('text', {
    class: 'c-end',
    x: endX,
    y: endY - 12,
    'text-anchor': points.length > 1 ? 'end' : 'middle',
  }, svg);
  endLabel.textContent = formatValue(points[points.length - 1].value);

  const hit = svgEl('rect', { class: 'c-hit', x: MARGIN.left - 12, y: 0, width: plotW + 24, height: HEIGHT }, svg);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.replaceChildren(svg, tip);

  let active = -1;
  function show(index) {
    if (index === active) return;
    if (active >= 0) {
      dots[active].classList.remove('is-active');
      dots[active].setAttribute('r', 4);
    }
    active = index;
    if (index < 0) {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
      endLabel.removeAttribute('visibility');
      return;
    }
    const [px, py] = xy[index];
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    dots[index].classList.add('is-active');
    dots[index].setAttribute('r', 6);
    endLabel.setAttribute('visibility', index === points.length - 1 ? 'hidden' : 'visible');

    const point = points[index];
    const value = document.createElement('strong');
    value.textContent = formatValue(point.value);
    const date = document.createElement('span');
    date.textContent = formatDate(point.t, true);
    const detail = document.createElement('span');
    detail.textContent = point.detail;
    tip.replaceChildren(value, date, detail);
    tip.hidden = false;

    // Keep the tooltip inside the chart, beside the point.
    const scale = host.clientWidth / width;
    const tipW = tip.offsetWidth;
    let left = px * scale + 12;
    if (left + tipW > host.clientWidth) left = px * scale - tipW - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, py * scale - 30)}px`;
  }

  function nearest(clientX) {
    const box = svg.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * width;
    let best = 0;
    for (let i = 1; i < xy.length; i += 1) {
      if (Math.abs(xy[i][0] - sx) < Math.abs(xy[best][0] - sx)) best = i;
    }
    return best;
  }

  hit.addEventListener('pointermove', (event) => show(nearest(event.clientX)));
  hit.addEventListener('pointerdown', (event) => show(nearest(event.clientX)));
  hit.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') show(-1);
  });
  svg.addEventListener('focus', () => show(points.length - 1));
  svg.addEventListener('blur', () => show(-1));
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(Math.max(0, active - 1));
    else if (event.key === 'ArrowRight') show(Math.min(points.length - 1, active + 1));
    else if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(points.length - 1);
    else if (event.key === 'Escape') svg.blur();
    else return;
    event.preventDefault();
  });
}
