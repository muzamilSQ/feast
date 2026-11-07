import { html, icon, mount, on, $, $$, api, live, ding, toast, modal, minutesSince, clockStr, store, every, printHTML, TYPE_LABEL, TYPE_ICON } from '../core.js';
import { staffShell, runAction, addonText, kotHTML } from '../shared.js';

const STATIONS = [['all', 'All stations'], ['grill', 'Grill'], ['wraps', 'Wraps'], ['pizza', 'Pizza oven'], ['fryer', 'Fryer'], ['drinks', 'Drinks']];
const LANES = [['received', 'New orders'], ['preparing', 'Preparing'], ['ready', 'Ready / pass']];
const WARN_MIN = 12;
const LATE_MIN = 20;

export default async function kitchen(root) {
  const { main, cleanup } = staffShell(root, { active: '/kitchen' });
  let station = store.get('kds-station', 'all');
  let orders = new Map();
  const fresh = new Set();

  mount(main, html`<div class="page" style="max-width:none">
    <div class="page-head"><div><h1>Kitchen display</h1><p>Tickets oldest first. Starting an order deducts its ingredients from inventory.</p></div>
      <div class="row wrap"><div class="seg" data-stations>${STATIONS.map(([k, l]) => html`<button data-st="${k}" class="${station === k ? 'on' : ''}">${l}</button>`)}</div>
      <button class="btn" data-86>${icon('power', 'sm')} Item availability</button></div></div>
    <div class="board kds-big" data-board style="--cols:3"></div></div>`);

  const board = $('[data-board]', main);
  const relevant = (o) => station === 'all' || o.items.some((i) => i.station === station);
  const ageOf = (o) => minutesSince(o.status === 'received' ? o.created_at : o.status === 'preparing' ? o.preparing_at : o.ready_at);

  const ticket = (o) => {
    const age = minutesSince(o.created_at);
    const items = station === 'all' ? o.items : o.items.filter((i) => i.station === station);
    const others = o.items.length - items.length;
    return html`<article class="ticket st-${o.status} ${age > LATE_MIN && o.status !== 'ready' ? 'late' : ''} ${fresh.has(o.id) ? 'new' : ''}" data-ticket="${o.id}">
      <div class="ticket-head"><div><div class="ticket-no">#${o.id}</div>
        <div class="row small muted" style="gap:6px">${icon(TYPE_ICON[o.type], 'sm')} ${TYPE_LABEL[o.type]}${o.table_no ? ` · Table ${o.table_no}` : ''}${o.customer_name ? ` · ${o.customer_name}` : ''}</div></div>
        <span class="timer" data-timer="${o.id}">${clockStr(ageOf(o))}</span></div>
      <ul class="ticket-items">${items.map((i) => html`<li class="${i.done ? 'done' : ''}">
        ${o.status === 'preparing' ? html`<input type="checkbox" data-done="${i.id}" data-order="${o.id}" ${i.done ? 'checked' : ''} aria-label="Mark ${i.name} done">` : ''}
        <span class="q">${i.qty}×</span><span class="grow"><span class="t">${i.name}</span>${i.variant_name ? html` <span class="badge">${i.variant_name}</span>` : ''}
          ${i.addons.length ? html`<div class="mods">+ ${addonText(i.addons)}</div>` : ''}${i.notes ? html`<div class="note">⚠ ${i.notes}</div>` : ''}</span></li>`)}
        ${others ? html`<li class="muted small">+ ${others} item(s) at other stations</li>` : ''}</ul>
      ${o.notes ? html`<div class="banner bad" style="margin:8px 12px;border-radius:9px;font-size:13px">${o.notes}</div>` : ''}
      <div class="ticket-foot">
        ${o.status === 'received' && o.actions.includes('preparing') ? html`<button class="btn accent lg" data-go="preparing" data-id="${o.id}">${icon('fire', 'sm')} Start</button>` : ''}
        ${o.status === 'preparing' && o.actions.includes('ready') ? html`<button class="btn ok lg" data-go="ready" data-id="${o.id}">${icon('check', 'sm')} Ready</button>` : ''}
        ${o.status === 'ready' ? html`<span class="small muted grow" style="align-self:center">${o.type === 'delivery' ? (o.rider_name ? `Rider: ${o.rider_name}` : 'Waiting for rider') : o.type === 'dine_in' ? `Serve to table ${o.table_no}` : 'Waiting for pickup'} · ${Math.floor(minutesSince(o.ready_at))} min</span>` : ''}
        <button class="btn icon-only" data-kot="${o.id}" title="Print ticket">${icon('print', 'sm')}</button>
      </div></article>`;
  };

  const paint = () => {
    const list = [...orders.values()].filter((o) => ['received', 'preparing', 'ready'].includes(o.status) && !o.served_at && relevant(o));
    mount(board, html`${LANES.map(([st, label]) => {
      const lane = list.filter((o) => o.status === st).sort((a, b) => a.created_at.localeCompare(b.created_at));
      return html`<section class="lane"><div class="lane-head"><span>${label}</span><span class="count">${lane.length}</span></div>
        ${lane.length ? lane.map(ticket) : html`<div class="empty small">${st === 'received' ? 'No new tickets' : 'Nothing here'}</div>`}</section>`;
    })}`);
  };
  const tick = () => {
    for (const el of $$('[data-timer]', board)) {
      const o = orders.get(Number(el.dataset.timer));
      if (!o) continue;
      const m = ageOf(o);
      el.textContent = clockStr(m);
      el.className = `timer ${o.status !== 'ready' && m > LATE_MIN ? 'bad' : o.status !== 'ready' && m > WARN_MIN ? 'warn' : ''}`;
    }
  };

  const load = async () => {
    const data = await api('/orders/board');
    orders = new Map(data.orders.map((o) => [o.id, o]));
    paint(); tick();
  };
  await load();

  const upsert = (o) => {
    const prev = orders.get(o.id);
    const withActions = { ...o, actions: prev?.actions };
    orders.set(o.id, withActions);
    // Event payloads don't include role-specific actions; refetch to keep buttons accurate
    load();
  };

  const offs = [
    cleanup,
    live('order:new', (o) => { fresh.add(o.id); setTimeout(() => fresh.delete(o.id), 4000); ding(); toast(`New order #${o.id} · ${TYPE_LABEL[o.type]}`); upsert(o); }),
    live('order:updated', (o) => { if (o?.id) upsert(o); else load(); }),
    live('menu:changed', () => {}),
    every(1000, tick),
    every(60000, load),
    on(main, 'click', '[data-st]', (_e, b) => { station = b.dataset.st; store.set('kds-station', station); $$('[data-st]', main).forEach((x) => x.classList.toggle('on', x === b)); paint(); tick(); }),
    on(main, 'click', '[data-go]', async (_e, b) => {
      const o = orders.get(Number(b.dataset.id));
      try { const r = await runAction(o, b.dataset.go, b); if (r) { orders.set(r.id, r); paint(); tick(); } } catch { /* toasted */ }
    }),
    on(main, 'change', '[data-done]', async (_e, cb) => {
      try { await api(`/orders/${cb.dataset.order}/items/${cb.dataset.done}/done`, { method: 'POST', body: { done: cb.checked } }); cb.closest('li').classList.toggle('done', cb.checked); } catch (e) { toast(e.message, 'bad'); }
    }),
    on(main, 'click', '[data-kot]', (_e, b) => printHTML(kotHTML(orders.get(Number(b.dataset.kot))))),
    on(main, 'click', '[data-86]', () => availability()),
  ];
  return () => offs.forEach((f) => f());
}

/** Lets the kitchen switch items off when they run out ("86" an item). */
export async function availability() {
  const { categories } = await api('/menu');
  modal({
    title: 'Item availability', wide: true,
    content: html`<p class="muted" style="margin-top:0">Switch items off when you run out. They disappear from the online menu and POS immediately.</p>
      ${categories.map((c) => html`<h4 style="margin:14px 0 6px">${c.name}</h4><div class="grid g3">${c.items.map((i) => html`<label class="opt" style="margin:0"><span>${i.name}</span><input type="checkbox" data-avail="${i.id}" ${i.available ? 'checked' : ''} style="margin:0"></label>`)}</div>`)}`,
    onMount: (el) => {
      el.addEventListener('change', async (e) => {
        const cb = e.target.closest('[data-avail]');
        if (!cb) return;
        try { await api(`/menu/items/${cb.dataset.avail}/availability`, { method: 'PATCH', body: { available: cb.checked } }); toast(cb.checked ? 'Item is back on' : 'Item switched off', 'ok'); } catch (err) { cb.checked = !cb.checked; toast(err.message, 'bad'); }
      });
    },
  });
}
