import { html, raw, icon, money, mount, on, $, $$, api, toast, modal, busy, confirmDialog, num, formData, fmtDateTime } from '../core.js';
import { adminShell, pageHead, loading, emptyState } from '../shared.js';

export default async function purchasing(root) {
  const { page, cleanup } = adminShell(root, '/admin/purchasing');
  let tab = 'po';
  let pos = [];
  let suppliers = [];
  let ings = [];
  mount(page, html`${pageHead('Purchasing', 'Supplier purchase orders. Receiving a PO adds stock, updates average cost and posts the payment to the ledger.',
    html`<button class="btn" data-addsup>${icon('plus', 'sm')} Supplier</button><button class="btn primary" data-newpo>${icon('plus', 'sm')} Purchase order</button>`)}
    <div class="tabs"><button data-tab="po" class="on">Purchase orders</button><button data-tab="sup">Suppliers</button></div><div data-body>${loading()}</div>`);

  const paint = () => {
    const body = $('[data-body]', page);
    if (tab === 'po') {
      mount(body, pos.length ? html`<div class="stack">${pos.map((p) => html`<div class="card"><div class="card-head"><div><h3>PO-${p.id} · ${p.supplier_name || 'No supplier'}</h3><div class="small muted">${fmtDateTime(p.created_at)} by ${p.created_by_name || '—'}${p.received_at ? ` · received ${fmtDateTime(p.received_at)}` : ''}</div></div>
        <div class="row"><span class="badge ${p.status === 'received' ? 'ok' : p.status === 'pending' ? 'warn' : 'bad'}">${p.status}</span><b>${money(p.total)}</b>
        ${p.status === 'pending' ? html`<button class="btn sm danger" data-cancel="${p.id}">Cancel</button><button class="btn sm ok" data-receive="${p.id}">${icon('check', 'sm')} Receive</button>` : ''}</div></div>
        <div class="table-wrap"><table class="table"><tbody>${p.items.map((i) => html`<tr><td>${i.ingredient}</td><td class="num">${num(i.qty, 2)} ${i.unit}</td><td class="num">@ ${money(i.unit_cost)}</td><td class="num">${money(i.qty * i.unit_cost)}</td></tr>`)}</tbody></table></div></div>`)}</div>` : emptyState('No purchase orders yet', 'truck'));
    } else {
      mount(body, html`<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Address</th><th class="num">Ingredients</th><th></th></tr></thead><tbody>
        ${suppliers.map((s) => html`<tr><td><b>${s.name}</b></td><td>${s.contact_person || '—'}</td><td>${s.phone ? html`<a href="tel:${s.phone}">${s.phone}</a>` : '—'}</td><td class="small">${s.address || ''}</td><td class="num">${s.ingredient_count}</td><td class="right"><button class="btn sm ghost" data-editsup="${s.id}">${icon('edit', 'sm')}</button></td></tr>`)}</tbody></table></div></div>`);
    }
  };
  const load = async () => { [pos, suppliers, ings] = await Promise.all([api('/inventory/purchase-orders'), api('/inventory/suppliers'), api('/inventory/ingredients')]); paint(); };
  await load();

  function newPO() {
    const line = (l = {}) => html`<tr data-l><td><select class="input sm" name="ingredient_id">${ings.map((g) => html`<option value="${g.id}" data-cost="${g.cost_per_unit}" ${g.id === l.ingredient_id ? raw('selected') : ''}>${g.name} (${g.unit})</option>`)}</select></td>
      <td><input class="input sm" type="number" step="0.01" min="0.01" name="qty" value="${l.qty ?? ''}" required style="width:100px"></td>
      <td><input class="input sm" type="number" step="0.01" min="0" name="unit_cost" value="${l.unit_cost ?? ings[0]?.cost_per_unit ?? 0}" required style="width:110px"></td>
      <td class="num" data-lt></td><td><button class="btn sm ghost danger" data-rm>${icon('x', 'sm')}</button></td></tr>`;
    modal({
      title: 'New purchase order', wide: true,
      content: html`<form data-f class="stack"><div class="row wrap"><label class="field grow"><span>Supplier</span><select class="input" name="supplier_id" data-num><option value="">—</option>${suppliers.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
        <label class="field grow"><span>Note</span><input class="input" name="note"></label></div></form>
        <div class="row" style="margin:14px 0 8px"><h4 class="grow">Lines</h4><button class="btn sm" data-suggest>${icon('star', 'sm')} Fill from low stock</button></div>
        <table class="table"><thead><tr><th>Ingredient</th><th>Qty</th><th>Unit cost</th><th class="num">Line total</th><th></th></tr></thead><tbody data-lines>${line()}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num" data-total></td><td></td></tr></tfoot></table>
        <button class="btn sm" data-addl style="margin-top:8px">${icon('plus', 'sm')} Line</button>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Create PO</button>`,
      onMount: (el, close) => {
        const recalc = () => {
          let t = 0;
          for (const r of $$('[data-l]', el)) { const v = Number($('[name=qty]', r).value) * Number($('[name=unit_cost]', r).value); t += v || 0; $('[data-lt]', r).textContent = money(v || 0); }
          $('[data-total]', el).textContent = money(t);
        };
        recalc();
        el.addEventListener('input', recalc);
        el.addEventListener('change', (e) => { if (e.target.name === 'ingredient_id') { $('[name=unit_cost]', e.target.closest('tr')).value = e.target.selectedOptions[0].dataset.cost; recalc(); } });
        on(el, 'click', '[data-addl]', () => { $('[data-lines]', el).insertAdjacentHTML('beforeend', String(line())); recalc(); });
        on(el, 'click', '[data-rm]', (_e, b) => { b.closest('tr').remove(); recalc(); });
        on(el, 'click', '[data-suggest]', () => {
          const low = ings.filter((g) => g.stock <= g.reorder_level);
          if (!low.length) return toast('Nothing is below its reorder level');
          mount($('[data-lines]', el), html`${low.map((g) => line({ ingredient_id: g.id, qty: Math.ceil(Math.max(g.reorder_level * 3 - g.stock, g.reorder_level)), unit_cost: g.cost_per_unit }))}`);
          recalc();
        });
        on(el, 'click', '[data-save]', async (_e, btn) => {
          const items = $$('[data-l]', el).map((r) => ({ ingredient_id: Number($('[name=ingredient_id]', r).value), qty: Number($('[name=qty]', r).value), unit_cost: Number($('[name=unit_cost]', r).value) }));
          if (!items.length || items.some((i) => !(i.qty > 0))) return toast('Add at least one line with a quantity', 'bad');
          try { await busy(btn, () => api('/inventory/purchase-orders', { method: 'POST', body: { ...formData($('[data-f]', el)), items } })); toast('Purchase order created', 'ok'); close(); load(); } catch { /* toasted */ }
        });
      },
    });
  }
  function editSup(s) {
    const x = s || {};
    modal({
      title: s ? `Edit ${s.name}` : 'New supplier',
      content: html`<form class="stack" data-f><label class="field"><span>Name</span><input class="input" name="name" required value="${x.name || ''}"></label>
        <div class="grid g2"><label class="field"><span>Contact person</span><input class="input" name="contact_person" value="${x.contact_person || ''}"></label><label class="field"><span>Phone</span><input class="input" name="phone" value="${x.phone || ''}"></label></div>
        <label class="field"><span>Address</span><input class="input" name="address" value="${x.address || ''}"></label></form>`,
      foot: html`${s ? html`<button class="btn danger" data-del>Remove</button><span class="grow"></span>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
      onMount: (el, close) => {
        on(el, 'click', '[data-save]', async (_e, btn) => { const f = $('[data-f]', el); if (!f.reportValidity()) return; try { await busy(btn, () => api(s ? `/inventory/suppliers/${s.id}` : '/inventory/suppliers', { method: s ? 'PUT' : 'POST', body: formData(f) })); close(); load(); } catch { /* toasted */ } });
        on(el, 'click', '[data-del]', async () => { if (await confirmDialog(`Remove ${s.name}?`, { danger: true, ok: 'Remove' })) { await api(`/inventory/suppliers/${s.id}`, { method: 'DELETE' }); close(); load(); } });
      },
    });
  }

  const offs = [
    cleanup,
    on(page, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; page.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); paint(); }),
    on(page, 'click', '[data-newpo]', () => newPO()),
    on(page, 'click', '[data-addsup]', () => editSup(null)),
    on(page, 'click', '[data-editsup]', (_e, b) => editSup(suppliers.find((s) => s.id === Number(b.dataset.editsup)))),
    on(page, 'click', '[data-receive]', async (_e, b) => {
      const p = pos.find((x) => x.id === Number(b.dataset.receive));
      if (!(await confirmDialog(html`Receive PO-${p.id} and pay <b>${money(p.total)}</b>? Stock will be added for ${p.items.length} ingredient(s).`, { ok: 'Receive & pay' }))) return;
      try { await busy(b, () => api(`/inventory/purchase-orders/${p.id}/receive`, { method: 'POST', body: {} })); toast('Stock received', 'ok'); load(); } catch { /* toasted */ }
    }),
    on(page, 'click', '[data-cancel]', async (_e, b) => { if (await confirmDialog('Cancel this purchase order?', { danger: true, ok: 'Cancel PO' })) { await api(`/inventory/purchase-orders/${b.dataset.cancel}/cancel`, { method: 'POST' }); load(); } }),
  ];
  return () => offs.forEach((x) => x());
}
