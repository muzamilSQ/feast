import { html, raw, icon, money, mount, on, $, $$, api, store, toast, modal, navigate, formData, busy, toggleTheme, isDark, debounce } from '../core.js';
import { pickItem, addToCart, cartPayload, vegDot, spice, fromPrice, addonText } from '../shared.js';

export default async function storefront(root) {
  mount(root, html`<div class="spinner" style="margin-top:30vh"></div>`);
  const { settings: S, categories } = await api('/public/menu');
  const items = categories.flatMap((c) => c.items);
  let cart = store.get('feast-cart', []).filter((l) => items.some((i) => i.id === l.item_id));
  let search = '';
  const cur = S.currency;
  const wa = `https://wa.me/${S.whatsapp}`;

  const save = () => { store.set('feast-cart', cart); paintCartCount(); };
  const count = () => cart.reduce((s, l) => s + l.qty, 0);
  const subtotal = () => cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const featured = items.filter((i) => i.featured).slice(0, 8);

  const inCart = (id) => cart.filter((l) => l.item_id === id).reduce((s, l) => s + l.qty, 0);
  const saving = (i) => (i.compare_at && i.compare_at > fromPrice(i) ? i.compare_at - fromPrice(i) : 0);
  const priceTag = (i) => html`<span class="price">${i.variants.length > 1 ? html`<small>from</small> ` : ''}${money(fromPrice(i), cur)}</span>${saving(i) ? html`<s class="was">${money(i.compare_at, cur)}</s>` : ''}`;
  const thumb = (i) => (i.image
    ? html`<img src="${i.image}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">`
    : '');

  // Compact dish row: text left, small square photo right (photos are never upscaled past their source size)
  const dish = (i) => html`<button class="dish" data-item="${i.id}" aria-label="${i.name}, ${money(fromPrice(i), cur)}">
    <div class="dish-info">
      <h3>${i.name} ${vegDot(i.is_veg)}</h3>
      <p>${i.description}</p>
      <div class="dish-meta">${priceTag(i)}${spice(i.spicy)}${saving(i) ? html`<span class="save">Save ${money(saving(i), cur)}</span>` : i.featured ? html`<span class="pop">${icon('fire', 'sm')} Popular</span>` : ''}</div>
    </div>
    <div class="dish-ph${i.image ? '' : ' noimg'}">${thumb(i)}
      <span class="dish-add" data-incart="${i.id}">${inCart(i.id) || raw(icon('plus'))}</span></div>
  </button>`;

  // Small featured tile for the "Most loved" strip
  const tile = (i) => html`<button class="tile" data-item="${i.id}">
    <div class="tile-ph${i.image ? '' : ' noimg'}">${thumb(i)}</div>
    <div class="tile-body"><h3>${i.name}</h3><div class="row between">${priceTag(i)}<span class="dish-add sm" data-incart="${i.id}">${inCart(i.id) || raw(icon('plus'))}</span></div></div>
  </button>`;

  const sections = () => {
    const q = search.toLowerCase();
    const cats = categories.map((c) => ({ ...c, items: c.items.filter((i) => !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)) })).filter((c) => c.items.length);
    if (!cats.length) return html`<div class="empty">${icon('search')}<div>No items match “${search}”.</div></div>`;
    return html`${!q && featured.length ? html`<section class="menu-section" id="cat-popular" data-sec="popular"><div class="sec-head"><h2>Most loved</h2><span class="muted small">What FEAST regulars order</span></div><div class="tile-strip">${featured.map(tile)}</div></section>` : ''}
      ${cats.map((c) => html`<section class="menu-section" id="cat-${c.slug}" data-sec="${c.slug}"><div class="sec-head"><h2>${c.name}</h2><span class="muted small">${c.items.length} item${c.items.length === 1 ? '' : 's'}</span></div><div class="dish-grid">${c.items.map(dish)}</div></section>`)}`;
  };

  mount(root, html`<div class="store">
    <header class="store-top"><div class="inner">
      <a class="logo" href="/" aria-label="FEAST home"><span class="mark">FE<b>A</b>ST</span></a>
      <span class="grow"></span>
      <a class="btn ghost sm" href="/track" aria-label="Track order">${icon('map', 'sm')} <span>Track order</span></a>
      <a class="btn ghost sm" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp', 'sm')} <span>${S.phone}</span></a>
      <button class="btn ghost icon-only" data-theme aria-label="Toggle dark mode">${icon(isDark() ? 'sun' : 'moon')}</button>
      <button class="btn primary cart-btn" data-open-cart>${icon('cart')} <span>Cart</span><span class="cart-count" data-count hidden></span></button>
    </div></header>

    <section class="hero"><div class="bento">
      <div class="b-main">
        <div class="b-copy">
          <span class="eyebrow">${S.opening_hours ? html`<i class="live-dot"></i> Open ${S.opening_hours}` : html`<i class="live-dot"></i> Kitchen is live`}</span>
          <h1>Food that <em>hits</em><br>different.</h1>
          <p>Smash-good burgers, loaded pizzas and saucy wings — made to order and tracked live to your door.</p>
          <div class="row wrap" style="margin-top:24px;gap:10px">
            <a class="btn primary lg" href="#menu">Start your order ${icon('chevron')}</a>
            <a class="btn lg hero-ghost" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
          </div>
        </div>
        <div class="b-plate" aria-hidden="true"><img src="/img/menu/pizza.jpg" alt=""></div>
      </div>
      <div class="b-card b-yellow">
        <span class="kicker">${icon('truck', 'sm')} Free delivery</span>
        <b class="big">${money(S.free_delivery_threshold, cur)}+</b>
        <span>Spend this much and delivery is on us.</span>
      </div>
      <div class="b-card b-red">
        <span class="kicker">${icon('pin', 'sm')} Delivery from</span>
        <b class="big">${S.zones.length ? money(Math.min(...S.zones.map((z) => z.fee)), cur) : '—'}</b>
        <span>${S.zones.map((z) => `${z.name} ${money(z.fee, cur)}`).join(' · ')}</span>
      </div>
      <a class="b-card b-ink" href="/track">
        <span class="kicker">${icon('map', 'sm')} Live tracking</span>
        <b class="mid">Watch your order move</b>
        <span>Kitchen → rider → door, in real time.</span>
      </a>
    </div></section>

    <nav class="cat-bar" id="menu" aria-label="Menu categories"><div class="inner">
      ${featured.length ? html`<button class="chip" data-jump="popular">${icon('fire', 'sm')} Popular</button>` : ''}
      ${categories.map((c) => html`<button class="chip" data-jump="${c.slug}">${c.name}</button>`)}
    </div></nav>

    <div class="store-body">
      <aside class="cat-rail" aria-label="Menu categories">
        <label class="search-box">${icon('search', 'sm')}<input type="search" placeholder="Search the menu" data-search aria-label="Search menu"></label>
        <div class="rail-list">
          ${featured.length ? html`<button class="rail-link" data-jump="popular">${icon('fire', 'sm')} Most loved</button>` : ''}
          ${categories.map((c) => html`<button class="rail-link" data-jump="${c.slug}">${c.name}<span>${c.items.length}</span></button>`)}
        </div>
      </aside>
      <main class="store-main">
        <label class="search-box mobile-search">${icon('search', 'sm')}<input type="search" placeholder="Search burgers, pizza, wings…" data-search aria-label="Search menu"></label>
        ${S.accepting_orders ? '' : html`<div class="banner warn" style="margin-bottom:18px">${icon('alert')} We're not taking online orders right now. You can still browse the menu or WhatsApp us.</div>`}
        <div data-sections>${sections()}</div>
      </main>
      <aside class="cart-panel" aria-label="Your order"><div class="cart-card">
        <div class="cart-card-head"><h2>Your order</h2><span class="muted small" data-panel-count></span></div>
        <div class="cart-card-body" data-panel-body></div>
        <div class="cart-card-foot" data-panel-foot></div>
      </div></aside>
    </div>

    <footer class="store-foot"><div class="inner">
      <div><div class="logo"><span class="mark">FE<b>A</b>ST</span></div><div class="foot-tag">${S.tagline}</div></div>
      <div><b>Delivery</b>${S.zones.map((z) => html`<div>${z.name}: ${money(z.fee, cur)}</div>`)}<div>Free over ${money(S.free_delivery_threshold, cur)}</div></div>
      <div><b>Order by phone</b><div><a href="${wa}" target="_blank" rel="noopener">WhatsApp ${S.phone}</a></div>${S.opening_hours ? html`<div>Open ${S.opening_hours}</div>` : ''}</div>
      <div><b>More</b><div><a href="/track">Track an order</a></div><div><a href="/login">Staff sign in</a></div></div>
    </div></footer>
    <div class="sticky-cart" data-sticky><button class="btn primary lg block" data-open-cart><span class="sticky-n" data-sticky-n></span><span class="grow" style="text-align:left">View your order</span><b data-sticky-total></b></button></div>
  </div>`);

  /* ---------- Cart (shared by the desktop side panel and the mobile drawer) ---------- */
  const cartBody = () => {
    if (!cart.length) return html`<div class="cart-empty">${icon('cart')}<b>Your cart is empty</b><span>Add something tasty from the menu.</span></div>`;
    const sub = subtotal();
    const remain = S.free_delivery_threshold - sub;
    const pct = Math.min(100, Math.round((sub / S.free_delivery_threshold) * 100));
    return html`${cart.map((l, idx) => html`<div class="cart-line">
        ${l.image ? html`<img src="${l.image}" alt="">` : ''}
        <div class="grow"><div class="row between" style="align-items:flex-start"><b>${l.name}</b><b class="num">${money(l.unit_price * l.qty, cur)}</b></div>
          ${l.variant_name ? html`<div class="meta">${l.variant_name}</div>` : ''}
          ${l.addons.length ? html`<div class="meta">+ ${addonText(l.addons)}</div>` : ''}${l.notes ? html`<div class="meta">“${l.notes}”</div>` : ''}
          <div class="qty sm" style="margin-top:6px"><button data-dq="-1" data-i="${idx}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-dq="1" data-i="${idx}" aria-label="Increase">+</button></div></div></div>`)}
      <div class="free-meter">
        <div class="small">${remain > 0 ? html`${icon('truck', 'sm')} Add <b>${money(remain, cur)}</b> more for free delivery` : html`${icon('check', 'sm')} <b>Free delivery unlocked</b>`}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </div>
      <div class="totals"><div class="line grand"><span>Subtotal</span><span>${money(sub, cur)}</span></div><div class="muted tiny">Delivery fee calculated at checkout.</div></div>`;
  };
  const cartFoot = () => (cart.length ? html`<button class="btn danger" data-clear>Clear</button><button class="btn primary lg grow" data-checkout ${S.accepting_orders ? '' : raw('disabled')}>Checkout · ${money(subtotal(), cur)}</button>` : '');
  const changeQty = (i, d) => { const l = cart[i]; l.qty += d; if (l.qty <= 0) cart.splice(i, 1); save(); };

  function paintCartCount() {
    const c = count();
    const b = $('[data-count]', root);
    b.hidden = !c; b.textContent = c;
    $('[data-sticky]', root).classList.toggle('has', c > 0);
    $('[data-sticky-n]', root).textContent = c;
    $('[data-sticky-total]', root).textContent = money(subtotal(), cur);
    $('[data-panel-count]', root).textContent = c ? `${c} item${c === 1 ? '' : 's'}` : '';
    mount($('[data-panel-body]', root), cartBody());
    mount($('[data-panel-foot]', root), cartFoot());
    $$('[data-incart]', root).forEach((el) => {
      const n = inCart(Number(el.dataset.incart));
      el.classList.toggle('has', n > 0);
      mount(el, n ? String(n) : icon('plus'));
    });
  }
  paintCartCount();

  // Highlight the category in view (chips on mobile, rail on desktop)
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      $$('[data-jump]', root).forEach((c) => c.classList.toggle('on', c.dataset.jump === e.target.dataset.sec));
      $('.cat-bar .chip.on', root)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, { rootMargin: '-140px 0px -60% 0px' });
  const observe = () => $$('[data-sec]', root).forEach((s) => io.observe(s));
  observe();

  const offs = [
    on(root, 'click', '[data-item]', async (_e, b) => {
      const item = items.find((i) => i.id === Number(b.dataset.item));
      const line = await pickItem(item, { currency: cur });
      if (line) { addToCart(cart, line); save(); toast(`${line.qty} × ${item.name} added`, 'ok'); }
    }),
    on(root, 'click', '[data-jump]', (_e, b) => document.getElementById(`cat-${b.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth' })),
    on(root, 'click', '[data-open-cart]', () => openCart()),
    on(root, 'click', '[data-theme]', (_e, b) => { toggleTheme(); mount(b, icon(isDark() ? 'sun' : 'moon')); }),
    on(root, 'click', '.cart-panel [data-dq]', (_e, b) => changeQty(Number(b.dataset.i), Number(b.dataset.dq))),
    on(root, 'click', '.cart-panel [data-clear]', () => { cart = []; save(); }),
    on(root, 'click', '.cart-panel [data-checkout]', () => checkout()),
  ];
  const sInputs = $$('[data-search]', root);
  const onSearch = debounce((e) => {
    search = e.target.value.trim();
    sInputs.forEach((i) => { if (i !== e.target) i.value = e.target.value; });
    mount($('[data-sections]', root), sections()); observe();
  }, 150);
  sInputs.forEach((i) => i.addEventListener('input', onSearch));

  /* ---------- Cart drawer (tablet / mobile) ---------- */
  function openCart() {
    modal({
      title: 'Your order', content: cartBody(), foot: cartFoot(), drawer: true,
      onMount: (el, close) => {
        const repaint = () => { mount($('.modal-body', el), cartBody()); const f = $('.modal-foot', el); if (f) mount(f, cartFoot()); };
        const offs2 = [
          on(el, 'click', '[data-dq]', (_e, b) => { changeQty(Number(b.dataset.i), Number(b.dataset.dq)); repaint(); }),
          on(el, 'click', '[data-clear]', () => { cart = []; save(); repaint(); }),
          on(el, 'click', '[data-checkout]', () => { close(); checkout(); }),
        ];
        return () => offs2.forEach((f) => f());
      },
    });
  }

  /* ---------- Checkout ---------- */
  function checkout() {
    const saved = store.get('feast-customer', {});
    let type = saved.type || 'delivery';
    const form = () => html`<form class="stack" data-form novalidate>
      <div class="seg" role="radiogroup" aria-label="Order type">
        ${[['delivery', 'Delivery', 'bike'], ['takeaway', 'Pickup', 'bag'], ['dine_in', 'Dine-in', 'utensils']].map(([v, l, ic]) => html`<button type="button" class="${type === v ? 'on' : ''}" data-type="${v}">${icon(ic, 'sm')} ${l}</button>`)}
      </div>
      <div class="grid g2">
        <label class="field"><span>Your name</span><input class="input" name="customer_name" required minlength="2" value="${saved.customer_name || ''}" autocomplete="name"></label>
        <label class="field"><span>Phone number</span><input class="input" name="phone" required type="tel" placeholder="03XX-XXXXXXX" value="${saved.phone || ''}" autocomplete="tel"></label>
      </div>
      ${type === 'delivery' ? html`
        <label class="field"><span>Area</span><select class="input" name="zone_id" data-num required>${S.zones.map((z) => html`<option value="${z.id}" ${saved.zone_id === z.id ? raw('selected') : ''}>${z.name} — ${money(z.fee, cur)}</option>`)}</select></label>
        <label class="field"><span>Full address</span><textarea class="input" name="address" required minlength="8" placeholder="House #, street, block, landmark" autocomplete="street-address">${saved.address || ''}</textarea></label>` : ''}
      ${type === 'dine_in' ? html`<label class="field"><span>Table</span><select class="input" name="table_no" required>${Array.from({ length: S.tables || 10 }, (_, i) => html`<option>${i + 1}</option>`)}</select></label>` : ''}
      <div class="field"><span>Payment</span><div class="seg">
        <label class="check" style="padding:6px 10px"><input type="radio" name="payment_method" value="cash" checked> ${type === 'delivery' ? 'Cash on delivery' : 'Cash'}</label>
        <label class="check" style="padding:6px 10px"><input type="radio" name="payment_method" value="card"> Card ${type === 'delivery' ? 'on delivery' : 'at counter'}</label>
        <label class="check" style="padding:6px 10px"><input type="radio" name="payment_method" value="wallet"> JazzCash / Easypaisa</label></div></div>
      <label class="field"><span>Order notes (optional)</span><input class="input" name="notes" maxlength="300" placeholder="Anything we should know?" value="${saved.notes || ''}"></label>
      <div class="field"><span>Promo code</span><div class="row"><input class="input mono" name="promo_code" maxlength="30" placeholder="Have a code?" value="${saved.promo_code || ''}" style="text-transform:uppercase" autocomplete="off"><button type="button" class="btn" data-apply>Apply</button></div><div class="small" data-promo-msg></div></div>
      <div class="card card-pad" style="box-shadow:none;background:var(--surface-2)"><div class="totals" data-quote><div class="skeleton" style="height:60px"></div></div></div>
      <div class="error-text" data-err></div>
    </form>`;

    modal({
      title: 'Checkout', content: form(),
      foot: html`<button class="btn" data-close>Back</button><button class="btn primary lg grow" data-place>${icon('check')} Place order</button>`,
      onMount: (el, close) => {
        const quote = async () => {
          const f = $('[data-form]', el);
          const zone = f.zone_id ? Number(f.zone_id.value) : null;
          const promo = f.promo_code.value.trim() || null;
          try {
            const qd = await api('/public/quote', { method: 'POST', body: { type, zone_id: zone, items: cartPayload(cart), promo_code: promo } });
            const msg = $('[data-promo-msg]', el);
            if (msg) mount(msg, qd.promo ? html`<span style="color:var(--ok);font-weight:600">${icon('check', 'sm')} ${qd.promo.code} applied${qd.promo.description ? ` — ${qd.promo.description}` : ''}</span>`
              : qd.promo_error ? html`<span class="error-text">${qd.promo_error}</span>` : '');
            mount($('[data-quote]', el), html`
              <div class="line"><span>Subtotal (${count()} items)</span><span>${money(qd.subtotal, cur)}</span></div>
              ${qd.discount ? html`<div class="line"><span>Promo ${qd.promo ? `(${qd.promo.code})` : ''}</span><span style="color:var(--ok)">− ${money(qd.discount, cur)}</span></div>` : ''}
              ${qd.tax ? html`<div class="line"><span>Tax (${qd.tax_rate}%)</span><span>${money(qd.tax, cur)}</span></div>` : ''}
              ${type === 'delivery' ? html`<div class="line"><span>Delivery</span><span>${qd.delivery_fee ? money(qd.delivery_fee, cur) : html`<b style="color:var(--ok)">FREE</b>`}</span></div>` : ''}
              <div class="line grand"><span>Total</span><span>${money(qd.total, cur)}</span></div>`);
          } catch (e) { mount($('[data-quote]', el), html`<div class="error-text">${e.message}</div>`); }
        };
        quote();
        const repaint = () => { const keep = formData($('[data-form]', el)); Object.assign(saved, keep); mount($('.modal-body', el), form()); quote(); };
        el.addEventListener('change', (e) => { if (e.target.name === 'zone_id' || e.target.name === 'promo_code') quote(); });
        el.addEventListener('keydown', (e) => { if (e.target.name === 'promo_code' && e.key === 'Enter') { e.preventDefault(); quote(); } });
        const offs2 = [
          on(el, 'click', '[data-type]', (_e, b) => { type = b.dataset.type; repaint(); }),
          on(el, 'click', '[data-apply]', () => quote()),
          on(el, 'click', '[data-place]', async (_e, btn) => {
            const f = $('[data-form]', el);
            const err = $('[data-err]', el);
            err.textContent = '';
            if (!f.checkValidity()) { f.reportValidity(); return; }
            const data = formData(f);
            const body = { ...data, type, items: cartPayload(cart) };
            if (body.promo_code && $('[data-promo-msg] .error-text', el)) { err.textContent = 'Remove or fix the promo code before placing your order.'; return; }
            try {
              const order = await busy(btn, () => api('/public/orders', { method: 'POST', body }));
              store.set('feast-customer', { customer_name: data.customer_name, phone: data.phone, address: data.address, zone_id: data.zone_id, type });
              const recent = store.get('feast-orders', []);
              store.set('feast-orders', [{ code: order.code, number: order.number, total: order.total, at: Date.now() }, ...recent].slice(0, 10));
              cart = []; save(); close();
              navigate(`/track/${order.code}`);
            } catch (e2) { err.textContent = e2.message; }
          }),
        ];
        return () => offs2.forEach((f) => f());
      },
    });
  }

  return () => { offs.forEach((f) => f()); io.disconnect(); sInputs.forEach((i) => i.removeEventListener('input', onSearch)); };
}
