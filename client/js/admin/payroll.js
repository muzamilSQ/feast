import { html, icon, money, mount, on, $, api, toast, modal, busy, confirmDialog, formData, num, localISO, printHTML, fmtDate } from '../core.js';
import { adminShell, pageHead, loading, emptyState, publicSettings } from '../shared.js';

const monthRange = (offset = 0) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { period_start: localISO(d), period_end: localISO(end) };
};

export default async function payroll(root) {
  const { page, cleanup } = adminShell(root, '/admin/payroll');
  let d;
  let sel = null;
  mount(page, html`${pageHead('Payroll', 'Salaries from base pay, attendance hours and delivery commissions, minus advances. Paying a payslip posts it to the ledger.')}
    <div class="card card-pad" style="margin-bottom:16px"><form class="row wrap" data-gen>
      <div class="seg"><button type="button" data-month="-1">Last month</button><button type="button" data-month="0">This month</button></div>
      <label class="row small">From <input class="input sm" type="date" name="period_start" required style="width:auto"></label>
      <label class="row small">To <input class="input sm" type="date" name="period_end" required style="width:auto"></label>
      <button class="btn primary">${icon('refresh', 'sm')} Generate / recalculate</button>
      <span class="small muted">Recalculating keeps bonuses & deductions; paid slips are locked.</span></form></div>
    <div data-body>${loading()}</div>`);
  const gen = $('[data-gen]', page);
  const setRange = (r) => { gen.period_start.value = r.period_start; gen.period_end.value = r.period_end; };
  setRange(monthRange(-1));

  const paint = () => {
    const rows = d.rows;
    const t = rows.reduce((s, r) => ({ base: s.base + r.base_pay, hourly: s.hourly + r.hourly_pay, comm: s.comm + r.commission, bonus: s.bonus + r.bonus, ded: s.ded + r.deductions, adv: s.adv + r.advances, net: s.net + r.net_pay }), { base: 0, hourly: 0, comm: 0, bonus: 0, ded: 0, adv: 0, net: 0 });
    mount($('[data-body]', page), html`
      ${d.periods.length ? html`<div class="toolbar"><span class="small muted">Payroll runs:</span>${d.periods.map((p) => html`<button class="btn sm ${p.period_start === d.period_start && p.period_end === d.period_end ? 'is-active' : ''}" data-period="${p.period_start}|${p.period_end}">${fmtDate(p.period_start)} – ${fmtDate(p.period_end)} · ${p.paid}/${p.n} paid</button>`)}</div>` : ''}
      ${rows.length ? html`<div class="card"><div class="card-head"><h3>${fmtDate(d.period_start)} – ${fmtDate(d.period_end)}</h3><div class="row"><b>Net payable ${money(t.net)}</b><button class="btn sm ok" data-payall>${icon('check', 'sm')} Pay all unpaid</button></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th class="num">Base</th><th class="num">Hours</th><th class="num">Hourly pay</th><th class="num">Deliveries</th><th class="num">Commission</th><th class="num">Bonus</th><th class="num">Deductions</th><th class="num">Advances</th><th class="num">Net pay</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><b>${r.name}</b><div class="tiny muted">${r.role} · ${r.pay_type}</div></td><td class="num">${money(r.base_pay)}</td><td class="num">${num(r.hours, 1)}</td><td class="num">${money(r.hourly_pay)}</td>
        <td class="num">${r.deliveries || '—'}</td><td class="num">${money(r.commission)}</td><td class="num">${money(r.bonus)}</td><td class="num">${r.deductions ? `− ${money(r.deductions)}` : '—'}</td><td class="num">${r.advances ? `− ${money(r.advances)}` : '—'}</td>
        <td class="num"><b>${money(r.net_pay)}</b></td><td>${r.status === 'paid' ? html`<span class="badge ok">paid</span>` : html`<span class="badge warn">draft</span>`}</td>
        <td class="right" style="white-space:nowrap">${r.status === 'draft' ? html`<button class="btn sm ghost" data-adj="${r.id}">${icon('edit', 'sm')}</button><button class="btn sm ok" data-pay="${r.id}">Pay</button>` : ''}<button class="btn sm ghost" data-slip="${r.id}" title="Payslip">${icon('print', 'sm')}</button></td></tr>`)}
      </tbody><tfoot><tr><td>Total</td><td class="num">${money(t.base)}</td><td></td><td class="num">${money(t.hourly)}</td><td></td><td class="num">${money(t.comm)}</td><td class="num">${money(t.bonus)}</td><td class="num">${money(t.ded)}</td><td class="num">${money(t.adv)}</td><td class="num">${money(t.net)}</td><td colspan="2"></td></tr></tfoot></table></div></div>`
      : emptyState('No payroll for this period yet. Pick a period and click Generate.', 'wallet')}`);
  };
  const load = async (ps, pe) => {
    d = await api(`/staff/payroll${ps ? `?period_start=${ps}&period_end=${pe}` : ''}`);
    sel = d.period_start ? [d.period_start, d.period_end] : null;
    paint();
  };
  await load();
  const S = await publicSettings();

  const slip = (r) => printHTML(html`<div class="receipt" style="width:420px"><div class="c"><b style="font-size:18px">${S.name} — Payslip</b><br>${fmtDate(r.period_start)} to ${fmtDate(r.period_end)}</div><hr>
    <div class="l"><span>Employee</span><span>${r.name}</span></div><div class="l"><span>Role</span><span>${r.role}</span></div><hr>
    <div class="l"><span>Base salary</span><span>${money(r.base_pay)}</span></div><div class="l"><span>Hours worked (${num(r.hours, 1)})</span><span>${money(r.hourly_pay)}</span></div>
    <div class="l"><span>Delivery commission (${r.deliveries})</span><span>${money(r.commission)}</span></div><div class="l"><span>Bonus</span><span>${money(r.bonus)}</span></div>
    <div class="l"><span>Deductions</span><span>-${money(r.deductions)}</span></div><div class="l"><span>Advances</span><span>-${money(r.advances)}</span></div><hr>
    <div class="l" style="font-weight:bold;font-size:16px"><span>NET PAY</span><span>${money(r.net_pay)}</span></div>
    <div>Status: ${r.status.toUpperCase()}${r.note ? ` · ${r.note}` : ''}</div><br><br><div class="l"><span>______________<br>Employee</span><span>______________<br>Manager</span></div></div>`);

  const offs = [
    cleanup,
    on(page, 'click', '[data-month]', (_e, b) => setRange(monthRange(Number(b.dataset.month)))),
    on(page, 'submit', '[data-gen]', async (e) => {
      e.preventDefault();
      const body = formData(gen);
      try { const r = await api('/staff/payroll/generate', { method: 'POST', body }); toast(`Payroll calculated (${r.created} new payslips)`, 'ok'); load(body.period_start, body.period_end); } catch (err) { toast(err.message, 'bad'); }
    }),
    on(page, 'click', '[data-period]', (_e, b) => { const [a, z] = b.dataset.period.split('|'); load(a, z); }),
    on(page, 'click', '[data-slip]', (_e, b) => slip(d.rows.find((r) => r.id === Number(b.dataset.slip)))),
    on(page, 'click', '[data-pay]', async (_e, b) => {
      const r = d.rows.find((x) => x.id === Number(b.dataset.pay));
      if (!(await confirmDialog(html`Pay <b>${money(r.net_pay)}</b> to ${r.name}?`, { ok: 'Mark paid' }))) return;
      try { await busy(b, () => api(`/staff/payroll/${r.id}/pay`, { method: 'POST', body: {} })); toast('Payslip paid', 'ok'); load(...sel); } catch { /* toasted */ }
    }),
    on(page, 'click', '[data-payall]', async (_e, b) => {
      const unpaid = d.rows.filter((r) => r.status === 'draft');
      if (!unpaid.length) return toast('Everything is already paid');
      const total = unpaid.reduce((s, r) => s + r.net_pay, 0);
      if (!(await confirmDialog(html`Pay <b>${unpaid.length}</b> payslips totalling <b>${money(total)}</b>?`, { ok: 'Pay all' }))) return;
      await busy(b, async () => { for (const r of unpaid) await api(`/staff/payroll/${r.id}/pay`, { method: 'POST', body: {} }); });
      toast('All payslips paid', 'ok'); load(...sel);
    }),
    on(page, 'click', '[data-adj]', (_e, b) => {
      const r = d.rows.find((x) => x.id === Number(b.dataset.adj));
      modal({
        title: `Adjust · ${r.name}`,
        content: html`<form class="stack" data-f><label class="field"><span>Bonus (Rs.)</span><input class="input" type="number" min="0" name="bonus" data-num value="${r.bonus}"></label>
          <label class="field"><span>Deductions (Rs.)</span><input class="input" type="number" min="0" name="deductions" data-num value="${r.deductions}"></label>
          <label class="field"><span>Note</span><input class="input" name="note" value="${r.note || ''}" placeholder="e.g. Eid bonus, late penalty"></label></form>`,
        foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
        onMount: (el, close) => on(el, 'click', '[data-save]', async (_e2, btn) => {
          const body = formData($('[data-f]', el)); body.bonus ||= 0; body.deductions ||= 0;
          try { await busy(btn, () => api(`/staff/payroll/${r.id}`, { method: 'PUT', body })); close(); load(...sel); } catch { /* toasted */ }
        }),
      });
    }),
  ];
  return () => offs.forEach((x) => x());
}
