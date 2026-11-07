import { html, raw, icon, money, mount, on, $, api, toast, modal, busy, confirmDialog, num, formData, fmtDateTime, download, live } from '../core.js';
import { adminShell, pageHead, loading, emptyState } from '../shared.js';

const UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'pack'];
const MOVES = {
  purchase: ['Receive stock', 'Quantity received', 'Adds stock, updates weighted-average cost and records the purchase in the ledger.'],
  waste: ['Record waste', 'Quantity wasted', 'Spoiled, dropped or expired stock. Counted as a cost in P&L.'],
  count: ['Stock count', 'Counted quantity on hand', 'Sets stock to the physically counted amount and logs the difference.'],
};

export default async function inventory(root) {
  const { page, cleanup } = adminShell(root, '/admin/inventory');
  let tab = 'stock';
  let ings = [];
  let suppliers = [];
  let filter = '';
  let logType = '';
  mount(page, html`${pageHead('Inventory', 'Raw ingredient stock. Usage is deducted automatically from recipes when the kitchen starts an order.',
    html`<a class="btn" href="/admin/purchasing">${icon('truck', 'sm')} Purchase orders</a><button class="btn primary" data-add>${icon('plus', 'sm')} Ingredient</button>`)}
    <div class="tabs"><button data-tab="stock" class="on">Stock levels</button><button data-tab="logs">Movement log</button></div>
    <div data-body>${loading()}</div>`);

  const paintStock = () => {
    const list = ings.filter((g) => !filter || (filter === 'low' ? g.stock <= g.reorder_level : g.name.toLowerCase().includes(filter)));
    const value = ings.reduce((s, g) => s + Math.max(0, g.stock) * g.cost_per_unit, 0);
    const low = ings.filter((g) => g.stock <= g.reorder_level).length;
    mount($('[data-body]', page), html`
      <div class="grid g3" style="margin-bottom:16px">
        <div class="card kpi"><div class="label">Stock value</div><div class="value">${money(value)}</div></div>
        <div class="card kpi"><div class="label">Ingredients tracked</div><div class="value">${ings.length}</div></div>
        <div class="card kpi"><div class="label">At or below reorder level</div><div class="value" style="color:${low ? 'var(--bad)' : 'inherit'}">${low}</div></div>
      </div>
      <div class="toolbar"><input class="input sm" type="search" placeholder="Search ingredients" data-search style="width:220px" value="${filter === 'low' ? '' : filter}">
        <label class="check small"><input type="checkbox" data-lowonly ${filter === 'low' ? 'checked' : ''}> Low stock only</label></div>
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Ingredient</th><th class="num">In stock</th><th></th><th class="num">Reorder at</th><th class="num">Cost / unit</th><th class="num">Value</th><th class="num">Used 7d</th><th class="num">Days left</th><th class="num">Waste 30d</th><th>Supplier</th><th></th></tr></thead><tbody>
      ${list.map((g) => {
        const lowS = g.stock <= g.reorder_level;
        const perDay = g.used_7d / 7;
        const days = perDay > 0 ? g.stock / perDay : null;
        return html`<tr><td><b>${g.name}</b></td><td class="num"><b style="color:${lowS ? 'var(--bad)' : 'inherit'}">${num(g.stock, 2)}</b> ${g.unit}</td>
          <td><div class="stock-bar ${lowS ? 'low' : ''}"><i style="width:${Math.min(100, (g.stock / Math.max(g.reorder_level * 3, 0.01)) * 100)}%"></i></div></td>
          <td class="num">${num(g.reorder_level, 2)}</td><td class="num">${money(g.cost_per_unit)}</td><td class="num">${money(Math.max(0, g.stock) * g.cost_per_unit)}</td>
          <td class="num">${num(g.used_7d, 2)}</td><td class="num">${days == null ? '—' : html`<span class="badge ${days < 2 ? 'bad' : days < 5 ? 'warn' : 'ok'}">${num(days, 1)}d</span>`}</td>
          <td class="num">${g.waste_30d ? num(g.waste_30d, 2) : '—'}</td><td class="small">${g.supplier_name || '—'}</td>
          <td class="right" style="white-space:nowrap"><button class="btn sm" data-move="purchase" data-id="${g.id}" title="Receive stock">${icon('plus', 'sm')}</button><button class="btn sm" data-move="waste" data-id="${g.id}" title="Record waste">${icon('trash', 'sm')}</button><button class="btn sm" data-move="count" data-id="${g.id}" title="Stock count">${icon('list', 'sm')}</button><button class="btn sm ghost" data-edit="${g.id}" title="Edit">${icon('edit', 'sm')}</button></td></tr>`;
      })}</tbody></table></div></div>`);
  };
  const paintLogs = async () => {
    mount($('[data-body]', page), loading());
    const logs = await api(`/inventory/logs${logType ? `?type=${logType}` : ''}`);
    mount($('[data-body]', page), html`<div class="toolbar"><select class="input sm" data-logtype style="width:auto"><option value="">All movements</option>${['usage', 'purchase', 'waste', 'adjust'].map((t) => html`<option ${t === logType ? raw('selected') : ''}>${t}</option>`)}</select>
      <button class="btn sm" data-logcsv>${icon('download', 'sm')} Export CSV</button><span class="small muted">Showing latest 300</span></div>
      <div class="card"><div class="table-wrap">${logs.length ? html`<table class="table"><thead><tr><th>When</th><th>Ingredient</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Reference</th><th>By</th></tr></thead><tbody>
      ${logs.map((l) => html`<tr><td class="small">${fmtDateTime(l.created_at)}</td><td>${l.ingredient}</td><td><span class="badge ${l.type === 'usage' ? 'info' : l.type === 'purchase' ? 'ok' : l.type === 'waste' ? 'bad' : ''}">${l.type}</span></td>
        <td class="num" style="color:${l.change < 0 ? 'var(--bad)' : 'var(--ok)'}">${l.change > 0 ? '+' : ''}${num(l.change, 3)} ${l.unit}</td><td class="num">${num(l.balance, 2)}</td><td class="small">${l.ref || ''} ${l.note || ''}</td><td class="small">${l.employee_name || '—'}</td></tr>`)}</tbody></table>` : emptyState('No movements yet')}</div></div>`);
  };
  const load = async () => {
    [ings, suppliers] = await Promise.all([api('/inventory/ingredients'), api('/inventory/suppliers')]);
    if (tab === 'stock') paintStock(); else paintLogs();
  };
  await load();

  function edit(g) {
    const x = g || { name: '', unit: 'kg', reorder_level: 0, cost_per_unit: 0, supplier_id: null };
    modal({
      title: g ? `Edit ${g.name}` : 'New ingredient',
      content: html`<form class="stack" data-f><label class="field"><span>Name</span><input class="input" name="name" required value="${x.name}"></label>
        <div class="grid g2"><label class="field"><span>Stock unit</span><select class="input" name="unit">${UNITS.map((u) => html`<option ${u === x.unit ? raw('selected') : ''}>${u}</option>`)}</select></label>
        <label class="field"><span>Supplier</span><select class="input" name="supplier_id" data-num><option value="">—</option>${suppliers.map((s) => html`<option value="${s.id}" ${s.id === x.supplier_id ? raw('selected') : ''}>${s.name}</option>`)}</select></label>
        <label class="field"><span>Cost per unit (Rs.)</span><input class="input" type="number" step="0.01" min="0" name="cost_per_unit" data-num value="${x.cost_per_unit}" required></label>
        <label class="field"><span>Reorder level</span><input class="input" type="number" step="0.01" min="0" name="reorder_level" data-num value="${x.reorder_level}" required></label>
        ${g ? '' : html`<label class="field"><span>Opening stock</span><input class="input" type="number" step="0.01" min="0" name="stock" data-num value="0"></label>`}</div></form>`,
      foot: html`${g ? html`<button class="btn danger" data-del>Remove</button><span class="grow"></span>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
      onMount: (el, close) => {
        on(el, 'click', '[data-save]', async (_e, btn) => {
          const f = $('[data-f]', el);
          if (!f.reportValidity()) return;
          try { await busy(btn, () => api(g ? `/inventory/ingredients/${g.id}` : '/inventory/ingredients', { method: g ? 'PUT' : 'POST', body: formData(f) })); toast('Saved', 'ok'); close(); load(); } catch { /* toasted */ }
        });
        on(el, 'click', '[data-del]', async () => {
          if (!(await confirmDialog(`Remove ${g.name}? Recipes using it will stop deducting it.`, { danger: true, ok: 'Remove' }))) return;
          await api(`/inventory/ingredients/${g.id}`, { method: 'DELETE' }); close(); load();
        });
      },
    });
  }
  function move(g, type) {
    const [title, label, help] = MOVES[type];
    modal({
      title: `${title} · ${g.name}`,
      content: html`<form class="stack" data-f><p class="muted" style="margin:0">${help} Current stock: <b>${num(g.stock, 2)} ${g.unit}</b>.</p>
        <label class="field"><span>${label} (${g.unit})</span><input class="input" type="number" step="0.001" min="0" name="qty" data-num required autofocus></label>
        ${type === 'purchase' ? html`<label class="field"><span>Unit cost (Rs. per ${g.unit})</span><input class="input" type="number" step="0.01" min="0" name="unit_cost" data-num value="${g.cost_per_unit}"></label>` : ''}
        <label class="field"><span>Note</span><input class="input" name="note" placeholder="${type === 'waste' ? 'e.g. expired, dropped' : 'optional'}"></label></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${title}</button>`,
      onMount: (el, close) => on(el, 'click', '[data-save]', async (_e, btn) => {
        const f = $('[data-f]', el);
        if (!f.reportValidity()) return;
        try { const r = await busy(btn, () => api(`/inventory/ingredients/${g.id}/movement`, { method: 'POST', body: { type, ...formData(f) } })); toast(`${g.name}: ${num(r.balance, 2)} ${g.unit} in stock`, 'ok'); close(); load(); } catch { /* toasted */ }
      }),
    });
  }

  const offs = [
    cleanup,
    live('inventory:changed', () => tab === 'stock' && load()),
    on(page, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; page.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); load(); }),
    on(page, 'input', '[data-search]', (_e, i) => { filter = i.value.trim().toLowerCase(); const pos = i.selectionStart; paintStock(); const n = $('[data-search]', page); n.focus(); n.setSelectionRange(pos, pos); }),
    on(page, 'change', '[data-lowonly]', (_e, c) => { filter = c.checked ? 'low' : ''; paintStock(); }),
    on(page, 'change', '[data-logtype]', (_e, s) => { logType = s.value; paintLogs(); }),
    on(page, 'click', '[data-logcsv]', () => download(`/inventory/logs?format=csv${logType ? `&type=${logType}` : ''}`, 'inventory-movements.csv')),
    on(page, 'click', '[data-add]', () => edit(null)),
    on(page, 'click', '[data-edit]', (_e, b) => edit(ings.find((g) => g.id === Number(b.dataset.edit)))),
    on(page, 'click', '[data-move]', (_e, b) => move(ings.find((g) => g.id === Number(b.dataset.id)), b.dataset.move)),
  ];
  return () => offs.forEach((x) => x());
}
