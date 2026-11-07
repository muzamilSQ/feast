import { html, raw, icon, money, mount, on, $, api, toast, modal, busy, confirmDialog, formData, fmtDateTime, download, debounce, localISO, live } from '../core.js';
import { adminShell, pageHead, loading, emptyState, openOrder } from '../shared.js';
import { rangeBar, wireRange, defaultRange, csvBtn } from './common.js';

const TX_BADGE = { sale: 'ok', refund: 'bad', purchase: 'info', expense: 'warn', payroll: 'violet' };

export default async function finance(root) {
  const { page, cleanup } = adminShell(root, '/admin/finance');
  let tab = 'ledger';
  const r = defaultRange('7d');
  const f = { type: '', q: '' };
  mount(page, html`${pageHead('Finance & ledger', 'The central ledger: every delivered order, refund, purchase, expense and salary is recorded here automatically.',
    html`<button class="btn primary" data-addexp>${icon('plus', 'sm')} Expense</button>${csvBtn()}`)}
    <div class="tabs"><button data-tab="ledger" class="on">Ledger</button><button data-tab="exp">Expenses</button></div>
    <div class="toolbar" data-ledgerbar>${rangeBar(r)}
      <select class="input sm" data-type style="width:auto"><option value="">All types</option>${Object.keys(TX_BADGE).map((t) => html`<option>${t}</option>`)}</select>
      <input class="input sm" type="search" data-q placeholder="Search reference / description" style="width:240px"></div>
    <div data-body>${loading()}</div>`);
  let exp;
  const ledger = async () => {
    const d = await api(`/reports/transactions?${new URLSearchParams({ from: r.from, to: r.to, ...f })}`);
    const tot = Object.fromEntries(d.totals.map((t) => [t.type, t]));
    const net = d.totals.reduce((s, t) => s + t.amount, 0);
    mount($('[data-body]', page), html`<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:16px">
      ${['sale', 'refund', 'purchase', 'expense', 'payroll'].map((t) => html`<div class="card kpi"><div class="label"><span class="badge ${TX_BADGE[t]}">${t}</span></div><div class="value" style="font-size:22px">${money(tot[t]?.amount || 0)}</div><div class="tiny muted">${tot[t]?.n || 0} entries</div></div>`)}
      <div class="card kpi"><div class="label">Net cash flow</div><div class="value" style="font-size:22px;color:${net >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money(net)}</div></div></div>
      <div class="card"><div class="table-wrap">${d.rows.length ? html`<table class="table"><thead><tr><th>#</th><th>When</th><th>Type</th><th>Description</th><th>Reference</th><th>Method</th><th>By</th><th class="num">Amount</th></tr></thead><tbody>
      ${d.rows.map((t) => html`<tr class="${t.order_id ? 'clickable' : ''}" ${t.order_id ? raw(`data-order="${t.order_id}"`) : ''}><td class="tiny muted">${t.id}</td><td class="small">${fmtDateTime(t.created_at)}</td><td><span class="badge ${TX_BADGE[t.type]}">${t.type}</span></td><td>${t.description}</td><td class="small">${t.ref || ''}</td><td class="small">${t.method || ''}</td><td class="small">${t.employee || '—'}</td>
        <td class="num" style="color:${t.amount >= 0 ? 'var(--ok)' : 'var(--bad)'};font-weight:700">${t.amount >= 0 ? '+' : '−'} ${money(Math.abs(t.amount))}</td></tr>`)}</tbody></table>` : emptyState('No ledger entries for these filters', 'cash')}</div></div>`);
  };
  const expenses = async () => {
    exp = await api('/staff/expenses');
    mount($('[data-body]', page), html`<div class="card"><div class="table-wrap">${exp.rows.length ? html`<table class="table"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Recorded by</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${exp.rows.map((x) => html`<tr><td>${x.date}</td><td><span class="badge">${x.category}</span></td><td>${x.note || ''}</td><td class="small">${x.employee_name || ''}</td><td class="num">${money(x.amount)}</td><td class="right"><button class="btn sm ghost danger" data-delexp="${x.id}">${icon('trash', 'sm')}</button></td></tr>`)}</tbody></table>` : emptyState('No expenses recorded', 'wallet')}</div></div>`);
  };
  const load = async () => { $('[data-ledgerbar]', page).style.display = tab === 'ledger' ? '' : 'none'; mount($('[data-body]', page), loading()); tab === 'ledger' ? await ledger() : await expenses(); };
  await load();
  wireRange(page, r, load);
  const search = debounce(() => ledger(), 300);
  const offs = [
    cleanup,
    live('order:closed', () => tab === 'ledger' && ledger()),
    on(page, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; page.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); load(); }),
    on(page, 'change', '[data-type]', (_e, s) => { f.type = s.value; ledger(); }),
    on(page, 'input', '[data-q]', (_e, i) => { f.q = i.value.trim(); search(); }),
    on(page, 'click', '[data-order]', (_e, el) => openOrder(Number(el.dataset.order))),
    on(page, 'click', '[data-csv]', () => download(`/reports/transactions?${new URLSearchParams({ from: r.from, to: r.to, ...f, format: 'csv' })}`, `ledger-${r.from}-${r.to}.csv`)),
    on(page, 'click', '[data-delexp]', async (_e, b) => { if (await confirmDialog('Delete this expense and its ledger entry?', { danger: true, ok: 'Delete' })) { await api(`/staff/expenses/${b.dataset.delexp}`, { method: 'DELETE' }); expenses(); } }),
    on(page, 'click', '[data-addexp]', async () => {
      exp ||= await api('/staff/expenses');
      modal({
        title: 'Record expense',
        content: html`<form class="stack" data-f><div class="grid g2"><label class="field"><span>Category</span><select class="input" name="category">${exp.categories.map((c) => html`<option>${c}</option>`)}</select></label>
          <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${localISO()}" required></label>
          <label class="field"><span>Amount (Rs.)</span><input class="input" type="number" min="1" name="amount" data-num required></label>
          <label class="field"><span>Paid by</span><select class="input" name="method"><option value="cash">Cash</option><option value="card">Card / bank</option><option value="wallet">Wallet</option></select></label></div>
          <label class="field"><span>Note</span><input class="input" name="note" placeholder="e.g. LESCO bill October"></label></form>`,
        foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save expense</button>`,
        onMount: (el, close) => on(el, 'click', '[data-save]', async (_e, btn) => {
          const fm = $('[data-f]', el);
          if (!fm.reportValidity()) return;
          try { await busy(btn, () => api('/staff/expenses', { method: 'POST', body: formData(fm) })); toast('Expense recorded', 'ok'); close(); load(); } catch { /* toasted */ }
        }),
      });
    }),
  ];
  return () => offs.forEach((x) => x());
}
