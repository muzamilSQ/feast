import { html, icon, money, mount, on, $, api, download, fmtDateTime, debounce, typeBadge, statusBadge, live } from '../core.js';
import { adminShell, pageHead, openOrder, emptyState, loading } from '../shared.js';
import { rangeBar, wireRange, defaultRange, csvBtn } from './common.js';

export default async function orders(root) {
  const { page, cleanup } = adminShell(root, '/admin/orders');
  const r = defaultRange('7d');
  const f = { status: 'all', type: '', q: '', page: 1 };
  mount(page, html`${pageHead('Orders', 'Every order with its full audit trail. Delivered and completed orders are automatically posted to the ledger.', csvBtn())}
    <div class="toolbar">${rangeBar(r)}
      <select class="input sm" data-k="status" style="width:auto"><option value="all">All statuses</option><option value="open">Open</option><option value="closed">Delivered / completed</option><option value="cancelled">Cancelled</option></select>
      <select class="input sm" data-k="type" style="width:auto"><option value="">All types</option><option value="delivery">Delivery</option><option value="takeaway">Takeaway</option><option value="dine_in">Dine-in</option></select>
      <input class="input sm" type="search" data-k="q" placeholder="Order #, code, name, phone" style="width:220px"></div>
    <div class="card" data-list>${loading()}</div>`);
  const qs = () => new URLSearchParams({ ...f, from: r.from, to: r.to }).toString();
  const load = async () => {
    const d = await api(`/orders?${qs()}`);
    mount($('[data-list]', page), d.rows.length ? html`<div class="card-head"><span class="small muted">${d.total} orders · ${money(d.revenue)} completed revenue</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Type</th><th>Items</th><th>Status</th><th>Payment</th><th>Rider</th><th class="num">Total</th><th class="num">Margin</th></tr></thead><tbody>
      ${d.rows.map((o) => html`<tr class="clickable" data-open="${o.id}"><td><b>#${o.id}</b><div class="tiny muted">${o.code} · ${o.source}</div></td><td class="small">${fmtDateTime(o.created_at)}</td>
        <td>${o.customer_name || html`<span class="muted">Walk-in</span>`}<div class="tiny muted">${o.phone || ''}</div></td><td>${typeBadge(o.type)}</td><td class="num">${o.item_count}</td><td>${statusBadge(o.status)}</td>
        <td><span class="badge ${o.payment_status === 'paid' ? 'ok' : o.payment_status === 'refunded' ? 'bad' : 'warn'}">${o.payment_method} · ${o.payment_status}</span></td><td class="small">${o.rider_name || '—'}</td>
        <td class="num"><b>${money(o.total)}</b></td><td class="num small">${o.subtotal ? Math.round(((o.subtotal - o.discount - o.cogs) / o.subtotal) * 100) : 0}%</td></tr>`)}
      </tbody></table></div>
      <div class="pager"><span class="small muted">Page ${d.page} of ${d.pages}</span><div class="row"><button class="btn sm" data-pg="-1" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-pg="1" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div></div>`
      : emptyState('No orders match these filters', 'receipt'));
  };
  await load();
  wireRange(page, r, () => { f.page = 1; load(); });
  const search = debounce(load, 300);
  const offs = [
    cleanup,
    live('order:new', () => f.page === 1 && load()),
    on(page, 'change', 'select[data-k]', (_e, el) => { f[el.dataset.k] = el.value; f.page = 1; load(); }),
    on(page, 'input', 'input[data-k]', (_e, el) => { f.q = el.value.trim(); f.page = 1; search(); }),
    on(page, 'click', '[data-pg]', (_e, b) => { f.page += Number(b.dataset.pg); load(); }),
    on(page, 'click', '[data-open]', (_e, el) => openOrder(Number(el.dataset.open), { onChange: load })),
    on(page, 'click', '[data-csv]', () => download(`/orders?${qs()}&format=csv`, `orders-${r.from}-to-${r.to}.csv`)),
  ];
  return () => offs.forEach((x) => x());
}
