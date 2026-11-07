import { html, raw, icon, mount, on, $, api, toast, busy, formData, fmtDateTime, fmtDate, auth, promptDialog, modal, money } from '../core.js';
import { adminShell, pageHead, loading } from '../shared.js';

const today = () => new Date().toLocaleDateString('en-CA');
function promoState(p) {
  if (!p.active) return html`<span class="badge">Off</span>`;
  if (p.ends_on && p.ends_on < today()) return html`<span class="badge bad">Expired</span>`;
  if (p.starts_on && p.starts_on > today()) return html`<span class="badge info">Scheduled</span>`;
  if (p.max_uses && p.uses >= p.max_uses) return html`<span class="badge warn">Used up</span>`;
  return html`<span class="badge ok dot">Live</span>`;
}

function promoForm(p = {}) {
  return html`<form class="stack" data-pf>
    <div class="grid g2"><label class="field"><span>Code</span><input class="input mono" name="code" value="${p.code || ''}" required pattern="[A-Za-z0-9_-]{3,20}" placeholder="e.g. FEAST10" style="text-transform:uppercase"></label>
      <label class="field"><span>Shown to customer</span><input class="input" name="description" value="${p.description || ''}" placeholder="10% off online orders"></label></div>
    <div class="grid g2"><label class="field"><span>Type</span><select class="input" name="kind"><option value="percent" ${p.kind !== 'flat' ? raw('selected') : ''}>Percentage off</option><option value="flat" ${p.kind === 'flat' ? raw('selected') : ''}>Fixed amount off (Rs.)</option></select></label>
      <label class="field"><span>Value</span><input class="input" type="number" min="1" name="value" data-num value="${p.value ?? ''}" required></label></div>
    <div class="grid g2"><label class="field"><span>Minimum order (Rs.)</span><input class="input" type="number" min="0" name="min_subtotal" data-num value="${p.min_subtotal ?? 0}"></label>
      <label class="field"><span>Maximum discount (Rs., optional)</span><input class="input" type="number" min="0" name="max_discount" data-num value="${p.max_discount ?? ''}"></label></div>
    <div class="grid g2"><label class="field"><span>Starts (optional)</span><input class="input" type="date" name="starts_on" value="${p.starts_on || ''}"></label>
      <label class="field"><span>Ends (optional)</span><input class="input" type="date" name="ends_on" value="${p.ends_on || ''}"></label></div>
    <label class="field"><span>Usage limit (optional)</span><input class="input" type="number" min="1" name="max_uses" data-num value="${p.max_uses ?? ''}" placeholder="Unlimited"></label>
    <label class="check"><input type="checkbox" name="online_only" ${p.online_only ? raw('checked') : ''}> Online orders only (not POS)</label>
    <label class="check"><input type="checkbox" name="active" ${p.active !== 0 ? raw('checked') : ''}> Active</label>
    ${p.id ? html`<div class="muted small">Used ${p.uses} times · ${money(p.given)} discount given · created ${fmtDate(p.created_at)}</div>` : ''}
  </form>`;
}

