import { html, icon, money, mount, on, $, $$, api, auth, live, ding, toast, busy, modal, navigate, confirmDialog, promptDialog, minutesSince, clockStr, every, printHTML, fmtDateTime, fmtTime, statusBadge, STATUS_LABEL } from '../core.js';
import { staffShell, publicSettings, addonText, actionButtons, runAction, openOrder } from '../shared.js';

const STATE = {
  free: ['Free', ''],
  cooking: ['In kitchen', 'warn'],
  to_serve: ['Food ready', 'ok'],
  eating: ['Eating', 'info'],
  bill: ['Bill asked', 'violet'],
};

/** Dine-in floor: a grid of tables with their orders, plus the dine-in kitchen queue. */
export default async function tables(root) {
  const { main, cleanup } = staffShell(root, { active: '/tables' });
  const S = await publicSettings();
  const canResize = auth.is('manager');
  let list = [];

  mount(main, html`<div class="page" style="max-width:none">
    <div class="page-head"><div><h1>Tables</h1><p>Tap a free table to take an order. Tap a seated table to serve, add more, print the bill or complete it.</p></div>
      <div class="row wrap">
        <div class="row small" data-summary></div>
        ${canResize ? html`<div class="stepper" title="Number of tables"><button class="btn sm" data-resize="-1" aria-label="Remove a table">−</button><span data-count></span><button class="btn sm" data-resize="1" aria-label="Add a table">+</button></div>` : ''}
      </div></div>
    <div class="floor-wrap">
      <div class="floor" data-floor></div>
      <aside class="card dine-queue"><div class="card-head"><h3>Dine-in queue</h3><span class="muted small" data-qcount></span></div><div data-queue></div></aside>
    </div></div>`);

  const tableCard = (t) => {
    const [label, tone] = STATE[t.state];
    if (t.state === 'free') {
      return html`<button class="table-card free" data-new="${t.table}"><div class="t-no">${t.table}</div><span class="badge">${label}</span><span class="t-add">${icon('plus', 'sm')} New order</span></button>`;
    }
    return html`<button class="table-card s-${t.state}" data-table="${t.table}">
      <div class="row between" style="align-items:flex-start"><div class="t-no">${t.table}</div><span class="timer" data-timer="${t.seated_at}">${clockStr(minutesSince(t.seated_at))}</span></div>
      <span class="badge ${tone} dot">${label}</span>
      <div class="t-orders">${t.orders.map((o) => html`<span class="t-order st-${o.served_at ? 'served' : o.status}">#${o.id}</span>`)}</div>
      <div class="row between t-foot"><span class="muted small">${t.items} item${t.items === 1 ? '' : 's'}${t.customer ? ` · ${t.customer}` : ''}</span><b class="nowrap">${money(t.total)}</b></div>
    </button>`;
  };

  const paint = () => {
    mount($('[data-floor]', main), html`${list.map(tableCard)}`);
    const busyT = list.filter((t) => t.state !== 'free');
    const n = (s) => list.filter((t) => t.state === s).length;
    mount($('[data-summary]', main), html`<span class="badge">${list.length - busyT.length} free</span><span class="badge info">${busyT.length} seated</span>${n('to_serve') ? html`<span class="badge ok dot">${n('to_serve')} to serve</span>` : ''}${n('bill') ? html`<span class="badge violet">${n('bill')} want the bill</span>` : ''}<span class="badge">${money(busyT.reduce((s, t) => s + t.total, 0))} open</span>`);
    if (canResize) mount($('[data-count]', main), `${S.tables} tables`);
    // Queue: dine-in orders not yet served, oldest first
    const q = list.flatMap((t) => t.orders).filter((o) => !o.served_at).sort((a, b) => a.id - b.id);
    mount($('[data-qcount]', main), `${q.length} waiting`);
    mount($('[data-queue]', main), q.length ? html`${q.map((o) => html`<div class="q-row st-${o.status}" data-open="${o.id}">
        <div class="q-table">T${o.table_no}</div>
        <div class="grow"><div class="row between"><b>#${o.id}</b><span class="timer sm" data-timer="${o.created_at}">${clockStr(minutesSince(o.created_at))}</span></div>
          <div class="small muted" style="margin:2px 0 6px">${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
          <div class="row between">${statusBadge(o.status)}${o.actions.includes('served') ? html`<button class="btn sm ok" data-action="served" data-id="${o.id}">${icon('check', 'sm')} Served</button>` : ''}</div></div></div>`)}`
      : html`<div class="empty small">${icon('check')}<div>Nothing waiting. All tables are served.</div></div>`);
  };

  const load = async () => { list = await api('/orders/tables'); paint(); };
  await load();
  const reload = (() => { let t; return () => { clearTimeout(t); t = setTimeout(load, 150); }; })();

  /* ---------- Table drawer ---------- */
  const billHTML = (t) => {
    const items = t.orders.flatMap((o) => o.items);
    const sum = (k) => t.orders.reduce((s, o) => s + (o[k] || 0), 0);
    return html`<div class="receipt"><div class="c"><b style="font-size:20px">${S.name || 'FEAST'}</b><br>${S.tagline || ''}<br>${S.phone ? `Tel/WhatsApp ${S.phone}` : ''}</div>
      <hr><div class="l"><span><b>TABLE ${t.table}</b></span><span>${new Date().toLocaleString('en-PK')}</span></div>
      <div>Orders ${t.orders.map((o) => `#${o.id}`).join(', ')} · seated ${fmtTime(t.seated_at)}</div><hr>
      ${items.map((i) => html`<div class="l"><span>${i.qty} x ${i.name}${i.variant_name ? ` (${i.variant_name})` : ''}</span><span>${money(i.line_total, '')}</span></div>${i.addons?.length ? html`<div style="padding-left:14px">+ ${addonText(i.addons)}</div>` : ''}`)}
      <hr><div class="l"><span>Subtotal</span><span>${money(sum('subtotal'), '')}</span></div>
      ${sum('discount') ? html`<div class="l"><span>Discount</span><span>-${money(sum('discount'), '')}</span></div>` : ''}
      ${sum('tax') ? html`<div class="l"><span>Tax</span><span>${money(sum('tax'), '')}</span></div>` : ''}
      <div class="l" style="font-size:16px;font-weight:bold"><span>TOTAL</span><span>${money(t.total)}</span></div>
      ${t.total - t.due ? html`<div class="l"><span>Already paid</span><span>-${money(t.total - t.due, '')}</span></div><div class="l" style="font-weight:bold"><span>DUE</span><span>${money(t.due)}</span></div>` : ''}
      <hr><div class="c">Thank you for dining at FEAST!<br>Taste that hits different.</div></div>`;
  };

  function openTable(no) {
    const get = () => list.find((t) => t.table === String(no));
    const body = () => {
      const t = get();
      if (!t || t.state === 'free') return html`<div class="empty">${icon('check')}<div>Table ${no} is free.</div></div>`;
      const cooking = t.orders.filter((o) => o.status !== 'ready').length;
      return html`
        <div class="row wrap" style="margin-bottom:14px;gap:8px"><span class="badge ${STATE[t.state][1]} dot">${STATE[t.state][0]}</span><span class="badge">${icon('clock', 'sm')} Seated ${fmtTime(t.seated_at)}</span>${t.customer ? html`<span class="badge">${t.customer}</span>` : ''}</div>
        ${t.orders.map((o, i) => html`<div class="card round">
          <div class="round-head" data-open="${o.id}"><div><b>${i === 0 ? 'Order' : `Round ${i + 1}`} · #${o.id}</b><div class="tiny muted">${fmtDateTime(o.created_at)}${o.created_by_name ? ` · ${o.created_by_name}` : ''}</div></div>
            ${o.served_at ? html`<span class="badge info">Served ${fmtTime(o.served_at)}</span>` : statusBadge(o.status)}</div>
          <ul class="round-items">${o.items.map((it) => html`<li><span>${it.qty} × ${it.name}${it.variant_name ? html` <span class="muted">(${it.variant_name})</span>` : ''}${it.addons?.length ? html`<div class="tiny muted">+ ${addonText(it.addons)}</div>` : ''}${it.notes ? html`<div class="tiny muted">“${it.notes}”</div>` : ''}</span><span class="num">${money(it.line_total)}</span></li>`)}</ul>
          <div class="row between round-foot"><span class="small ${o.payment_status === 'paid' ? '' : 'muted'}">${o.payment_status === 'paid' ? html`<span class="badge ok">Paid · ${o.payment_method}</span>` : 'Unpaid'}</span>
            <div class="row" style="gap:6px">${actionButtons({ ...o, actions: o.actions.filter((a) => a !== 'cancelled') }, { size: 'sm' })}${o.actions.includes('cancelled') ? html`<button class="btn sm danger" data-action="cancelled" data-id="${o.id}">Cancel</button>` : ''}</div></div>
        </div>`)}
        <div class="totals" style="margin-top:14px"><div class="line"><span>${t.orders.length} order${t.orders.length === 1 ? '' : 's'} · ${t.items} items</span><span>${money(t.total)}</span></div>
          ${t.total - t.due ? html`<div class="line"><span>Already paid</span><span>− ${money(t.total - t.due)}</span></div>` : ''}
          <div class="line grand"><span>To pay</span><span>${money(t.due)}</span></div></div>
        ${cooking ? html`<div class="banner warn" style="margin-top:12px">${icon('chef')} ${cooking} order${cooking === 1 ? ' is' : 's are'} still in the kitchen. The table can be completed once everything is ready.</div>` : ''}`;
    };
    const foot = () => {
      const t = get();
      if (!t || t.state === 'free') return html`<button class="btn primary" data-close data-new="${no}">${icon('plus', 'sm')} New order</button>`;
      return html`<button class="btn" data-move>Move</button><button class="btn" data-print>${icon('print', 'sm')} Bill</button>
        <button class="btn" data-more>${icon('plus', 'sm')} Add order</button>
        <button class="btn ok lg" style="flex:1 1 100%" data-complete ${t.orders.some((o) => o.status !== 'ready') ? 'disabled' : ''}>${icon('check', 'sm')} ${t.due ? `Complete · ${money(t.due)}` : 'Complete & free table'}</button>`;
    };
    modal({
      title: `Table ${no}`, content: body(), foot: foot(), drawer: true,
      onMount: (el, close) => {
        const repaint = () => { if (!el.isConnected) return; mount($('.modal-body', el), body()); mount($('.modal-foot', el), foot()); };
        const stop = live('order:updated', () => setTimeout(repaint, 400));
        const offs2 = [
          stop,
          on(el, 'click', '[data-action]', async (e, b) => {
            e.stopPropagation();
            const o = get()?.orders.find((x) => x.id === Number(b.dataset.id));
            try { if (await runAction(o, b.dataset.action, b)) { await load(); repaint(); } } catch { /* toasted */ }
          }),
          on(el, 'click', '.round-head[data-open]', (_e, h) => openOrder(Number(h.dataset.open), { onChange: () => load().then(repaint) })),
          on(el, 'click', '[data-more]', () => { close(); navigate(`/pos?table=${encodeURIComponent(no)}&from=tables`); }),
          on(el, 'click', '[data-print]', async (_e, b) => {
            const t = get();
            printHTML(billHTML(t));
            if (!t.bill_requested) { try { await busy(b, () => api(`/orders/tables/${encodeURIComponent(no)}/bill`, { method: 'POST' })); await load(); repaint(); } catch { /* toasted */ } }
          }),
          on(el, 'click', '[data-move]', async () => {
            const free = list.filter((t) => t.state === 'free').map((t) => `Table ${t.table}`);
            const pick = await promptDialog({ title: `Move table ${no}`, label: free.length ? 'Move guests to' : 'Merge into table', options: free.length ? free : list.filter((t) => t.table !== String(no)).map((t) => `Table ${t.table}`), ok: 'Move' });
            if (!pick) return;
            const to = pick.replace('Table ', '');
            try { await api(`/orders/tables/${encodeURIComponent(no)}/move`, { method: 'POST', body: { to } }); toast(`Table ${no} moved to ${to}`, 'ok'); close(); await load(); openTable(to); } catch (e) { toast(e.message, 'bad'); }
          }),
          on(el, 'click', '[data-complete]', async (_e, b) => {
            const t = get();
            let method = 'cash';
            if (t.due) {
              method = await promptDialog({ title: `Table ${no} · collect ${money(t.due)}`, label: 'Payment method', options: ['cash', 'card', 'wallet'], ok: 'Paid & complete' });
              if (!method) return;
            } else if (!(await confirmDialog(`Everything at table ${no} is paid. Complete it and free the table?`, { title: 'Complete table', ok: 'Complete' }))) return;
            try {
              const done = await busy(b, () => api(`/orders/tables/${encodeURIComponent(no)}/settle`, { method: 'POST', body: { payment_method: method } }));
              toast(`Table ${no} completed · ${done.length} order${done.length === 1 ? '' : 's'} · ${money(t.total)}`, 'ok');
              close(); load();
            } catch { /* toasted */ }
          }),
        ];
        return () => offs2.forEach((f) => f());
      },
    });
  }

  const offs = [
    cleanup,
    live('order:new', (o) => { if (o.type === 'dine_in') { ding(); reload(); } }),
    live('order:updated', reload),
    every(1000, () => $$('[data-timer]', main).forEach((t) => { t.textContent = clockStr(minutesSince(t.dataset.timer)); })),
    on(main, 'click', '[data-new]', (_e, b) => navigate(`/pos?table=${encodeURIComponent(b.dataset.new)}&from=tables`)),
    on(main, 'click', '[data-table]', (_e, b) => openTable(b.dataset.table)),
    on(main, 'click', '[data-queue] [data-action]', async (e, b) => {
      e.stopPropagation();
      const o = list.flatMap((t) => t.orders).find((x) => x.id === Number(b.dataset.id));
      try { if (await runAction(o, b.dataset.action, b)) { toast(`#${o.id} served to table ${o.table_no}`, 'ok'); load(); } } catch { /* toasted */ }
    }),
    on(main, 'click', '[data-queue] [data-open]', (e, el) => { if (!e.target.closest('[data-action]')) openOrder(Number(el.dataset.open), { onChange: load }); }),
    on(main, 'click', '[data-resize]', async (_e, b) => {
      const next = Number(S.tables) + Number(b.dataset.resize);
      if (next < 1) return;
      const highestBusy = Math.max(0, ...list.filter((t) => t.state !== 'free').map((t) => Number(t.table) || 0));
      if (next < highestBusy) return toast(`Table ${highestBusy} is seated. Complete it before removing it.`, 'bad');
      try { const r = await busy(b, () => api('/settings/tables', { method: 'PATCH', body: { tables: next } })); S.tables = r.tables; load(); } catch { /* toasted */ }
    }),
  ];
  return () => offs.forEach((f) => f());
}
