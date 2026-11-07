import { html, icon, money, mount, on, $, api, store, fmtTime, fmtDateTime, navigate, STATUS_LABEL } from '../core.js';
import { addonText, publicSettings } from '../shared.js';

const FLOW = {
  delivery: ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'],
  takeaway: ['received', 'preparing', 'ready', 'completed'],
  dine_in: ['received', 'preparing', 'ready', 'completed'],
};
const COPY = {
  received: ['Order received', 'The restaurant has your order.', 'receipt'],
  preparing: ['Preparing', 'Our chefs are cooking your food.', 'chef'],
  ready: ['Ready', null, 'check'],
  out_for_delivery: ['On the way', 'Your rider is heading to you.', 'bike'],
  delivered: ['Delivered', 'Enjoy your FEAST!', 'home'],
  completed: ['Completed', 'Enjoy your FEAST!', 'star'],
};

export default async function track(root, { code }) {
  const S = await publicSettings();
  const header = html`<header class="store-top"><div class="inner"><a class="logo" href="/"><span class="mark">FE<b>A</b>ST</span></a><span class="grow"></span><a class="btn ghost sm" href="/">${icon('utensils', 'sm')} Menu</a></div></header>`;

  if (!code) {
    const recent = store.get('feast-orders', []);
    mount(root, html`${header}<div class="track"><div class="card card-pad stack">
      <h1 style="font-size:24px">Track your order</h1>
      <form class="row" data-f><input class="input grow" name="code" placeholder="Order code e.g. 7KQ2MZ" required style="text-transform:uppercase" autofocus><button class="btn primary">Track</button></form>
      ${recent.length ? html`<div><h4 style="margin:8px 0">Your recent orders</h4>${recent.map((r) => html`<a class="row between card-pad" style="border-top:1px solid var(--border);text-decoration:none;padding:10px 0" href="/track/${r.code}"><span><b>#${r.number}</b> · ${r.code}</span><span class="muted">${money(r.total, S.currency)} ${icon('chevron', 'sm')}</span></a>`)}</div>` : ''}
    </div></div>`);
    $('[data-f]', root).addEventListener('submit', (e) => { e.preventDefault(); navigate(`/track/${e.target.code.value.trim().toUpperCase()}`); });
    return;
  }

  let o;
  try { o = await api(`/public/orders/${encodeURIComponent(code)}`); } catch (e) {
    mount(root, html`${header}<div class="track"><div class="card card-pad empty">${icon('alert')}<p>${e.message}</p><a class="btn" href="/track">Try another code</a></div></div>`);
    return;
  }

  const paint = () => {
    const flow = FLOW[o.type];
    const idx = flow.indexOf(o.status);
    const readyText = o.type === 'delivery' ? 'Packed and waiting for a rider.' : o.type === 'dine_in' ? 'Being served to your table.' : 'Ready for pickup at the counter!';
    const stamp = { received: o.created_at, preparing: o.preparing_at, ready: o.ready_at, out_for_delivery: o.picked_at, delivered: o.closed_at, completed: o.closed_at };
    mount(root, html`${header}<div class="track">
      <div class="card card-pad" style="margin-bottom:14px">
        <div class="row between"><div><div class="muted small">Order #${o.number} · ${fmtDateTime(o.created_at)}</div><h1 style="font-size:26px;margin-top:4px">${o.status === 'cancelled' ? 'Order cancelled' : COPY[o.status][0]}</h1></div>
          <div class="right"><div class="muted tiny">Order code</div><div class="display" style="font-size:24px">${o.code}</div></div></div>
        ${o.status === 'cancelled' ? html`<div class="banner bad" style="margin-top:14px">${icon('alert')} ${o.cancel_reason || 'This order was cancelled.'} Please contact us on WhatsApp ${S.phone}.</div>` : html`
        <div class="steps" style="margin-top:20px">${flow.map((s, i) => html`<div class="step ${i < idx || o.status === flow.at(-1) ? 'done' : ''} ${i === idx && i !== flow.length - 1 ? 'current' : ''}">
          <div class="dot">${icon(i < idx ? 'check' : COPY[s][2])}</div>
          <div><h4>${COPY[s][0]} ${stamp[s] && i <= idx ? html`<span class="muted small" style="font-weight:500">· ${fmtTime(stamp[s])}</span>` : ''}</h4>
            ${i === idx ? html`<div class="muted small">${s === 'ready' ? readyText : COPY[s][1]}</div>` : ''}
            ${s === 'out_for_delivery' && i === idx && o.rider_name ? html`<div class="row wrap" style="margin-top:8px"><span class="badge info">${icon('bike', 'sm')} ${o.rider_name}</span>
              ${o.rider_phone ? html`<a class="btn sm" href="tel:${o.rider_phone}">${icon('phone', 'sm')} Call rider</a>` : ''}
              ${o.rider_location ? html`<a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${o.rider_location.lat},${o.rider_location.lng}">${icon('map', 'sm')} Rider location</a>` : ''}</div>` : ''}
          </div></div>`)}</div>`}
        <div class="row wrap tiny muted" style="margin-top:4px">${icon('refresh', 'sm')} This page updates live.</div>
      </div>
      <div class="card card-pad">
        <h3 style="margin-bottom:10px">Order summary</h3>
        ${o.items.map((i) => html`<div class="row between" style="padding:6px 0;border-bottom:1px dashed var(--border)"><span><b>${i.qty}×</b> ${i.name}${i.variant_name ? ` (${i.variant_name})` : ''}${i.addons.length ? html`<div class="tiny muted">+ ${addonText(i.addons)}</div>` : ''}</span><span class="num">${money(i.line_total, S.currency)}</span></div>`)}
        <div class="totals" style="margin-top:10px">
          ${o.delivery_fee || o.type === 'delivery' ? html`<div class="line"><span>Delivery</span><span>${o.delivery_fee ? money(o.delivery_fee, S.currency) : 'Free'}</span></div>` : ''}
          ${o.tax ? html`<div class="line"><span>Tax</span><span>${money(o.tax, S.currency)}</span></div>` : ''}
          <div class="line grand"><span>Total</span><span>${money(o.total, S.currency)}</span></div>
          <div class="muted small">Payment: ${o.payment_method === 'cash' ? 'Cash' : o.payment_method === 'card' ? 'Card' : 'Mobile wallet'} · ${o.payment_status}</div>
        </div>
        <div class="row wrap" style="margin-top:16px"><a class="btn" href="https://wa.me/${S.whatsapp}?text=${encodeURIComponent(`Hi FEAST, about my order #${o.number} (${o.code})`)}" target="_blank" rel="noopener">${icon('whatsapp', 'sm')} Need help?</a><a class="btn primary" href="/">Order again</a></div>
      </div></div>`);
  };
  paint();

  const es = new EventSource(`/api/public/orders/${encodeURIComponent(o.code)}/stream`);
  es.addEventListener('order', (e) => {
    o = JSON.parse(e.data);
    paint();
  });
  return () => es.close();
}
