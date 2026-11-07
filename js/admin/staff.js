import { html, raw, icon, money, mount, on, $, api, toast, modal, busy, formData, fmtTime, fmtDate, num, auth, initials, localISO, daysAgo, parseDate } from '../core.js';
import { adminShell, pageHead, loading, emptyState } from '../shared.js';

const ROLES = ['manager', 'cashier', 'chef', 'waiter', 'rider', 'admin'];
const ROLE_BADGE = { admin: 'brand', manager: 'violet', cashier: 'info', chef: 'warn', waiter: '', rider: 'ok' };

export default async function staff(root) {
  const { page, cleanup } = adminShell(root, '/admin/staff');
  let tab = 'team';
  let emps = [];
  const att = { from: daysAgo(6), to: localISO(), employee_id: '' };
  mount(page, html`${pageHead('Staff & shifts', 'Team members, logins, roles, pay terms and attendance. Staff clock in/out from their own screens.',
    html`<button class="btn primary" data-add>${icon('plus', 'sm')} Team member</button>`)}
    <div class="tabs"><button data-tab="team" class="on">Team</button><button data-tab="att">Attendance</button><button data-tab="adv">Advances</button></div><div data-body>${loading()}</div>`);

  const paintTeam = () => mount($('[data-body]', page), html`<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Login</th><th>Pay</th><th>Shift</th><th class="num">Open advances</th><th></th></tr></thead><tbody>
    ${emps.map((e) => html`<tr style="${e.active ? '' : 'opacity:.5'}"><td><div class="row"><span class="avatar">${initials(e.name)}</span><div><b>${e.name}</b><div class="tiny muted">${e.phone || ''} ${e.cnic ? `· ${e.cnic}` : ''}</div></div></div></td>
      <td><span class="badge ${ROLE_BADGE[e.role]}">${e.role}</span>${e.active ? '' : html` <span class="badge bad">inactive</span>`}</td><td class="small">${e.username || html`<span class="muted">no login</span>`}</td>
      <td class="small">${e.pay_type === 'monthly' ? `${money(e.base_salary)}/month` : `${money(e.hourly_rate)}/hour`}${e.commission_per_delivery ? html`<div class="muted">+ ${money(e.commission_per_delivery)}/delivery</div>` : ''}</td>
      <td>${e.on_shift_since ? html`<span class="badge ok dot">since ${fmtTime(e.on_shift_since)}</span>` : html`<span class="badge">off</span>`}</td>
      <td class="num">${e.open_advances ? money(e.open_advances) : '—'}</td>
      <td class="right" style="white-space:nowrap">${e.active ? html`<button class="btn sm" data-clock="${e.id}" data-act="${e.on_shift_since ? 'out' : 'in'}">${e.on_shift_since ? 'Clock out' : 'Clock in'}</button>` : ''}<button class="btn sm ghost" data-edit="${e.id}">${icon('edit', 'sm')}</button></td></tr>`)}</tbody></table></div></div>`);

  const paintAtt = async () => {
    const body = $('[data-body]', page);
    const rows = await api(`/staff/attendance?${new URLSearchParams(att)}`);
    const totals = {};
    for (const r of rows) { totals[r.name] ||= { h: 0, n: 0 }; totals[r.name].h += r.hours_live; totals[r.name].n++; }
    mount(body, html`<div class="toolbar"><input class="input sm" type="date" data-att="from" value="${att.from}" style="width:auto"> <span class="muted">to</span> <input class="input sm" type="date" data-att="to" value="${att.to}" style="width:auto">
      <select class="input sm" data-att="employee_id" style="width:auto"><option value="">Everyone</option>${emps.map((e) => html`<option value="${e.id}" ${String(e.id) === att.employee_id ? raw('selected') : ''}>${e.name}</option>`)}</select></div>
      <div class="grid g4" style="margin-bottom:14px">${Object.entries(totals).slice(0, 8).map(([n, t]) => html`<div class="card kpi" style="padding:12px 14px"><div class="label">${n}</div><div class="value" style="font-size:22px">${num(t.h, 1)} h</div><div class="tiny muted">${t.n} shifts</div></div>`)}</div>
      <div class="card"><div class="table-wrap">${rows.length ? html`<table class="table"><thead><tr><th>Employee</th><th>Date</th><th>Clock in</th><th>Clock out</th><th class="num">Hours</th><th>Note</th><th></th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><b>${r.name}</b> <span class="tiny muted">${r.role}</span></td><td>${fmtDate(r.clock_in)}</td><td>${fmtTime(r.clock_in)}</td><td>${r.clock_out ? fmtTime(r.clock_out) : html`<span class="badge ok dot">on shift</span>`}</td><td class="num">${num(r.hours_live, 2)}</td><td class="small">${r.note || ''}</td><td class="right"><button class="btn sm ghost" data-editatt="${r.id}">${icon('edit', 'sm')}</button></td></tr>`)}</tbody></table>` : emptyState('No shifts in this range', 'clock')}</div></div>`);
    body._rows = rows;
  };
  const paintAdv = async () => {
    const rows = await api('/staff/advances');
    mount($('[data-body]', page), html`<div class="toolbar"><button class="btn primary" data-addadv>${icon('plus', 'sm')} Record advance</button><span class="small muted">Advances are paid out in cash immediately and deducted from the next payroll.</span></div>
      <div class="card"><div class="table-wrap">${rows.length ? html`<table class="table"><thead><tr><th>Date</th><th>Employee</th><th class="num">Amount</th><th>Note</th><th>Status</th></tr></thead><tbody>
      ${rows.map((a) => html`<tr><td>${a.date}</td><td>${a.name}</td><td class="num">${money(a.amount)}</td><td class="small">${a.note || ''}</td><td>${a.payroll_id ? html`<span class="badge ok">deducted</span>` : html`<span class="badge warn">open</span>`}</td></tr>`)}</tbody></table>` : emptyState('No advances recorded', 'wallet')}</div></div>`);
  };
  const load = async () => {
    emps = await api('/staff/employees');
    if (tab === 'team') paintTeam(); else if (tab === 'att') await paintAtt(); else await paintAdv();
  };
  await load();

  function edit(e) {
    const x = e || { role: 'cashier', pay_type: 'monthly', base_salary: 0, hourly_rate: 0, commission_per_delivery: 0, active: true, joined_at: localISO() };
    const roles = auth.user.role === 'admin' ? ROLES : ROLES.filter((r) => r !== 'admin');
    modal({
      title: e ? `Edit ${e.name}` : 'New team member', wide: true,
      content: html`<form class="stack" data-f>
        <div class="grid g3"><label class="field"><span>Full name</span><input class="input" name="name" required value="${x.name || ''}"></label>
          <label class="field"><span>Phone</span><input class="input" name="phone" value="${x.phone || ''}"></label>
          <label class="field"><span>CNIC</span><input class="input" name="cnic" value="${x.cnic || ''}" placeholder="35202-xxxxxxx-x"></label></div>
        <div class="grid g3"><label class="field"><span>Role</span><select class="input" name="role">${roles.map((r) => html`<option ${r === x.role ? raw('selected') : ''}>${r}</option>`)}</select></label>
          <label class="field"><span>Joined</span><input class="input" type="date" name="joined_at" value="${x.joined_at || ''}"></label>
          <label class="field"><span>Status</span><label class="check" style="min-height:40px"><input type="checkbox" name="active" ${x.active ? raw('checked') : ''}> Active</label></label></div>
        <h4>Pay terms</h4>
        <div class="grid g4"><label class="field"><span>Pay type</span><select class="input" name="pay_type"><option value="monthly" ${x.pay_type === 'monthly' ? raw('selected') : ''}>Monthly salary</option><option value="hourly" ${x.pay_type === 'hourly' ? raw('selected') : ''}>Hourly</option></select></label>
          <label class="field"><span>Monthly salary</span><input class="input" type="number" min="0" name="base_salary" data-num value="${x.base_salary}"></label>
          <label class="field"><span>Hourly rate</span><input class="input" type="number" min="0" name="hourly_rate" data-num value="${x.hourly_rate}"></label>
          <label class="field"><span>Per-delivery commission</span><input class="input" type="number" min="0" name="commission_per_delivery" data-num value="${x.commission_per_delivery}"></label></div>
        <h4>System login <span class="muted small" style="font-weight:500">(optional)</span></h4>
        <div class="grid g2"><label class="field"><span>Username</span><input class="input" name="username" value="${x.username || ''}" autocomplete="off" autocapitalize="none"></label>
          <label class="field"><span>${e ? 'New password (leave blank to keep)' : 'Password'}</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6"></label></div></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
      onMount: (el, close) => on(el, 'click', '[data-save]', async (_e, btn) => {
        const f = $('[data-f]', el);
        if (!f.reportValidity()) return;
        const body = formData(f);
        body.username ||= null; body.password ||= '';
        try { await busy(btn, () => api(e ? `/staff/employees/${e.id}` : '/staff/employees', { method: e ? 'PUT' : 'POST', body })); toast('Saved', 'ok'); close(); load(); } catch { /* toasted */ }
      }),
    });
  }
  const toLocalInput = (s) => { if (!s) return ''; const d = parseDate(s); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  function editAtt(r) {
    modal({
      title: `Edit shift · ${r.name}`,
      content: html`<form class="stack" data-f><label class="field"><span>Clock in</span><input class="input" type="datetime-local" name="clock_in" value="${toLocalInput(r.clock_in)}" required></label>
        <label class="field"><span>Clock out</span><input class="input" type="datetime-local" name="clock_out" value="${toLocalInput(r.clock_out)}"></label>
        <label class="field"><span>Note</span><input class="input" name="note" value="${r.note || ''}" placeholder="Reason for correction"></label></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
      onMount: (el, close) => on(el, 'click', '[data-save]', async (_e, btn) => {
        const f = $('[data-f]', el);
        if (!f.reportValidity()) return;
        try { await busy(btn, () => api(`/staff/attendance/${r.id}`, { method: 'PUT', body: formData(f) })); close(); paintAtt(); } catch { /* toasted */ }
      }),
    });
  }
  function addAdv() {
    modal({
      title: 'Salary advance',
      content: html`<form class="stack" data-f><label class="field"><span>Employee</span><select class="input" name="employee_id" data-num>${emps.filter((e) => e.active).map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></label>
        <label class="field"><span>Amount (Rs.)</span><input class="input" type="number" min="1" name="amount" data-num required></label>
        <label class="field"><span>Note</span><input class="input" name="note"></label></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Pay advance</button>`,
      onMount: (el, close) => on(el, 'click', '[data-save]', async (_e, btn) => {
        const f = $('[data-f]', el);
        if (!f.reportValidity()) return;
        try { await busy(btn, () => api('/staff/advances', { method: 'POST', body: formData(f) })); toast('Advance recorded', 'ok'); close(); paintAdv(); } catch { /* toasted */ }
      }),
    });
  }

  const offs = [
    cleanup,
    on(page, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; page.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); load(); }),
    on(page, 'click', '[data-add]', () => edit(null)),
    on(page, 'click', '[data-edit]', (_e, b) => edit(emps.find((e) => e.id === Number(b.dataset.edit)))),
    on(page, 'click', '[data-clock]', async (_e, b) => { try { await busy(b, () => api('/staff/attendance/clock', { method: 'POST', body: { employee_id: Number(b.dataset.clock), action: b.dataset.act } })); load(); } catch { /* toasted */ } }),
    on(page, 'change', '[data-att]', (_e, i) => { att[i.dataset.att] = i.value; paintAtt(); }),
    on(page, 'click', '[data-editatt]', (_e, b) => editAtt($('[data-body]', page)._rows.find((r) => r.id === Number(b.dataset.editatt)))),
    on(page, 'click', '[data-addadv]', () => addAdv()),
  ];
  return () => offs.forEach((x) => x());
}
