import { html, icon, money, mount, api, live, num, STATUS_LABEL, TYPE_LABEL, every } from '../core.js';
import { adminShell, pageHead, loading, emptyState } from '../shared.js';
import { barChart, hbars } from '../charts.js';

const delta = (a, b) => {
  if (!b) return html`<div class="delta muted">—</div>`;
  const p = ((a - b) / b) * 100;
  return html`<div class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs yesterday</div>`;
};

export default async function dashboard(root) {
  const { page, cleanup } = adminShell(root, '/admin');
  mount(page, loading());

  const paint = (d) => {
    const t = d.today;
    const y = d.yesterday;
    const margin = t.revenue ? ((t.revenue - t.cogs) / t.revenue) * 100 : 0;
    const pipe = Object.fromEntries(d.by_status.map((s) => [s.status, s.n]));
    mount(page, html`${pageHead('Dashboard', `Live overview · ${new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      html`<a class="btn" href="/live">${icon('list', 'sm')} Live orders</a><a class="btn primary" href="/pos">${icon('plus', 'sm')} New order</a>`)}
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card kpi"><div class="label">${icon('cash', 'sm')} Revenue today</div><div class="value">${money(t.revenue)}</div>${delta(t.revenue, y.revenue)}</div>
        <div class="card kpi"><div class="label">${icon('receipt', 'sm')} Orders completed</div><div class="value">${t.orders}</div>${delta(t.orders, y.orders)}</div>
        <div class="card kpi"><div class="label">${icon('wallet', 'sm')} Avg order value</div><div class="value">${money(t.aov)}</div>${delta(t.aov, y.aov)}</div>
        <div class="card kpi"><div class="label">${icon('chart', 'sm')} Gross margin</div><div class="value">${num(margin, 1)}%</div><div class="delta muted">Food cost ${money(t.cogs)}</div></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:16px">
        ${['received', 'preparing', 'ready', 'out_for_delivery'].map((s) => html`<a class="card kpi st-${s}" href="/live" style="text-decoration:none;border-left:4px solid var(--st)"><div class="label">${STATUS_LABEL[s]}</div><div class="value">${pipe[s] || 0}</div></a>`)}
        <div class="card kpi"><div class="label">${icon('clock', 'sm')} Avg kitchen time</div><div class="value">${t.avg_prep_min ?? '—'}<span class="small muted"> min</span></div></div>
        <div class="card kpi"><div class="label">${icon('bike', 'sm')} Avg order→door</div><div class="value">${t.avg_delivery_min ?? '—'}<span class="small muted"> min</span></div></div>
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);margin-bottom:16px" data-row1>
        <div class="card"><div class="card-head"><h3>Revenue · last 14 days</h3><a class="btn sm ghost" href="/admin/reports">Reports ${icon('chevron', 'sm')}</a></div><div class="card-pad" data-rev></div></div>
        <div class="card"><div class="card-head"><h3>Top sellers · 7 days</h3></div><div class="card-pad">${d.top_items.length ? hbars(d.top_items.map((i) => ({ label: i.name, value: i.revenue, sub: `${i.qty} sold` })), { format: (v) => money(v) }) : emptyState('No sales yet')}</div></div>
      </div>
      <div class="grid g3">
        <div class="card"><div class="card-head"><h3>${icon('alert', 'sm')} Low stock</h3><a class="btn sm ghost" href="/admin/inventory">Inventory</a></div>
          <div class="card-pad">${d.low_stock.length ? html`<ul class="list-plain alert-list">${d.low_stock.map((s) => html`<li><span>${s.name}</span><span class="badge bad">${num(s.stock, 2)} / ${num(s.reorder_level)} ${s.unit}</span></li>`)}</ul>` : html`<div class="banner ok">${icon('check')} All ingredients above reorder level</div>`}</div></div>
        <div class="card"><div class="card-head"><h3>${icon('bike', 'sm')} Riders</h3><span class="small muted">${d.on_shift} staff on shift</span></div>
          <div class="card-pad"><ul class="list-plain alert-list">${d.riders.map((r) => html`<li><span>${r.name} ${r.on_shift ? html`<span class="badge ok">on shift</span>` : html`<span class="badge">off</span>`}</span><span class="small">${r.active ? html`<span class="badge violet">${r.active} on road</span>` : ''} ${r.done_today} today</span></li>`)}</ul></div></div>
        <div class="card"><div class="card-head"><h3>Channel mix · 7 days</h3></div><div class="card-pad">${hbars(d.by_type.map((x) => ({ label: TYPE_LABEL[x.type], value: x.n, sub: money(x.revenue) })), { format: (v) => `${v} orders` })}
          <h4 style="margin:16px 0 4px" class="small muted">Orders by hour · 7 days</h4><div data-hours></div></div></div>
      </div>`);
    barChart(page.querySelector('[data-rev]'), d.series.map((s) => ({ label: s.day.slice(8), value: s.revenue || 0, tip: new Date(`${s.day}T00:00`).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' }) + ` · ${s.orders} orders` })), { format: (v) => money(v), title: 'Revenue last 14 days' });
    const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, value: d.by_hour.find((x) => x.hour === h)?.n || 0, tip: `${h}:00–${h}:59` })).filter((x, i) => i >= 11 || x.value);
    barChart(page.querySelector('[data-hours]'), hours, { height: 150, format: (v) => `${v} orders`, title: 'Orders by hour' });
    if (matchMedia('(max-width: 980px)').matches) page.querySelector('[data-row1]').style.gridTemplateColumns = 'minmax(0,1fr)';
  };
  const load = async () => paint(await api('/reports/dashboard'));
  await load();
  const reload = (() => { let t; return () => { clearTimeout(t); t = setTimeout(load, 800); }; })();
  const offs = [cleanup, live('order:closed', reload), live('order:new', reload), live('stock:low', reload), every(60000, load)];
  return () => offs.forEach((f) => f());
}
