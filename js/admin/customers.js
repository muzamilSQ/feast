import { html, icon, money, mount, on, $, api, fmtDate, fmtDateTime, debounce, modal, statusBadge, typeBadge } from '../core.js';
import { adminShell, pageHead, loading, emptyState, openOrder } from '../shared.js';

const waLink = (phone) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '92')}`;

export default async function customers(root) {
  const { page, cleanup } = adminShell(root, '/admin/customers');
  mount(page, html`${pageHead('Customers', 'Built automatically from orders by phone number. Ranked by lifetime spend.')}
    <div class="toolbar"><input class="input sm" type="search" data-q placeholder="Search name, phone, address" style="width:260px"></div><div class="card" data-list>${loading()}</div>`);
  const all = await api('/reports/customers');
  const paint = (q = '') => {
    const s = q.toLowerCase();
    const rows = all.filter((c) => !s || `${c.name} ${c.phone} ${c.address || ''}`.toLowerCase().includes(s));
    mount($('[data-list]', page), rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th class="num">Orders</th><th class="num">Lifetime spend</th><th class="num">Avg order</th><th>Last order</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 300).map((c) => html`<tr class="clickable" data-cust="${c.id}"><td><b>${c.name}</b>${c.orders >= 5 ? html` <span class="badge brand">${icon('star', 'sm')} Regular</span>` : ''}</td><td class="nowrap"><a href="tel:${c.phone}">${c.phone}</a></td><td class="small">${c.address || '—'}</td><td class="num">${c.orders}</td><td class="num"><b>${money(c.spent)}</b></td><td class="num">${c.orders ? money(c.spent / c.orders) : '—'}</td><td class="small nowrap">${c.last_order ? fmtDate(c.last_order) : '—'}</td>
        <td class="right"><a class="btn sm ghost" href="${waLink(c.phone)}" target="_blank" rel="noopener" title="WhatsApp">${icon('whatsapp', 'sm')}</a></td></tr>`)}</tbody></table></div>` : emptyState('No customers found', 'users'));
  };
  paint();
  const input = $('[data-q]', page);
  const onInput = debounce(() => paint(input.value.trim()), 200);
  input.addEventListener('input', onInput);
  const offClick = on(page, 'click', '[data-cust]', (e, tr) => { if (!e.target.closest('a')) openCustomer(Number(tr.dataset.cust)); });
  return () => { cleanup(); offClick(); input.removeEventListener('input', onInput); };
}

async function openCustomer(id) {
  const { el } = modal({ title: 'Customer', content: loading(), drawer: true,
    onMount: (m) => on(m, 'click', '[data-order]', (_e, tr) => openOrder(Number(tr.dataset.order))) });
  const c = await api(`/reports/customers/${id}`);
  const s = c.stats;
  mount($('.modal-head h2', el), c.name);
  mount($('.modal-body', el), html`
    <div class="row wrap" style="margin-bottom:14px"><a class="btn sm" href="tel:${c.phone}">${icon('phone', 'sm')} ${c.phone}</a><a class="btn sm" href="${waLink(c.phone)}" target="_blank" rel="noopener">${icon('whatsapp', 'sm')} WhatsApp</a></div>
    ${c.address ? html`<div class="small muted" style="margin-bottom:14px">${icon('pin', 'sm')} ${c.address}</div>` : ''}
    <div class="grid g2" style="gap:10px;margin-bottom:16px">
      <div class="card kpi"><div class="label">Lifetime spend</div><div class="value" style="font-size:22px">${money(s.spent)}</div></div>
      <div class="card kpi"><div class="label">Orders</div><div class="value" style="font-size:22px">${s.orders}</div><div class="delta muted">${s.cancelled ? `${s.cancelled} cancelled` : 'none cancelled'}</div></div>
      <div class="card kpi"><div class="label">Average order</div><div class="value" style="font-size:22px">${money(s.avg)}</div></div>
      <div class="card kpi"><div class="label">Customer since</div><div class="value" style="font-size:22px">${s.first ? fmtDate(s.first) : '—'}</div></div>
    </div>
    ${c.favourites.length ? html`<h4 style="margin:0 0 8px">Usually orders</h4><div class="row wrap" style="gap:6px;margin-bottom:16px">${c.favourites.map((f) => html`<span class="badge">${f.name} × ${f.qty}</span>`)}</div>` : ''}
    <h4 style="margin:0 0 8px">Order history</h4>
    ${c.orders.length ? html`<div class="card"><table class="table"><tbody>${c.orders.map((o) => html`<tr class="clickable" data-order="${o.id}"><td><b>#${o.id}</b><div class="tiny muted">${fmtDateTime(o.created_at)}</div></td><td>${typeBadge(o.type)}</td><td>${statusBadge(o.status)}</td><td class="num"><b>${money(o.total)}</b></td></tr>`)}</tbody></table></div>` : emptyState('No orders yet')}`);
}
