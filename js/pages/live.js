import { html, icon, money, mount, on, $, $$, api, live, ding, toast, minutesSince, clockStr, every, TYPE_LABEL, TYPE_ICON, STATUS_LABEL, ago } from '../core.js';
import { staffShell, runAction, actionButtons, openOrder } from '../shared.js';

const LANES = [['received', 'New'], ['preparing', 'In kitchen'], ['ready', 'Ready'], ['out_for_delivery', 'Out for delivery']];

export default async function liveOrders(root) {
  const { main, cleanup } = staffShell(root, { active: '/live' });
  let data = { orders: [], recent: [] };
  let filter = 'all';
  mount(main, html`<div class="page" style="max-width:none">
    <div class="page-head"><div><h1>Live orders</h1><p>Every open order across online, POS, phone and WhatsApp. Click a ticket for details, riders and receipts.</p></div>
      <div class="row wrap"><div class="seg" data-filter>${[['all', 'All'], ['delivery', 'Delivery'], ['takeaway', 'Takeaway'], ['dine_in', 'Dine-in']].map(([k, l]) => html`<button data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`)}</div>
      <a class="btn" href="/tables" data-seated>${icon('table', 'sm')} Tables</a><a class="btn primary" href="/pos">${icon('plus', 'sm')} New order</a></div></div>
    <div class="board" data-board style="--cols:4"></div>
    <div class="card" style="margin-top:18px"><div class="card-head"><h3>Closed in the last 3 hours</h3></div><div data-recent class="table-wrap"></div></div></div>`);

  const card = (o) => {
    const age = minutesSince(o.created_at);
    return html`<article class="ticket st-${o.status} ${age > 35 ? 'late' : ''}" data-open="${o.id}" style="cursor:pointer">
      <div class="ticket-head"><div><div class="ticket-no">#${o.id} <span class="muted small" style="font-weight:600">${o.code}</span></div>
        <div class="row small muted" style="gap:6px">${icon(TYPE_ICON[o.type], 'sm')} ${TYPE_LABEL[o.type]}${o.table_no ? ` · T${o.table_no}` : ''} · ${o.source}</div></div>
        <span class="timer" data-timer="${o.created_at}">${clockStr(age)}</span></div>
      <div style="padding:0 12px 8px" class="small">
        ${o.customer_name ? html`<div><b>${o.customer_name}</b> ${o.phone ? html`<span class="muted">${o.phone}</span>` : ''}</div>` : ''}
        ${o.address ? html`<div class="muted">${o.address}</div>` : ''}
        <div class="muted">${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
        <div class="row between" style="margin-top:6px"><b>${money(o.total)}</b><span class="badge ${o.payment_status === 'paid' ? 'ok' : 'warn'}">${o.payment_method} · ${o.payment_status}</span></div>
        ${o.type === 'delivery' ? html`<div style="margin-top:6px">${o.rider_name ? html`<span class="badge info">${icon('bike', 'sm')} ${o.rider_name}</span>` : html`<span class="badge">No rider yet</span>`}</div>` : ''}
      </div>
      ${o.actions.length ? html`<div class="ticket-foot">${actionButtons(o, { size: 'sm' })}</div>` : ''}</article>`;
  };
  const paint = () => {
    // Served dine-in orders live on the Tables screen until the table pays
    const list = data.orders.filter((o) => (filter === 'all' || o.type === filter) && !o.served_at);
    const seated = new Set(data.orders.filter((o) => o.type === 'dine_in').map((o) => o.table_no)).size;
    mount($('[data-seated]', main), seated ? html`${icon('table', 'sm')} ${seated} table${seated === 1 ? '' : 's'} seated` : html`${icon('table', 'sm')} Tables`);
    mount($('[data-board]', main), html`${LANES.map(([st, label]) => {
      const lane = list.filter((o) => o.status === st);
      return html`<section class="lane"><div class="lane-head"><span>${label}</span><span class="count">${lane.length}</span></div>${lane.length ? lane.map(card) : html`<div class="empty small">Empty</div>`}</section>`;
    })}`);
    mount($('[data-recent]', main), data.recent.length ? html`<table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Status</th><th class="num">Total</th><th>Closed</th></tr></thead><tbody>
      ${data.recent.map((r) => html`<tr class="clickable" data-open="${r.id}"><td><b>#${r.id}</b> <span class="muted">${r.code}</span></td><td>${r.customer_name || '—'}</td><td>${TYPE_LABEL[r.type]}</td><td><span class="badge dot st-${r.status}">${STATUS_LABEL[r.status]}</span></td><td class="num">${money(r.total)}</td><td>${ago(r.closed_at)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty small">No orders closed recently.</div>`);
  };
  const load = async () => { data = await api('/orders/board'); paint(); };
  await load();
  const reload = (() => { let t; return () => { clearTimeout(t); t = setTimeout(load, 150); }; })();

  const offs = [
    cleanup,
    live('order:new', (o) => { ding(); toast(`New ${TYPE_LABEL[o.type].toLowerCase()} order #${o.id}`); reload(); }),
    live('order:updated', reload),
    every(1000, () => $$('[data-timer]', main).forEach((t) => { t.textContent = clockStr(minutesSince(t.dataset.timer)); })),
    on(main, 'click', '[data-f]', (_e, b) => { filter = b.dataset.f; $$('[data-f]', main).forEach((x) => x.classList.toggle('on', x === b)); paint(); }),
    on(main, 'click', '[data-action]', async (e, b) => {
      e.stopPropagation();
      const o = data.orders.find((x) => x.id === Number(b.dataset.id));
      try { const r = await runAction(o, b.dataset.action, b); if (r) { toast(`#${r.id} → ${STATUS_LABEL[r.status]}`, 'ok'); load(); } } catch { /* toasted */ }
    }),
    on(main, 'click', '[data-open]', (e, el) => { if (!e.target.closest('[data-action]')) openOrder(Number(el.dataset.open), { onChange: load }); }),
  ];
  return () => offs.forEach((f) => f());
}
