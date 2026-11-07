import { html, raw, icon, money, mount, on, $, $$, api, live, toast, formData, busy, auth, debounce, printHTML, confirmDialog, query, navigate } from '../core.js';
import { staffShell, pickItem, addToCart, cartPayload, addonText, receiptHTML, publicSettings, fromPrice } from '../shared.js';

export default async function pos(root) {
  const { main, cleanup } = staffShell(root, { active: '/pos' });
  const S = await publicSettings();
  let menu = (await api('/menu')).categories;
  let cat = 'all';
  let search = '';
  let cart = [];
  // Opened from the Tables screen: /pos?table=5&from=tables
  const qp = query();
  const presetTable = qp.table || null;
  const fromTables = qp.from === 'tables';
  let type = presetTable ? 'dine_in' : 'takeaway';
  const payFirst = () => type !== 'dine_in' || S.dine_in_billing === 'before';
  const canDiscount = auth.is('manager', 'cashier');

  mount(main, html`<div class="pos">
    <section class="pos-menu">
      <div class="toolbar"><input class="input" type="search" placeholder="Search items…" data-search style="max-width:240px" aria-label="Search">
        <div class="seg" data-cats></div></div>
      <div data-grid></div>
    </section>
    <aside class="pos-cart">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)" class="stack">
        <div class="seg" style="width:100%">${[['takeaway', 'Takeaway', 'bag'], ['dine_in', 'Dine-in', 'utensils'], ['delivery', 'Delivery', 'bike']].map(([k, l, ic]) => html`<button data-type="${k}" class="${type === k ? 'on' : ''}" style="flex:1;justify-content:center">${icon(ic, 'sm')} ${l}</button>`)}</div>
        <form data-cust class="stack" style="gap:8px"></form>
      </div>
      <div class="lines" data-lines></div>
      <div style="padding:14px 16px;border-top:1px solid var(--border)" class="stack">
        <form data-pay class="row wrap" style="gap:8px">
          <select class="input sm" name="payment_method" style="width:auto" aria-label="Payment method"><option value="cash">Cash</option><option value="card">Card</option><option value="wallet">JazzCash/Easypaisa</option></select>
          <label class="check small" data-paidnow><input type="checkbox" name="paid_now"> Paid now</label>
          <input class="input sm mono" name="promo_code" placeholder="Promo" maxlength="30" style="width:96px;text-transform:uppercase" aria-label="Promo code">
          ${canDiscount ? html`<label class="row small" style="gap:6px;margin-left:auto">Discount <input class="input sm" name="discount" data-num type="number" min="0" step="10" value="0" style="width:90px"></label>` : ''}
        </form>
        <div class="totals" data-totals></div>
        <div class="row"><button class="btn" data-clear>${icon('trash', 'sm')}</button><button class="btn primary lg grow" data-place>Place order</button></div>
      </div>
    </aside></div>`);

  const items = () => menu.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.slug })));
  const paintMenu = () => {
    mount($('[data-cats]', main), html`<button data-cat="all" class="${cat === 'all' ? 'on' : ''}">All</button>${menu.map((c) => html`<button data-cat="${c.slug}" class="${cat === c.slug ? 'on' : ''}">${c.name}</button>`)}`);
    const q = search.toLowerCase();
    const list = items().filter((i) => (cat === 'all' || i.cat === cat) && (!q || i.name.toLowerCase().includes(q)));
    mount($('[data-grid]', main), html`<div class="pos-grid">${list.map((i) => html`<button class="pos-item ${i.available ? '' : 'off'}" data-item="${i.id}" ${i.available ? '' : raw('disabled title="Unavailable"')}>
      ${i.image ? html`<img src="${i.image}" alt="" loading="lazy">` : ''}<div class="b"><div class="n">${i.name}</div><div class="small muted">${i.variants.length > 1 ? 'from ' : ''}${money(fromPrice(i))}</div>${i.available ? '' : html`<span class="badge bad">86'd</span>`}</div></button>`)}</div>`);
  };
  const paintCust = () => {
    const f = $('[data-cust]', main);
    const keep = formData(f);
    mount(f, html`
      <div class="row" style="gap:8px"><input class="input sm" name="customer_name" placeholder="Customer name" value="${keep.customer_name || ''}"><input class="input sm" name="phone" type="tel" placeholder="Phone${type === 'delivery' ? ' *' : ''}" value="${keep.phone || ''}"></div>
      ${type === 'delivery' ? html`<select class="input sm" name="zone_id" data-num>${S.zones.map((z) => html`<option value="${z.id}">${z.name} (${money(z.fee)})</option>`)}</select>
        <input class="input sm" name="address" placeholder="Delivery address *" value="${keep.address || ''}">` : ''}
      ${type === 'dine_in' ? html`<select class="input sm" name="table_no">${Array.from({ length: S.tables || 10 }, (_, i) => html`<option value="${i + 1}" ${String(keep.table_no || presetTable) === String(i + 1) ? raw('selected') : ''}>Table ${i + 1}</option>`)}</select>${S.dine_in_billing !== 'before' ? html`<div class="tiny muted">${icon('table', 'sm')} Added to the table's bill. Payment is taken when the table is completed.</div>` : ''}` : ''}
      <div class="row" style="gap:8px"><select class="input sm" name="source" style="width:auto"><option value="pos">Walk-in / counter</option><option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option></select>
      <input class="input sm" name="notes" placeholder="Order note"></div>`);
  };
  const paintCart = () => {
    mount($('[data-lines]', main), cart.length ? html`${cart.map((l, i) => html`<div class="cart-line" style="padding:10px 0">
      <div class="grow"><b>${l.name}</b>${l.variant_name ? html` <span class="muted small">${l.variant_name}</span>` : ''}${l.addons.length ? html`<div class="meta">+ ${addonText(l.addons)}</div>` : ''}${l.notes ? html`<div class="meta">“${l.notes}”</div>` : ''}
        <div class="row between" style="margin-top:4px"><div class="qty sm"><button data-dq="-1" data-i="${i}">−</button><span>${l.qty}</span><button data-dq="1" data-i="${i}">+</button></div><b class="num">${money(l.unit_price * l.qty)}</b></div></div></div>`)}`
      : html`<div class="empty">${icon('cart')}<div>Tap items to add them.</div></div>`);
    quote();
  };
  const quote = debounce(async () => {
    const el = $('[data-totals]', main);
    if (!cart.length) { mount(el, html`<div class="line grand"><span>Total</span><span>${money(0)}</span></div>`); return; }
    const cust = formData($('[data-cust]', main));
    const pay = formData($('[data-pay]', main));
    try {
      const q = await api('/orders/quote', { method: 'POST', body: { type, zone_id: cust.zone_id, items: cartPayload(cart), discount: pay.discount || 0, promo_code: pay.promo_code } });
      mount(el, html`<div class="line"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
        ${q.discount ? html`<div class="line"><span>Discount${q.promo ? ` · ${q.promo.code}` : ''}</span><span>− ${money(q.discount)}</span></div>` : ''}
        ${q.promo_error ? html`<div class="error-text small">${q.promo_error}</div>` : ''}
        ${q.tax ? html`<div class="line"><span>Tax</span><span>${money(q.tax)}</span></div>` : ''}
        ${type === 'delivery' ? html`<div class="line"><span>Delivery</span><span>${q.delivery_fee ? money(q.delivery_fee) : 'Free'}</span></div>` : ''}
        <div class="line grand"><span>Total</span><span>${money(q.total)}</span></div>`);
    } catch (e) { mount(el, html`<div class="error-text">${e.message}</div>`); }
  }, 120);

  const syncPay = () => {
    const box = $('[data-paidnow] input', main);
    box.disabled = !payFirst();
    $('[data-paidnow]', main).hidden = !payFirst();
    if (type === 'dine_in' && S.dine_in_billing === 'before') box.checked = true;
  };
  paintMenu(); paintCust(); paintCart(); syncPay();

  const offs = [
    cleanup,
    live('menu:changed', async () => { menu = (await api('/menu')).categories; paintMenu(); }),
    on(main, 'click', '[data-cat]', (_e, b) => { cat = b.dataset.cat; paintMenu(); }),
    on(main, 'input', '[data-search]', (_e, el) => { search = el.value.trim(); paintMenu(); }),
    on(main, 'click', '[data-item]', async (_e, b) => {
      const item = items().find((i) => i.id === Number(b.dataset.item));
      // Single-option items with no add-ons go straight in: fast counter flow
      if (item.variants.length === 1 && !item.addons.length && !item.choices?.length) {
        addToCart(cart, { key: `${item.id}:${item.variants[0].id}::`, item_id: item.id, variant_id: item.variants[0].id, addons: [], qty: 1, notes: null, name: item.name, variant_name: null, unit_price: item.variants[0].price });
      } else {
        const line = await pickItem(item, { cta: 'Add' });
        if (!line) return;
        addToCart(cart, line);
      }
      paintCart();
    }),
    on(main, 'click', '[data-dq]', (_e, b) => { const l = cart[Number(b.dataset.i)]; l.qty += Number(b.dataset.dq); if (l.qty <= 0) cart.splice(Number(b.dataset.i), 1); paintCart(); }),
    on(main, 'click', '[data-type]', (_e, b) => { type = b.dataset.type; $$('[data-type]', main).forEach((x) => x.classList.toggle('on', x === b)); paintCust(); syncPay(); quote(); }),
    on(main, 'change', '[data-cust] select, [data-pay]', () => quote()),
    on(main, 'input', '[name=discount], [name=promo_code]', () => quote()),
    on(main, 'click', '[data-clear]', async () => { if (cart.length && await confirmDialog('Clear this order?', { ok: 'Clear', danger: true })) { cart = []; paintCart(); } }),
    on(main, 'click', '[data-place]', async (_e, btn) => {
      if (!cart.length) return toast('Add some items first', 'bad');
      const body = { ...formData($('[data-cust]', main)), ...formData($('[data-pay]', main)), type, items: cartPayload(cart) };
      body.discount = body.discount || 0;
      try {
        const o = await busy(btn, () => api('/orders', { method: 'POST', body }));
        toast(`Order #${o.id} sent to kitchen`, 'ok');
        if (await confirmDialog(html`Order <b>#${o.id}</b> placed · ${money(o.total)}. Print a receipt?`, { title: 'Order placed', ok: 'Print receipt' })) printHTML(receiptHTML(o, S));
        cart = []; paintCust(); $('[data-cust]', main).reset(); paintCart();
        if (fromTables && o.type === 'dine_in') navigate('/tables');
      } catch { /* toasted */ }
    }),
  ];
  return () => offs.forEach((f) => f());
}
