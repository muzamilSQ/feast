import { html, icon, daysAgo, localISO } from '../core.js';

export const PRESETS = [['today', 'Today', 0], ['7d', '7 days', 6], ['30d', '30 days', 29], ['90d', '90 days', 89]];
export function rangeBar(r) {
  return html`<div class="row wrap" data-range>
    <div class="seg">${PRESETS.map(([k, l]) => html`<button type="button" data-preset="${k}" class="${r.preset === k ? 'on' : ''}">${l}</button>`)}</div>
    <input class="input sm" type="date" name="from" value="${r.from}" style="width:auto" aria-label="From"> <span class="muted">to</span>
    <input class="input sm" type="date" name="to" value="${r.to}" style="width:auto" aria-label="To"></div>`;
}
/** Wire a rangeBar inside container; calls onChange(range) */
export function wireRange(container, r, onChange) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const p = PRESETS.find((x) => x[0] === b.dataset.preset);
    Object.assign(r, { preset: p[0], from: daysAgo(p[2]), to: localISO() });
    onChange(r);
  });
  container.addEventListener('change', (e) => {
    if (!e.target.closest('[data-range]') || !['from', 'to'].includes(e.target.name)) return;
    r[e.target.name] = e.target.value; r.preset = null;
    onChange(r);
  });
}
export const defaultRange = (preset = '30d') => { const p = PRESETS.find((x) => x[0] === preset); return { preset, from: daysAgo(p[2]), to: localISO() }; };
export const csvBtn = (label = 'Export CSV') => html`<button class="btn" data-csv>${icon('download', 'sm')} ${label}</button>`;
