// Components shared by storefront, POS, kitchen, rider and admin screens.
import {
  html, raw, icon, money, modal, on, $, $$, mount, api, auth, toast, busy, navigate, toggleTheme, isDark,
  onLiveStatus, initials, statusBadge, typeBadge, fmtDateTime, fmtTime, ACTION_LABEL, STATUS_LABEL,
  promptDialog, confirmDialog, printHTML, disconnectLive, quiet,
} from './core.js';

export const IMG_FALLBACK = '/favicon.svg';
export const spice = (n) => (n ? html`<span class="spice" title="Spicy level ${n}">${'🌶'.repeat(n)}</span>` : '');
export const vegDot = (v) => (v ? html`<span class="veg-dot" title="Vegetarian"></span>` : '');
export const fromPrice = (item) => Math.min(...item.variants.map((v) => v.price));
export const addonText = (addons = []) => addons.map((a) => (typeof a === 'string' ? a : a.name)).join(', ');

/* ---------------- Item options picker ---------------- */
/**
 * Opens the customise dialog for a menu item. Resolves with a cart line
 * { key, item_id, variant_id, addons[], qty, notes, name, variant_name, unit_price, image } or null.
 */
export function pickItem(item, { initial, cta = 'Add to order', currency = 'Rs.' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let variant = item.variants.find((v) => v.id === initial?.variant_id) || item.variants[0];
    let qty = initial?.qty || 1;
    const chosen = new Set(initial?.addons || []);
    const choices = item.choices || [];
    const picks = { ...(initial?.options || {}) };
    const addonsFor = (v) => item.addons.filter((a) => !a.variant_name || a.variant_name === v.name);
    const unit = () => variant.price + addonsFor(variant).filter((a) => chosen.has(a.name)).reduce((s, a) => s + a.price, 0);

    const body = () => html`
      <div class="pick-head">
        ${item.image ? html`<div class="pick-ph"><img src="${item.image}" alt="" onerror="this.remove()"></div>` : ''}
        <div class="grow"><div class="row" style="gap:6px;margin-bottom:4px">${vegDot(item.is_veg)} ${spice(item.spicy)}</div>
          <p class="muted" style="margin:0">${item.description}</p></div>
      </div>
      ${item.variants.length > 1 ? html`<div class="opt-group"><h4>Choose size / option <span class="badge">Required</span></h4>
        ${item.variants.map((v) => html`<label class="opt"><span class="row"><input type="radio" name="variant" value="${v.id}" ${v.id === variant.id ? raw('checked') : ''}>${v.name}</span><span>${money(v.price, currency)}</span></label>`)}
      </div>` : ''}
      ${choices.map((g) => html`<div class="opt-group" data-group="${g.group}"><h4>Choose ${g.group.toLowerCase()} <span class="badge">Required</span></h4>
        <div class="chip-opts">${g.options.map((o) => html`<label class="chip-opt"><input type="radio" name="choice:${g.group}" value="${o}" ${picks[g.group] === o ? raw('checked') : ''}><span>${o}</span></label>`)}</div></div>`)}
      <div data-addons>${addonsBlock()}</div>
      <label class="field"><span>Special instructions (optional)</span><input class="input" name="notes" maxlength="200" placeholder="e.g. no onions, extra spicy" value="${initial?.notes || ''}"></label>`;
    const addonsBlock = () => {
      const list = addonsFor(variant);
      return list.length ? html`<div class="opt-group"><h4>Add-ons <span class="muted small">Optional</span></h4>
        ${list.map((a) => html`<label class="opt"><span class="row"><input type="checkbox" name="addon" value="${a.name}" ${chosen.has(a.name) ? raw('checked') : ''}>${a.name}</span><span>+ ${money(a.price, currency)}</span></label>`)}</div>` : '';
    };
    const foot = () => html`<div class="qty"><button data-q="-1" aria-label="Decrease">−</button><span data-qty>${qty}</span><button data-q="1" aria-label="Increase">+</button></div>
      <button class="btn primary lg grow" data-add>${cta} · <span data-total>${money(unit() * qty, currency)}</span></button>`;

    modal({
      title: item.name, content: body(), foot: foot(),
      onMount: (el, close) => {
        const refresh = () => { $('[data-total]', el).textContent = money(unit() * qty, currency); $('[data-qty]', el).textContent = qty; };
        el.addEventListener('change', (e) => {
          if (e.target.name === 'variant') {
            variant = item.variants.find((v) => v.id === Number(e.target.value));
            for (const n of [...chosen]) if (!addonsFor(variant).some((a) => a.name === n)) chosen.delete(n);
            mount($('[data-addons]', el), addonsBlock());
          }
          if (e.target.name === 'addon') e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value);
          if (e.target.name.startsWith('choice:')) { picks[e.target.name.slice(7)] = e.target.value; e.target.closest('.opt-group').classList.remove('missing'); }
          refresh();
        });
        on(el, 'click', '[data-q]', (_e, b) => { qty = Math.min(50, Math.max(1, qty + Number(b.dataset.q))); refresh(); });
        on(el, 'click', '[data-add]', () => {
          const missing = choices.filter((g) => !picks[g.group]);
          if (missing.length) {
            missing.forEach((g) => $(`[data-group="${CSS.escape(g.group)}"]`, el)?.classList.add('missing'));
            $(`[data-group="${CSS.escape(missing[0].group)}"]`, el)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            toast(`Please choose ${missing.map((g) => g.group.toLowerCase()).join(' and ')}`, 'bad');
            return;
          }
          const options = Object.fromEntries(choices.map((g) => [g.group, picks[g.group]]));
          const addons = addonsFor(variant).filter((a) => chosen.has(a.name)).map((a) => a.name);
          const notes = $('[name=notes]', el).value.trim() || null;
          result = {
            key: `${item.id}:${variant.id}:${addons.sort().join('|')}:${Object.values(options).join('|')}:${notes || ''}`,
            item_id: item.id, variant_id: variant.id, addons, options, qty, notes,
            name: item.name, variant_name: [item.variants.length > 1 ? variant.name : null, ...Object.values(options)].filter(Boolean).join(' · ') || null, unit_price: unit(), image: item.image,
          };
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}

/** Merge a picked line into a cart array (same options => increase qty). */
export function addToCart(cart, line) {
  const ex = cart.find((l) => l.key === line.key);
  if (ex) ex.qty = Math.min(50, ex.qty + line.qty); else cart.push(line);
  return cart;
}
export const cartPayload = (cart) => cart.map(({ item_id, variant_id, addons, options, qty, notes }) => ({ item_id, variant_id, addons, options: options || {}, qty, notes }));

/* ---------------- Receipt ---------------- */
export function receiptHTML(o, settings = {}) {
  return html`<div class="receipt">
    <div class="c"><b style="font-size:20px">${settings.name || 'FEAST'}</b><br>${settings.tagline || ''}<br>${settings.phone ? `Tel/WhatsApp ${settings.phone}` : ''}</div>
    <hr><div class="l"><span>Order #${o.id || o.number}</span><span>${o.code}</span></div>
    <div>${fmtDateTime(o.created_at)}</div>
    <div>${o.type === 'dine_in' ? `Dine-in · Table ${o.table_no}` : o.type === 'delivery' ? 'Delivery' : 'Takeaway'}</div>
    ${o.customer_name ? html`<div>${o.customer_name} ${o.phone || ''}</div>` : ''}
    ${o.address ? html`<div>${o.address}</div>` : ''}
    <hr>
    ${o.items.map((i) => html`<div class="l"><span>${i.qty} x ${i.name}${i.variant_name ? ` (${i.variant_name})` : ''}</span><span>${money(i.line_total, '')}</span></div>
      ${i.addons?.length ? html`<div style="padding-left:14px">+ ${addonText(i.addons)}</div>` : ''}`)}
    <hr>
    <div class="l"><span>Subtotal</span><span>${money(o.subtotal, '')}</span></div>
    ${o.discount ? html`<div class="l"><span>Discount</span><span>-${money(o.discount, '')}</span></div>` : ''}
    ${o.tax ? html`<div class="l"><span>Tax</span><span>${money(o.tax, '')}</span></div>` : ''}
    ${o.type === 'delivery' ? html`<div class="l"><span>Delivery</span><span>${o.delivery_fee ? money(o.delivery_fee, '') : 'FREE'}</span></div>` : ''}
    <div class="l" style="font-size:16px;font-weight:bold"><span>TOTAL</span><span>${money(o.total)}</span></div>
    <div class="l"><span>Payment</span><span>${String(o.payment_method).toUpperCase()} · ${String(o.payment_status).toUpperCase()}</span></div>
    <hr><div class="c">Thank you for choosing FEAST!<br>Taste that hits different.</div></div>`;
}
/** Kitchen order ticket */
export function kotHTML(o) {
  return html`<div class="receipt"><div class="c"><b style="font-size:22px">#${o.id}</b><br>${o.type.replace('_', '-').toUpperCase()}${o.table_no ? ` · T${o.table_no}` : ''}<br>${fmtTime(o.created_at)}</div><hr>
    ${o.items.map((i) => html`<div style="font-size:15px"><b>${i.qty} x ${i.name}</b>${i.variant_name ? ` (${i.variant_name})` : ''}</div>
      ${i.addons?.length ? html`<div>+ ${addonText(i.addons)}</div>` : ''}${i.notes ? html`<div><b>NOTE: ${i.notes}</b></div>` : ''}`)}
    ${o.notes ? html`<hr><b>ORDER NOTE: ${o.notes}</b>` : ''}</div>`;
}

/* ---------------- Staff shell ---------------- */
const NAV = [
  { href: '/admin', label: 'Admin', icon: 'chart', roles: ['manager'] },
  { href: '/pos', label: 'POS', icon: 'cash', roles: ['manager', 'cashier', 'waiter'] },
  { href: '/live', label: 'Live orders', icon: 'list', roles: ['manager', 'cashier', 'waiter'] },
  { href: '/tables', label: 'Tables', icon: 'table', roles: ['manager', 'cashier', 'waiter'] },
  { href: '/kitchen', label: 'Kitchen', icon: 'chef', roles: ['manager', 'chef', 'cashier'] },
  { href: '/admin/close', label: 'Day close', icon: 'receipt', roles: ['cashier'] },
  { href: '/rider', label: 'Deliveries', icon: 'bike', roles: ['rider'] },
];

/** Renders the staff top bar + a content container. Returns { main, cleanup }. */
export function staffShell(root, { active, menuButton = false } = {}) {
  const u = auth.user;
  const links = NAV.filter((n) => (['admin', 'manager'].includes(u.role) && n.href === '/admin/close') ? false : u.role === 'admin' ? n.href !== '/rider' : n.roles.includes(u.role));
  mount(root, html`<div class="shell">
    <header class="topbar">
      ${menuButton ? html`<button class="btn ghost icon-only menu-toggle" data-sidebar aria-label="Menu">${icon('menu')}</button>` : ''}
      <a class="logo" href="${links[0]?.href || '/'}"><span class="mark">FE<b>A</b>ST</span></a>
      <nav class="topnav grow">${links.map((l) => html`<a href="${l.href}" class="${active === l.href ? 'on' : ''}">${icon(l.icon, 'sm')}<span>${l.label}</span></a>`)}</nav>
      <span class="live-dot" data-live title="Live updates"></span>
      <button class="btn ghost sm" data-clock title="Clock in / out">${icon('clock', 'sm')}<span data-clock-label class="hide-sm">Shift</span></button>
      <button class="btn ghost icon-only" data-theme aria-label="Toggle dark mode">${icon(isDark() ? 'sun' : 'moon')}</button>
      <div class="user-chip"><span class="avatar" title="${u.name} (${u.role})">${initials(u.name)}</span></div>
      <button class="btn ghost icon-only" data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button>
    </header>
    <div data-main class="grow" style="display:flex;flex-direction:column"></div>
  </div>`);
  const offs = [
    onLiveStatus((ok) => { const d = $('[data-live]', root); if (d) { d.classList.toggle('off', !ok); d.title = ok ? 'Live: connected' : 'Live: reconnecting…'; } }),
    on(root, 'click', '[data-theme]', (_e, b) => { toggleTheme(); mount(b, icon(isDark() ? 'sun' : 'moon')); }),
    on(root, 'click', '[data-logout]', async () => {
      if (!(await confirmDialog('Sign out of FEAST?', { ok: 'Sign out' }))) return;
      await quiet(api('/auth/logout', { method: 'POST' }));
      auth.clear(); disconnectLive(); navigate('/login');
    }),
    on(root, 'click', '[data-clock]', () => shiftDialog(root)),
  ];
  refreshShift(root);
  return { main: $('[data-main]', root), cleanup: () => offs.forEach((f) => f()) };
}

async function refreshShift(root) {
  try {
    const s = await api('/staff/attendance/me');
    const lbl = $('[data-clock-label]', root);
    if (lbl) lbl.textContent = s.open ? `On shift · ${fmtTime(s.open.clock_in)}` : 'Clock in';
    $('[data-clock]', root)?.classList.toggle('ok', !s.open);
  } catch { /* ignore */ }
}
async function shiftDialog(root) {
  const s = await api('/staff/attendance/me');
  const action = s.open ? 'out' : 'in';
  if (!(await confirmDialog(s.open ? `You clocked in at ${fmtTime(s.open.clock_in)}. Clock out now?` : 'Start your shift now?',
    { title: s.open ? 'Clock out' : 'Clock in', ok: s.open ? 'Clock out' : 'Clock in' }))) return;
  try {
    await api('/staff/attendance/me', { method: 'POST', body: { action } });
    toast(action === 'in' ? 'Shift started. Have a great one!' : 'Shift ended. Thank you!', 'ok');
    refreshShift(root);
  } catch (e) { toast(e.message, 'bad'); }
}

/* ---------------- Order detail (staff) ---------------- */
let cachedRiders = null;
export async function riders(force = false) {
  if (!cachedRiders || force) cachedRiders = await api('/rider/list');
  return cachedRiders;
}
let cachedSettings = null;
export async function publicSettings() {
  cachedSettings ||= await api('/settings/public');
  return cachedSettings;
}

/** Runs a status transition, prompting for whatever extra info that transition needs. */
export async function runAction(order, to, btn) {
  if (to === 'served') return busy(btn, () => api(`/orders/${order.id}/served`, { method: 'POST' }));
  const body = { to };
  if (to === 'cancelled') {
    const reason = await promptDialog({ title: `Cancel order #${order.id}`, label: 'Reason', options: ['Customer cancelled', 'Customer not reachable', 'Item unavailable', 'Duplicate order', 'Wrong address', 'Other'], ok: 'Cancel order' });
    if (!reason) return null;
    body.reason = reason;
  }
  if (to === 'out_for_delivery' && auth.user.role !== 'rider' && !order.rider_id) {
    const list = await riders(true);
    if (!list.length) { toast('No active riders. Add one under Staff.', 'bad'); return null; }
    const pick = await promptDialog({ title: 'Dispatch with rider', label: 'Rider', options: list.map((r) => `${r.name}${r.on_shift ? '' : ' (off shift)'} · ${r.active_deliveries} active`), ok: 'Dispatch' });
    if (!pick) return null;
    body.rider_id = list.find((r) => pick.startsWith(r.name)).id;
  }
  if (to === 'completed' && order.payment_status !== 'paid') {
    const m = await promptDialog({ title: `Collect ${money(order.total)}`, label: 'Payment method', options: ['cash', 'card', 'wallet'], ok: 'Paid & complete' });
    if (!m) return null;
    body.payment_method = m;
  }
  if (to === 'delivered' && order.payment_status !== 'paid' && order.payment_method === 'cash') {
    if (!(await confirmDialog(html`Confirm you collected <b>${money(order.total)}</b> cash from ${order.customer_name || 'the customer'}.`, { title: 'Cash collected?', ok: 'Yes, delivered' }))) return null;
  }
  return busy(btn, () => api(`/orders/${order.id}/status`, { method: 'POST', body }));
}

export function actionButtons(o, { size = '' } = {}) {
  const primary = o.actions.filter((a) => a !== 'cancelled' && !(a === 'ready' && o.status === 'out_for_delivery'));
  return html`${primary.map((a) => html`<button class="btn ${size} ${a === 'preparing' ? 'accent' : a === 'ready' || a === 'completed' || a === 'delivered' || a === 'served' ? 'ok' : 'primary'}" data-action="${a}" data-id="${o.id}">${ACTION_LABEL[a]}</button>`)}`;
}

export async function openOrder(id, { onChange } = {}) {
  const settings = await publicSettings();
  let o = await api(`/orders/${id}`);
  const content = () => html`
    <div class="row wrap" style="margin-bottom:14px">${statusBadge(o.status)} ${typeBadge(o.type)} <span class="badge">${o.source}</span>
      <span class="badge ${o.payment_status === 'paid' ? 'ok' : o.payment_status === 'refunded' ? 'bad' : 'warn'}">${o.payment_method} · ${o.payment_status}</span></div>
    <dl class="kv" style="margin:0 0 16px">
      <dt>Code</dt><dd>${o.code}</dd>
      <dt>Placed</dt><dd>${fmtDateTime(o.created_at)}</dd>
      ${o.customer_name ? html`<dt>Customer</dt><dd>${o.customer_name} ${o.phone ? html`· <a href="tel:${o.phone}">${o.phone}</a>` : ''}</dd>` : ''}
      ${o.type === 'delivery' ? html`<dt>Address</dt><dd>${o.address} <span class="muted">(${o.zone_name || '—'})</span></dd>` : ''}
      ${o.table_no ? html`<dt>Table</dt><dd>${o.table_no}</dd>` : ''}
      ${o.type === 'delivery' ? html`<dt>Rider</dt><dd>${o.rider_name || html`<span class="muted">Not assigned</span>`}</dd>` : ''}
      ${o.notes ? html`<dt>Notes</dt><dd style="color:var(--bad)">${o.notes}</dd>` : ''}
      ${o.cancel_reason ? html`<dt>Cancelled</dt><dd style="color:var(--bad)">${o.cancel_reason}</dd>` : ''}
      ${o.created_by_name ? html`<dt>Taken by</dt><dd>${o.created_by_name}</dd>` : ''}
    </dl>
    <div class="card" style="box-shadow:none"><table class="table"><tbody>
      ${o.items.map((i) => html`<tr><td><b>${i.qty} ×</b> ${i.name}${i.variant_name ? html` <span class="muted">(${i.variant_name})</span>` : ''}
        ${i.addons.length ? html`<div class="tiny muted">+ ${addonText(i.addons)}</div>` : ''}${i.notes ? html`<div class="tiny" style="color:var(--bad)">${i.notes}</div>` : ''}</td>
        <td class="num">${money(i.line_total)}</td></tr>`)}
    </tbody></table></div>
    <div class="totals" style="margin:14px 4px">
      <div class="line"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
      ${o.discount ? html`<div class="line"><span>Discount</span><span>− ${money(o.discount)}</span></div>` : ''}
      ${o.tax ? html`<div class="line"><span>Tax</span><span>${money(o.tax)}</span></div>` : ''}
      ${o.type === 'delivery' ? html`<div class="line"><span>Delivery</span><span>${o.delivery_fee ? money(o.delivery_fee) : 'Free'}</span></div>` : ''}
      <div class="line grand"><span>Total</span><span>${money(o.total)}</span></div>
      ${auth.is('manager') ? html`<div class="line muted small"><span>Ingredient cost (COGS)</span><span>${money(o.cogs)} · margin ${o.subtotal ? Math.round(((o.subtotal - o.discount - o.cogs) / o.subtotal) * 100) : 0}%</span></div>` : ''}
    </div>
    ${o.type === 'delivery' && ['received', 'preparing', 'ready'].includes(o.status) && auth.is('manager', 'cashier') ? html`
      <div class="row" style="margin-bottom:16px"><label class="field grow"><span>Assign rider</span><select class="input" data-assign><option value="">— Unassigned —</option></select></label></div>` : ''}
    <h4 style="margin:6px 0 10px">Timeline</h4>
    <ul class="timeline">${(o.events || []).map((e) => html`<li><b>${STATUS_LABEL[e.to_status]}</b> <span class="muted">· ${fmtDateTime(e.created_at)}${e.employee_name ? ` · ${e.employee_name}` : ''}</span>${e.note ? html`<div class="small muted">${e.note}</div>` : ''}</li>`)}</ul>`;
  const foot = () => html`
    <button class="btn" data-print>${icon('print', 'sm')} Receipt</button>
    <button class="btn" data-kot>${icon('chef', 'sm')} KOT</button>
    ${o.actions.includes('cancelled') ? html`<button class="btn danger" data-action="cancelled" data-id="${o.id}">Cancel</button>` : ''}
    ${o.status === 'out_for_delivery' && o.actions.includes('ready') ? html`<button class="btn" data-action="ready" data-id="${o.id}">${icon('undo', 'sm')} Returned</button>` : ''}
    <span class="grow"></span>${actionButtons(o)}`;

  const { el } = modal({
    title: `Order #${o.id}`, content: content(), foot: foot(), drawer: true,
    onMount: (el) => {
      const fillRiders = async () => {
        const sel = $('[data-assign]', el);
        if (!sel) return;
        const list = await riders(true);
        sel.innerHTML += list.map((r) => `<option value="${r.id}" ${r.id === o.rider_id ? 'selected' : ''}>${r.name} · ${r.active_deliveries} active${r.on_shift ? '' : ' (off shift)'}</option>`).join('');
      };
      fillRiders();
      const rerender = async (updated) => {
        o = { ...(await api(`/orders/${id}`)), ...(updated ? {} : {}) };
        mount($('.modal-body', el), content()); mount($('.modal-foot', el), foot()); fillRiders();
        onChange?.(o);
      };
      el.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-assign]')) return;
        try { await api(`/orders/${o.id}/assign`, { method: 'POST', body: { rider_id: e.target.value ? Number(e.target.value) : null } }); toast('Rider updated', 'ok'); rerender(); } catch (err) { toast(err.message, 'bad'); }
      });
      const offs = [
        on(el, 'click', '[data-action]', async (_e, b) => { const r = await runAction(o, b.dataset.action, b).catch(() => null); if (r) { toast(`Order #${o.id}: ${STATUS_LABEL[r.status]}`, 'ok'); rerender(); } }),
        on(el, 'click', '[data-print]', () => printHTML(receiptHTML(o, settings))),
        on(el, 'click', '[data-kot]', () => printHTML(kotHTML(o))),
      ];
      return () => offs.forEach((f) => f());
    },
  });
  return el;
}

/* ---------------- Admin layout ---------------- */
const ADMIN_NAV = [
  ['Overview', [['/admin', 'Dashboard', 'chart'], ['/admin/orders', 'Orders', 'receipt'], ['/admin/customers', 'Customers', 'users']]],
  ['Operations', [['/admin/menu', 'Menu & recipes', 'utensils'], ['/admin/inventory', 'Inventory', 'box'], ['/admin/purchasing', 'Purchasing', 'truck']]],
  ['People', [['/admin/staff', 'Staff & shifts', 'users'], ['/admin/payroll', 'Payroll', 'wallet']]],
  ['Money', [['/admin/close', 'Day close', 'receipt'], ['/admin/reports', 'Reports', 'file'], ['/admin/finance', 'Finance & ledger', 'cash']]],
  ['System', [['/admin/settings', 'Settings', 'settings']]],
];
export function adminShell(root, active) {
  const { main, cleanup } = staffShell(root, { active: '/admin', menuButton: true });
  mount(main, html`<div class="admin">
    <aside class="sidebar" data-sb>${ADMIN_NAV.map(([g, links]) => html`<div class="grp">${g}</div>${links.map(([href, label, ic]) => html`<a href="${href}" class="${active === href ? 'on' : ''}">${icon(ic, 'sm')} ${label}${href === '/admin/inventory' ? html`<span class="badge bad" data-lowcount hidden></span>` : ''}</a>`)}`)}</aside>
    <main class="page" data-page></main></div>`);
  const off = on(root, 'click', '[data-sidebar]', () => $('[data-sb]', root).classList.toggle('open'));
  const off2 = on(root, 'click', '.sidebar a', () => $('[data-sb]', root).classList.remove('open'));
  api('/inventory/low-stock').then((l) => { const b = $('[data-lowcount]', root); if (b && l.length) { b.hidden = false; b.textContent = l.length; } }).catch(() => {});
  return { page: $('[data-page]', root), cleanup: () => { cleanup(); off(); off2(); } };
}

export const pageHead = (title, sub, actions = '') => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div><div class="row wrap">${actions}</div></div>`;
export const loading = () => html`<div class="spinner"></div>`;
export const emptyState = (msg, ic = 'box') => html`<div class="empty">${icon(ic)}<div>${msg}</div></div>`;
export { $$ };
