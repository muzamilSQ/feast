import { html, money, mount, on, $, api, download, num } from '../core.js';
import { adminShell, pageHead, loading, emptyState } from '../shared.js';
import { barChart } from '../charts.js';
import { rangeBar, wireRange, defaultRange, csvBtn } from './common.js';

export default async function reports(root) {
  const { page, cleanup } = adminShell(root, '/admin/reports');
  let tab = 'sales';
  let group = 'day';
  let sortKey = 'revenue';
  const r = defaultRange('30d');
  mount(page, html`${pageHead('Reports', 'Sales, item profitability (revenue minus ingredient cost) and profit & loss.', csvBtn())}
    <div class="tabs"><button data-tab="sales" class="on">Sales</button><button data-tab="items">Item profitability</button><button data-tab="pnl">Profit & loss</button></div>
    <div class="toolbar">${rangeBar(r)}<div class="seg" data-groupbar>${['day', 'week', 'month'].map((g) => html`<button data-group="${g}" class="${g === group ? 'on' : ''}">By ${g}</button>`)}</div></div>
    <div data-body>${loading()}</div>`);
  const body = () => $('[data-body]', page);
  const qs = () => `from=${r.from}&to=${r.to}&group=${group}`;

  const sales = async () => {
    const d = await api(`/reports/sales?${qs()}`);
    const t = d.rows.reduce((s, x) => { for (const k of ['orders', 'gross_sales', 'discounts', 'delivery_fees', 'tax', 'revenue', 'cogs', 'gross_profit', 'cash', 'non_cash']) s[k] = (s[k] || 0) + (x[k] || 0); return s; }, {});
    if (!d.rows.length) return mount(body(), emptyState('No completed sales in this period', 'chart'));
    mount(body(), html`<div class="grid g4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Revenue</div><div class="value">${money(t.revenue)}</div><div class="delta muted">${t.orders} orders</div></div>
      <div class="card kpi"><div class="label">Avg order value</div><div class="value">${money(t.revenue / t.orders)}</div></div>
      <div class="card kpi"><div class="label">Food cost</div><div class="value">${money(t.cogs)}</div><div class="delta muted">${num((t.cogs / (t.gross_sales - t.discounts)) * 100, 1)}% of food sales</div></div>
      <div class="card kpi"><div class="label">Gross profit (food)</div><div class="value">${money(t.gross_profit)}</div></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Revenue by ${group}</h3></div><div class="card-pad" data-chart></div></div>
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Period</th><th class="num">Orders</th><th class="num">Delivery</th><th class="num">Takeaway</th><th class="num">Dine-in</th><th class="num">Food sales</th><th class="num">Discounts</th><th class="num">Delivery fees</th><th class="num">Revenue</th><th class="num">Cash</th><th class="num">Card/wallet</th><th class="num">Food cost</th><th class="num">Gross profit</th></tr></thead><tbody>
      ${d.rows.map((x) => html`<tr><td class="nowrap">${x.period}</td><td class="num">${x.orders}</td><td class="num">${x.delivery}</td><td class="num">${x.takeaway}</td><td class="num">${x.dine_in}</td><td class="num">${money(x.gross_sales)}</td><td class="num">${money(x.discounts)}</td><td class="num">${money(x.delivery_fees)}</td><td class="num"><b>${money(x.revenue)}</b></td><td class="num">${money(x.cash)}</td><td class="num">${money(x.non_cash)}</td><td class="num">${money(x.cogs)}</td><td class="num">${money(x.gross_profit)}</td></tr>`)}
      </tbody><tfoot><tr><td>Total</td><td class="num">${t.orders}</td><td></td><td></td><td></td><td class="num">${money(t.gross_sales)}</td><td class="num">${money(t.discounts)}</td><td class="num">${money(t.delivery_fees)}</td><td class="num">${money(t.revenue)}</td><td class="num">${money(t.cash)}</td><td class="num">${money(t.non_cash)}</td><td class="num">${money(t.cogs)}</td><td class="num">${money(t.gross_profit)}</td></tr></tfoot></table></div></div>`);
    barChart($('[data-chart]', page), d.rows.map((x) => ({ label: group === 'day' ? x.period.slice(5) : x.period, value: x.revenue, tip: `${x.period} · ${x.orders} orders` })),
      { format: (v) => money(v), labelEvery: Math.ceil(d.rows.length / 12), title: 'Revenue' });
  };
  const items = async () => {
    const d = await api(`/reports/items?${qs()}`);
    const rows = [...d.rows].sort((a, b) => b[sortKey] - a[sortKey]);
    const th = (k, l) => html`<th class="num" style="cursor:pointer" data-sort="${k}">${l}${sortKey === k ? ' ▾' : ''}</th>`;
    mount(body(), rows.length ? html`<p class="muted small" style="margin-top:0">Margin = (revenue − ingredient cost) ÷ revenue. Items under 50% are worth reviewing for price or portion size.</p>
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Category</th>${th('qty', 'Sold')}${th('revenue', 'Revenue')}${th('cogs', 'Ingredient cost')}${th('profit', 'Profit')}${th('margin', 'Margin')}</tr></thead><tbody>
      ${rows.map((x) => html`<tr><td><b>${x.name}</b></td><td class="small muted">${x.category || ''}</td><td class="num">${x.qty}</td><td class="num">${money(x.revenue)}</td><td class="num">${money(x.cogs)}</td><td class="num">${money(x.profit)}</td><td class="num"><span class="badge ${x.margin >= 65 ? 'ok' : x.margin >= 50 ? 'warn' : 'bad'}">${x.margin}%</span></td></tr>`)}</tbody></table></div></div>` : emptyState('No item sales in this period'));
  };
  const pnl = async () => {
    const d = await api(`/reports/pnl?${qs()}`);
    const line = (l, v, opts = {}) => html`<tr style="${opts.strong ? 'font-weight:800' : ''}"><td style="padding-left:${opts.indent ? 30 : 14}px">${l}</td><td class="num" style="color:${opts.neg ? 'var(--bad)' : 'inherit'}">${opts.neg && v ? '− ' : ''}${money(Math.abs(v))}</td></tr>`;
    mount(body(), html`<div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h3>Profit & loss · ${r.from} to ${r.to}</h3></div><table class="table"><tbody>
        ${line('Food sales', d.sales.gross_sales)}${line('Discounts', d.sales.discounts, { neg: true, indent: true })}${line('Delivery fees collected', d.sales.delivery_fees, { indent: true })}
        ${line('Net sales (excl. tax)', d.net_sales, { strong: true })}
        ${line('Ingredient cost of goods sold', d.sales.cogs, { neg: true, indent: true })}${line('Waste & spoilage', d.waste, { neg: true, indent: true })}
        ${line('Gross profit', d.gross_profit, { strong: true })}
        ${d.expenses.map((e) => line(e.category, e.amount, { neg: true, indent: true }))}
        ${line('Payroll & advances paid', d.payroll, { neg: true, indent: true })}
        <tr style="font-weight:800;font-size:17px;background:var(--surface-2)"><td>Net profit</td><td class="num" style="color:${d.net_profit >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money(d.net_profit)}</td></tr>
      </tbody></table></div>
      <div class="stack">
        <div class="card kpi"><div class="label">Food cost %</div><div class="value">${d.food_cost_pct}%</div><div class="delta muted">Industry target for fast food: 28–35%</div></div>
        <div class="card kpi"><div class="label">Tax collected (liability)</div><div class="value">${money(d.sales.tax)}</div></div>
        <div class="card kpi"><div class="label">Cash spent on stock purchases</div><div class="value">${money(d.purchases)}</div><div class="delta muted">Cash flow, not P&L: stock is expensed as it's used (COGS)</div></div>
        <div class="card kpi"><div class="label">Rider commissions (in payroll)</div><div class="value">${money(d.commissions)}</div></div>
      </div></div>`);
  };
  const load = async () => {
    mount(body(), loading());
    $('[data-groupbar]', page).style.display = tab === 'sales' ? '' : 'none';
    if (tab === 'sales') await sales(); else if (tab === 'items') await items(); else await pnl();
  };
  await load();
  wireRange(page, r, load);
  const offs = [
    cleanup,
    on(page, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; page.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); load(); }),
    on(page, 'click', '[data-group]', (_e, b) => { group = b.dataset.group; page.querySelectorAll('[data-group]').forEach((x) => x.classList.toggle('on', x === b)); load(); }),
    on(page, 'click', '[data-sort]', (_e, b) => { sortKey = b.dataset.sort; items(); }),
    on(page, 'click', '[data-csv]', () => {
      if (tab === 'sales') download(`/reports/sales?${qs()}&format=csv`, `sales-${r.from}-${r.to}.csv`);
      else download(`/reports/transactions?from=${r.from}&to=${r.to}&format=csv`, `ledger-${r.from}-${r.to}.csv`);
    }),
  ];
  return () => offs.forEach((x) => x());
}
