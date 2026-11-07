import { html, icon, money, mount, on, api, live, ding, toast, ago, fmtTime, every, store, promptDialog, STATUS_LABEL } from '../core.js';
import { staffShell, runAction, emptyState } from '../shared.js';

export default async function rider(root) {
  const { main, cleanup } = staffShell(root, { active: '/rider' });
  let d = null;
  let watchId = null;
  let lastSent = 0;
  let sharing = store.get('rider-share-location', false);

  const mapUrl = (o) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`;
  const orderCard = (o, mode) => html`<div class="rider-card">
    <div class="row between"><div><b style="font-size:18px">#${o.id}</b> <span class="badge dot st-${o.status}">${STATUS_LABEL[o.status]}</span></div><b style="font-size:18px">${money(o.total)}</b></div>
    <div class="addr">${icon('pin', 'sm')} ${o.address}</div>
    <div class="small muted">${o.zone_name || ''} · ${o.customer_name || 'Customer'} · ${o.phone || ''}</div>
    <div class="small" style="margin-top:6px">${o.items.map((i) => `${i.qty}× ${i.name}${i.variant_name ? ` (${i.variant_name})` : ''}`).join(', ')}</div>
    ${o.notes ? html`<div class="banner warn" style="margin-top:8px">${o.notes}</div>` : ''}
    <div class="row wrap" style="margin-top:8px"><span class="badge ${o.payment_status === 'paid' ? 'ok' : 'warn'}">${o.payment_status === 'paid' ? 'Prepaid' : `Collect ${money(o.total)} · ${o.payment_method}`}</span>
      ${o.ready_at ? html`<span class="badge">Ready ${ago(o.ready_at)}</span>` : ''}</div>
    <div class="rider-actions">
      ${o.phone ? html`<a class="btn" href="tel:${o.phone}">${icon('phone', 'sm')} Call</a>` : ''}
      <a class="btn" href="${mapUrl(o)}" target="_blank" rel="noopener">${icon('map', 'sm')} Navigate</a>
      ${mode === 'available' && o.status === 'ready' ? html`<button class="btn primary" style="grid-column:1/-1" data-go="out_for_delivery" data-id="${o.id}">${icon('bike', 'sm')} Pick up order</button>` : ''}
      ${mode === 'available' && o.status !== 'ready' ? html`<div class="banner info" style="grid-column:1/-1">${icon('chef', 'sm')} Assigned to you · still ${STATUS_LABEL[o.status].toLowerCase()}</div>` : ''}
      ${mode === 'active' ? html`<button class="btn" data-go="ready" data-id="${o.id}">${icon('undo', 'sm')} Couldn't deliver</button><button class="btn ok" data-go="delivered" data-id="${o.id}">${icon('check', 'sm')} Delivered</button>` : ''}
    </div></div>`;

  const paint = () => {
    mount(main, html`<div class="rider">
      <div class="grid g3" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div class="card kpi" style="padding:12px"><div class="label">Today</div><div class="value" style="font-size:22px">${d.stats.deliveries}</div><div class="tiny muted">deliveries</div></div>
        <div class="card kpi" style="padding:12px"><div class="label">Earned</div><div class="value" style="font-size:22px">${money(d.stats.commission, '')}</div><div class="tiny muted">commission</div></div>
        <div class="card kpi" style="padding:12px"><div class="label">Cash</div><div class="value" style="font-size:22px">${money(d.stats.cash, '')}</div><div class="tiny muted">to hand in</div></div>
      </div>
      <label class="rider-card row between" style="cursor:pointer"><span>${icon('map', 'sm')} <b>Share live location</b><div class="tiny muted">Customers see where you are while delivering</div></span><input type="checkbox" data-share ${sharing ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--brand)"></label>
      <h2 style="font-size:18px;margin:18px 0 10px">On the way <span class="badge">${d.active.length}</span></h2>
      ${d.active.length ? d.active.map((o) => orderCard(o, 'active')) : emptyState('No active deliveries', 'bike')}
      <h2 style="font-size:18px;margin:18px 0 10px">Ready for pickup <span class="badge">${d.available.length}</span></h2>
      ${d.available.length ? d.available.map((o) => orderCard(o, 'available')) : emptyState('Nothing waiting. New orders will appear here automatically.', 'box')}
      <h2 style="font-size:18px;margin:18px 0 10px">Recent deliveries</h2>
      <div class="card">${d.history.length ? html`<ul class="list-plain">${d.history.map((h) => html`<li class="row between" style="padding:10px 14px;border-bottom:1px solid var(--border)"><span><b>#${h.id}</b> <span class="muted small">${fmtTime(h.delivered_at)} · ${h.customer_name || ''}</span></span><span class="small">${money(h.total)} <span class="badge ok">+${money(h.commission, '')}</span></span></li>`)}</ul>` : emptyState('No deliveries yet', 'receipt')}</div>
    </div>`);
  };
  const load = async () => { d = await api('/rider/dashboard'); paint(); };
  await load();

  const sendPos = (p) => {
    if (Date.now() - lastSent < 15000 || !d.active.length) return;
    lastSent = Date.now();
    api('/rider/location', { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude } }).catch(() => {});
  };
  const startSharing = () => {
    if (!('geolocation' in navigator)) { toast('Location is not available on this device', 'bad'); return; }
    watchId = navigator.geolocation.watchPosition(sendPos, (e) => toast(`Location: ${e.message}`, 'bad'), { enableHighAccuracy: true, maximumAge: 10000 });
  };
  const stopSharing = () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; };
  if (sharing) startSharing();

  const reload = (() => { let t; return () => { clearTimeout(t); t = setTimeout(load, 200); }; })();
  const offs = [
    cleanup,
    live('order:updated', (o) => { if (o?.type === 'delivery') { if (o.status === 'ready' && !o.rider_id) ding(); reload(); } }),
    live('order:new', (o) => { if (o.type === 'delivery') reload(); }),
    every(30000, load),
    on(main, 'change', '[data-share]', (_e, cb) => { sharing = cb.checked; store.set('rider-share-location', sharing); sharing ? startSharing() : stopSharing(); }),
    on(main, 'click', '[data-go]', async (_e, b) => {
      const o = [...d.active, ...d.available].find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.go === 'ready') {
        const note = await promptDialog({ title: 'Return to restaurant', label: 'What happened?', options: ['Customer not reachable', 'Wrong address', 'Customer refused', 'Vehicle problem', 'Other'], ok: 'Return order' });
        if (!note) return;
        try { await api(`/orders/${o.id}/status`, { method: 'POST', body: { to: 'ready', note } }); toast('Order returned to dispatch'); load(); } catch (e) { toast(e.message, 'bad'); }
        return;
      }
      try { const r = await runAction(o, b.dataset.go, b); if (r) { toast(r.status === 'delivered' ? 'Delivered! Great job.' : 'Picked up. Ride safe!', 'ok'); load(); } } catch { /* toasted */ }
    }),
  ];
  return () => { offs.forEach((f) => f()); stopSharing(); };
}
