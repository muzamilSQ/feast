import { html, money, mount, on, $, api, auth, toast, busy, confirmDialog, fmtTime, localISO, printHTML, TYPE_LABEL, num } from '../core.js';
import { adminShell, staffShell, pageHead, loading, emptyState } from '../shared.js';
import { barChart, hbars } from '../charts.js';

const LABEL = {
  cash: 'Cash', card: 'Card', wallet: 'JazzCash / Easypaisa', online: 'Online', pos: 'Counter (POS)', phone: 'Phone', whatsapp: 'WhatsApp',
  sale: 'Sales', refund: 'Refunds', purchase: 'Stock purchases', expense: 'Expenses', payroll: 'Salaries & advances', ...TYPE_LABEL,
};
const label = (k) => LABEL[k] || k;

/** End-of-day close: sales summary, cash reconciliation and rider cash hand-in. Managers and cashiers. */
export default async function dayClose(root) {
  const isMgr = ['admin', 'manager'].includes(auth.user.role);
  let page; let cleanup;
  if (isMgr) ({ page, cleanup } = adminShell(root, '/admin/close'));
  else {
    const s = staffShell(root, { active: '/admin/close' });
    cleanup = s.cleanup;
    page = s.main; page.classList.add('page');
  }
  let day = localISO();
  let data;

  mount(page, html`${pageHead('Day close', 'End-of-day summary: what was sold, how it was paid, and the cash that should be in the till.',
    html`<input class="input" type="date" data-day value="${day}" max="${day}" aria-label="Business day" style="width:auto"><button class="btn" data-print>Print Z-report</button>`)}
    <div data-body>${loading()}</div>`);
  const body = () => $('[data-body]', page);

  const breakdown = (rows) => (rows.length ? hbars(rows.map((r) => ({ label: label(r.k), sub: `${r.n} orders`, value: r.v })), { format: (v) => money(v) }) : html`<div class="muted small">No sales.</div>`);

  async function load() {
    mount(body(), loading());
    data = await api(`/reports/day-close?date=${day}`);
    const d = data;
    const t = d.totals;
    const ridersDue = d.riders.filter((r) => r.cash_due > 0);
    mount(body(), html`
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card kpi"><div class="label">Revenue</div><div class="value">${money(t.revenue)}</div><div class="delta muted">${t.orders} orders closed</div></div>
        <div class="card kpi"><div class="label">Average order</div><div class="value">${money(t.orders ? t.revenue / t.orders : 0)}</div><div class="delta muted">${t.discounts ? `${money(t.discounts)} in discounts` : 'No discounts'}</div></div>
        <div class="card kpi"><div class="label">Food cost</div><div class="value">${num(t.food_sales ? (t.cogs / (t.food_sales - t.discounts)) * 100 : 0, 1)}%</div><div class="delta muted">${money(t.cogs)} of ingredients</div></div>
        <div class="card kpi"><div class="label">Cancelled · still open</div><div class="value">${d.cancelled.n} · ${d.open.n}</div><div class="delta muted">${money(d.cancelled.v)} cancelled</div></div>
      </div>

      <div class="grid close-grid" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><h3>Cash in the till</h3></div><div class="card-pad">
          <table class="table compact"><tbody>
            <tr><td>Cash received (sales)</td><td class="num">${money(d.cash.in)}</td></tr>
            <tr><td>Cash paid out (expenses, purchases, wages)</td><td class="num amt-neg">− ${money(d.cash.out)}</td></tr>
            <tr><td>Rider cash not handed in yet</td><td class="num amt-neg">− ${money(d.cash.rider_pending)}</td></tr>
            <tr class="grand"><td>Expected cash in till</td><td class="num">${money(d.cash.expected)}</td></tr>
          </tbody></table>
          <label class="field" style="margin-top:14px"><span>Counted cash</span>
            <div class="row"><input class="input" type="number" min="0" step="10" data-count placeholder="Count the drawer and enter the total"><span class="badge" data-diff hidden></span></div></label>
        </div></div>

        <div class="card"><div class="card-head"><h3>Rider cash</h3><span class="muted small">${ridersDue.length ? `${money(ridersDue.reduce((s, r) => s + r.cash_due, 0))} outstanding` : 'All settled'}</span></div>
          ${d.riders.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Rider</th><th class="num">Deliveries</th><th class="num">Commission</th><th class="num">Cash to hand in</th><th></th></tr></thead><tbody>
          ${d.riders.map((r) => html`<tr><td><b>${r.name}</b></td><td class="num">${r.deliveries}</td><td class="num">${money(r.commission)}</td>
            <td class="num">${r.cash_due ? html`<b>${money(r.cash_due)}</b> <span class="muted tiny">(${r.due_orders})</span>` : html`<span class="badge ok">Settled</span>`}</td>
            <td class="right">${r.cash_due ? html`<button class="btn sm ok" data-settle="${r.id}" data-name="${r.name}" data-amount="${r.cash_due}">Received</button>` : ''}</td></tr>`)}
          </tbody></table></div>` : emptyState('No riders')}</div>
      </div>

      <div class="grid g3" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><h3>By payment method</h3></div><div class="card-pad">${breakdown(d.byMethod)}</div></div>
        <div class="card"><div class="card-head"><h3>By order type</h3></div><div class="card-pad">${breakdown(d.byType)}</div></div>
        <div class="card"><div class="card-head"><h3>By channel</h3></div><div class="card-pad">${breakdown(d.bySource)}</div></div>
      </div>

      <div class="grid close-grid" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><h3>Sales by hour</h3></div><div class="card-pad" data-hours></div></div>
        <div class="card"><div class="card-head"><h3>Best sellers today</h3></div><div class="card-pad">${d.top.length ? hbars(d.top.map((x) => ({ label: x.name, sub: money(x.v), value: x.qty })), { format: (v) => `${v} sold` }) : html`<div class="muted small">Nothing sold yet.</div>`}</div></div>
      </div>

      <div class="grid close-grid">
        <div class="card"><div class="card-head"><h3>Ledger movements</h3></div>
          ${d.ledger.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Method</th><th class="num">Entries</th><th class="num">Amount</th></tr></thead><tbody>
          ${d.ledger.map((l) => html`<tr><td>${label(l.type)}</td><td>${label(l.method)}</td><td class="num">${l.n}</td><td class="num ${l.v < 0 ? 'amt-neg' : 'amt-pos'}">${l.v < 0 ? '− ' : '+ '}${money(Math.abs(l.v))}</td></tr>`)}
          </tbody></table></div>` : emptyState('No ledger entries on this day', 'receipt')}</div>
        <div class="card"><div class="card-head"><h3>Staff on duty</h3></div>
          ${d.staff.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>In</th><th>Out</th></tr></thead><tbody>
          ${d.staff.map((s) => html`<tr><td>${s.name}</td><td class="small muted" style="text-transform:capitalize">${s.role}</td><td>${fmtTime(s.clock_in)}</td><td>${s.clock_out ? fmtTime(s.clock_out) : html`<span class="badge ok dot">On shift</span>`}</td></tr>`)}
          </tbody></table></div>` : emptyState('Nobody clocked in', 'users')}</div>
      </div>`);

    const hours = Array.from({ length: 24 }, (_, h) => d.hours.find((x) => x.h === h) || { h, n: 0, v: 0 });
    const first = hours.findIndex((x) => x.n); const last = 23 - [...hours].reverse().findIndex((x) => x.n);
    const span = first < 0 ? [] : hours.slice(Math.max(0, first - 1), Math.min(24, last + 2));
    if (span.length) barChart($('[data-hours]', page), span.map((x) => ({ label: `${x.h % 12 || 12}${x.h < 12 ? 'a' : 'p'}`, value: x.v, tip: `${x.h}:00–${x.h}:59 · ${x.n} orders` })), { height: 200, format: (v) => money(v), title: 'Sales by hour' });
    else mount($('[data-hours]', page), html`<div class="muted small">No sales yet.</div>`);
  }

  const zReport = () => {
    const d = data; const t = d.totals;
    const row = (l, v) => html`<tr><td>${l}</td><td style="text-align:right">${v}</td></tr>`;
    return html`<div class="receipt"><h2 style="text-align:center;margin:0">FEAST</h2><div style="text-align:center">Z-REPORT · ${d.date}</div><div style="text-align:center">Printed ${new Date().toLocaleString('en-PK')}</div><hr>
      <table style="width:100%">${row('Orders closed', t.orders)}${row('Food sales', money(t.food_sales))}${row('Discounts', `− ${money(t.discounts)}`)}${row('Delivery fees', money(t.delivery_fees))}${row('Tax', money(t.tax))}${row('REVENUE', money(t.revenue))}</table><hr>
      <b>Payments</b><table style="width:100%">${d.byMethod.map((m) => row(`${label(m.k)} (${m.n})`, money(m.v)))}</table><hr>
      <b>Order types</b><table style="width:100%">${d.byType.map((m) => row(`${label(m.k)} (${m.n})`, money(m.v)))}</table><hr>
      <b>Cash</b><table style="width:100%">${row('Cash in', money(d.cash.in))}${row('Cash out', `− ${money(d.cash.out)}`)}${row('Rider cash pending', `− ${money(d.cash.rider_pending)}`)}${row('Expected in till', money(d.cash.expected))}</table><hr>
      ${row('Cancelled', `${d.cancelled.n} · ${money(d.cancelled.v)}`)}
      <div style="margin-top:24px">Counted by: ____________________</div><div style="margin-top:14px">Manager: ____________________</div></div>`;
  };

  await load();
  const dayInput = $('[data-day]', page);
  const onDay = () => { if (dayInput.value) { day = dayInput.value; load(); } };
  dayInput.addEventListener('change', onDay);
  const offs = [
    cleanup,
    () => dayInput.removeEventListener('change', onDay),
    on(page, 'input', '[data-count]', (_e, inp) => {
      const b = $('[data-diff]', page);
      if (inp.value === '') { b.hidden = true; return; }
      const diff = Number(inp.value) - data.cash.expected;
      b.hidden = false;
      b.className = `badge ${Math.abs(diff) < 1 ? 'ok' : diff > 0 ? 'info' : 'bad'}`;
      b.textContent = Math.abs(diff) < 1 ? 'Balanced' : diff > 0 ? `Over by ${money(diff)}` : `Short by ${money(-diff)}`;
    }),
    on(page, 'click', '[data-settle]', async (_e, b) => {
      if (!(await confirmDialog(`Confirm you received ${money(Number(b.dataset.amount))} in cash from ${b.dataset.name}.`, { title: 'Rider cash hand-in', ok: 'Cash received' }))) return;
      const r = await busy(b, () => api(`/reports/riders/${b.dataset.settle}/settle`, { method: 'POST' }));
      toast(`${money(r.amount)} received from ${b.dataset.name}`, 'ok');
      load();
    }),
    on(page, 'click', '[data-print]', () => data && printHTML(zReport())),
  ];
  return () => offs.forEach((f) => f());
}
