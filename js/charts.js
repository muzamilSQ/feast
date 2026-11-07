// Minimal single-series SVG charts with hover tooltips. No dependencies.
import { html, raw, mount, esc } from './core.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const short = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`);

/**
 * Vertical bar chart. rows: [{ label, value, tip? }]. One series, so no legend (the card title names it).
 * Bars have 4px rounded data-ends anchored to the baseline, 2px gaps, recessive grid, hover tooltip.
 */
export function barChart(el, rows, { height = 220, format = short, labelEvery, title = 'Chart' } = {}) {
  mount(el, html`<div class="chart"><div class="chart-svg"></div><div class="chart-tip" hidden></div></div>
    <details class="small muted" style="margin-top:6px"><summary>View as table</summary><table class="table"><tbody>${rows.map((r) => html`<tr><td>${r.tip || r.label}</td><td class="num">${format(r.value)}</td></tr>`)}</tbody></table></details>`);
  const chart = el.querySelector('.chart');
  const holder = el.querySelector('.chart-svg');
  const tip = el.querySelector('.chart-tip');
  const pad = { l: 44, r: 8, t: 12, b: 26 };
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(...rows.map((r) => r.value), 0));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  let geo = null;

  // Drawn at the container's real pixel width so text and bar sizes never scale with the page.
  const draw = () => {
    const W = Math.max(240, Math.round(chart.clientWidth || 640));
    const iw = W - pad.l - pad.r;
    const slot = iw / Math.max(rows.length, 1);
    const bw = Math.max(2, Math.min(44, slot * 0.72));
    const every = labelEvery || Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(iw / 46))));
    geo = { slot, W };
    const bar = (r, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      const top = y(r.value);
      const h = pad.t + ih - top;
      const rad = Math.min(4, h, bw / 2);
      const d = h <= 0 ? '' : `M${x},${pad.t + ih} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + bw - rad} Q${x + bw},${top} ${x + bw},${top + rad} V${pad.t + ih} Z`;
      return `<path class="bar" data-i="${i}" d="${d}"/>`;
    };
    holder.innerHTML = `<svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}">
      <g class="axis">${ticks.map((t) => `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(short(t))}</text>`).join('')}</g>
      ${rows.map(bar).join('')}
      <g class="axis">${rows.map((r, i) => (i % every === 0 ? `<text x="${pad.l + i * slot + slot / 2}" y="${height - 8}" text-anchor="middle">${esc(r.label)}</text>` : '')).join('')}</g>
      ${rows.map((_, i) => `<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}"/>`).join('')}
    </svg>`;
  };
  draw();
  let lastW = chart.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!chart.isConnected) { ro.disconnect(); return; }
    if (Math.abs(chart.clientWidth - lastW) < 2) return;
    lastW = chart.clientWidth; tip.hidden = true; draw();
  });
  ro.observe(chart);

  chart.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.hit');
    if (!hit) return;
    const i = Number(hit.dataset.i);
    const r = rows[i];
    holder.querySelectorAll('.bar').forEach((b, j) => b.classList.toggle('dim', j !== i));
    tip.hidden = false;
    tip.innerHTML = String(html`<span>${r.tip || r.label}</span><b>${format(r.value)}</b>`);
    const x = pad.l + i * geo.slot + geo.slot / 2;
    tip.style.left = `${Math.min(Math.max(x, 70), geo.W - 70)}px`;
    tip.style.top = `${y(r.value)}px`;
  });
  chart.addEventListener('mouseleave', () => { tip.hidden = true; holder.querySelectorAll('.bar').forEach((b) => b.classList.remove('dim')); });
}

/** Horizontal ranked bars, direct-labelled (no legend needed). rows: [{ label, value, sub? }] */
export function hbars(rows, { format = short } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return html`${rows.map((r) => html`<div class="hbar-row" title="${r.label}: ${format(r.value)}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.label}${r.sub ? html` <span class="muted tiny">${r.sub}</span>` : ''}</span>
    <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></div></div><b class="num small">${format(r.value)}</b></div>`)}`;
}