export default async function settings(root) {
  let promos = [];
  const { page, cleanup } = adminShell(root, '/admin/settings');
  mount(page, loading());
  const load = async () => {
    const s = await api('/settings');
    const audit = auth.user.role === 'admin' ? await api('/reports/audit') : null;
    promos = await api('/settings/promos');
    mount(page, html`${pageHead('Settings', 'Restaurant details, ordering rules and delivery zones.')}
      <div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start" data-cols>
      <form class="card card-pad stack" data-f>
        <h3>Restaurant</h3>
        <div class="grid g2"><label class="field"><span>Name</span><input class="input" name="restaurant_name" value="${s.restaurant_name}" required></label>
          <label class="field"><span>Tagline</span><input class="input" name="tagline" value="${s.tagline || ''}"></label>
          <label class="field"><span>Phone (display)</span><input class="input" name="phone" value="${s.phone}" required></label>
          <label class="field"><span>WhatsApp number (intl, digits only)</span><input class="input" name="whatsapp" value="${s.whatsapp}" pattern="\\d{10,15}" required></label>
          <label class="field"><span>Address</span><input class="input" name="address" value="${s.address || ''}"></label>
          <label class="field"><span>Opening hours</span><input class="input" name="opening_hours" value="${s.opening_hours || ''}"></label></div>
        <h3 style="margin-top:8px">Ordering</h3>
        <div class="grid g2"><label class="field"><span>Tax rate % (0 if prices include tax)</span><input class="input" type="number" min="0" max="30" step="0.5" name="tax_rate" data-num value="${s.tax_rate}"></label>
          <label class="field"><span>Free delivery above (Rs.)</span><input class="input" type="number" min="0" name="free_delivery_threshold" data-num value="${s.free_delivery_threshold}"></label>
          <label class="field"><span>Minimum online delivery order (Rs.)</span><input class="input" type="number" min="0" name="min_delivery_order" data-num value="${s.min_delivery_order}"></label>
          <label class="field"><span>Dine-in tables</span><input class="input" type="number" min="1" max="200" name="tables" data-num value="${s.tables}"></label>
          <label class="field" style="grid-column:1/-1"><span>Dine-in billing</span><select class="input" name="dine_in_billing">
            <option value="after" ${s.dine_in_billing !== 'before' ? raw('selected') : ''}>Pay after eating: tables run a bill and pay once when completed</option>
            <option value="before" ${s.dine_in_billing === 'before' ? raw('selected') : ''}>Pay when ordering: dine-in orders are paid at the counter</option></select></label></div>
        <label class="check"><input type="checkbox" name="accepting_orders" ${s.accepting_orders !== false ? raw('checked') : ''}> Accepting online orders</label>
        <div><button class="btn primary" data-save>Save settings</button></div>
      </form>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Delivery zones</h3><button class="btn sm" data-addzone>${icon('plus', 'sm')} Zone</button></div>
          <table class="table"><tbody>${s.zones.map((z) => html`<tr><td><input class="input sm" value="${z.name}" data-zname="${z.id}"></td><td><input class="input sm" type="number" min="0" value="${z.fee}" data-zfee="${z.id}" style="width:90px"></td>
            <td><label class="check small"><input type="checkbox" data-zactive="${z.id}" ${z.active ? raw('checked') : ''}> active</label></td><td><button class="btn sm" data-zsave="${z.id}">Save</button></td></tr>`)}</tbody></table></div>
        <div class="card"><div class="card-head"><h3>Promo codes</h3><button class="btn sm" data-promo="new">${icon('plus', 'sm')} Code</button></div>
          ${promos.length ? html`<table class="table"><tbody>${promos.map((p) => html`<tr class="clickable" data-promo="${p.id}">
            <td><b class="mono">${p.code}</b><div class="tiny muted">${p.description || ''}</div></td>
            <td class="small">${p.kind === 'percent' ? `${p.value}% off` : `${money(p.value)} off`}${p.min_subtotal ? html`<div class="tiny muted">min ${money(p.min_subtotal)}</div>` : ''}</td>
            <td class="num small">${p.uses}${p.max_uses ? ` / ${p.max_uses}` : ''} used<div class="tiny muted">${money(p.given)} given</div></td>
            <td class="right">${promoState(p)}</td></tr>`)}</tbody></table>` : html`<div class="card-pad muted small">No promo codes yet. Customers can enter a code at checkout.</div>`}</div>
        <div class="card card-pad"><h3 style="margin-bottom:8px">Quick links</h3><div class="row wrap"><a class="btn" href="/" target="_blank">${icon('store', 'sm')} Online store</a><a class="btn" href="/kitchen">${icon('chef', 'sm')} Kitchen display</a><a class="btn" href="/track">${icon('map', 'sm')} Order tracker</a></div></div>
      </div></div>
      ${audit ? html`<div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('shield', 'sm')} Audit log</h3><span class="small muted">Latest 300 sensitive actions</span></div><div class="table-wrap" style="max-height:420px;overflow:auto"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
        ${audit.map((a) => html`<tr><td class="small">${fmtDateTime(a.created_at)}</td><td>${a.employee || '—'}</td><td><span class="badge">${a.action}</span></td><td class="small">${a.entity || ''} ${a.entity_id || ''}</td><td class="tiny muted" style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.details || ''}</td></tr>`)}</tbody></table></div></div>` : ''}`);
    if (matchMedia('(max-width: 980px)').matches) $('[data-cols]', page).style.gridTemplateColumns = 'minmax(0,1fr)';
  };
  await load();
  const offs = [
    cleanup,
    on(page, 'click', '[data-save]', async (e, btn) => {
      e.preventDefault();
      const f = $('[data-f]', page);
      if (!f.reportValidity()) return;
      try { await busy(btn, () => api('/settings', { method: 'PUT', body: formData(f) })); toast('Settings saved', 'ok'); } catch { /* toasted */ }
    }),
    on(page, 'click', '[data-zsave]', async (_e, b) => {
      const id = b.dataset.zsave;
      try { await busy(b, () => api(`/settings/zones/${id}`, { method: 'PUT', body: { name: $(`[data-zname="${id}"]`, page).value, fee: Number($(`[data-zfee="${id}"]`, page).value), active: $(`[data-zactive="${id}"]`, page).checked } })); toast('Zone saved', 'ok'); } catch { /* toasted */ }
    }),
    on(page, 'click', '[data-promo]', (_e, el) => {
      const p = promos.find((x) => String(x.id) === el.dataset.promo) || {};
      modal({
        title: p.id ? `Edit ${p.code}` : 'New promo code', content: promoForm(p),
        foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-psave>Save code</button>`,
        onMount: (m, close) => on(m, 'click', '[data-psave]', async (_e2, btn) => {
          const f = $('[data-pf]', m);
          if (!f.reportValidity()) return;
          const body = formData(f);
          try {
            await busy(btn, () => api(p.id ? `/settings/promos/${p.id}` : '/settings/promos', { method: p.id ? 'PUT' : 'POST', body }));
            toast('Promo code saved', 'ok'); close(); load();
          } catch { /* toasted */ }
        }),
      });
    }),
    on(page, 'click', '[data-addzone]', async () => {
      const name = await promptDialog({ title: 'New delivery zone', label: 'Area name', ok: 'Next' });
      if (!name) return;
      const fee = await promptDialog({ title: `Delivery fee for ${name}`, label: 'Fee (Rs.)', ok: 'Add zone' });
      if (fee == null) return;
      try { await api('/settings/zones', { method: 'POST', body: { name, fee: Number(fee) } }); load(); } catch (e) { toast(e.message, 'bad'); }
    }),
  ];
  return () => offs.forEach((x) => x());
}
