import { Router } from 'express';
import { z } from 'zod';
import { q, tx, audit } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { h, parse, id, money, dateStr } from '../util.js';
import { round } from '../services/inventory.js';

const r = Router();
const mgr = requireRole('manager');
const ROLES = ['admin', 'manager', 'cashier', 'chef', 'waiter', 'rider'];

/* ---------- Employees ---------- */
r.get('/employees', mgr, h(() => q.all(`
  SELECT e.id, e.name, e.phone, e.cnic, e.role, e.username, e.pay_type, e.base_salary, e.hourly_rate,
    e.commission_per_delivery, e.joined_at, e.active,
    (SELECT clock_in FROM attendance a WHERE a.employee_id = e.id AND a.clock_out IS NULL ORDER BY id DESC LIMIT 1) AS on_shift_since,
    (SELECT COALESCE(SUM(amount),0) FROM advances v WHERE v.employee_id = e.id AND v.payroll_id IS NULL) AS open_advances
  FROM employees e ORDER BY e.active DESC, e.role, e.name`)));

const empSchema = z.object({
  name: z.string().trim().min(2).max(60),
  phone: z.string().max(20).optional().nullable(),
  cnic: z.string().max(20).optional().nullable(),
  role: z.enum(ROLES),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, '3-30 letters/numbers').optional().nullable().or(z.literal('')),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100).optional().or(z.literal('')),
  pay_type: z.enum(['monthly', 'hourly']),
  base_salary: money.default(0),
  hourly_rate: money.default(0),
  commission_per_delivery: money.default(0),
  joined_at: dateStr.optional(),
  active: z.boolean().default(true),
});

function conflict(msg) { const e = new Error(msg); e.status = 409; return e; }

r.post('/employees', mgr, h((req) => {
  const b = parse(empSchema, req.body);
  if (b.role === 'admin' && req.user.role !== 'admin') throw conflict('Only an admin can create another admin');
  if (b.username && q.get('SELECT id FROM employees WHERE username = ?', b.username)) throw conflict('Username already taken');
  if (b.username && !b.password) throw conflict('Set a password for this login');
  const res = q.run(`INSERT INTO employees(name, phone, cnic, role, username, password_hash, pay_type, base_salary, hourly_rate, commission_per_delivery, joined_at, active)
    VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?, date('now')),?)`,
    b.name, b.phone, b.cnic, b.role, b.username || null, b.password ? hashPassword(b.password) : null,
    b.pay_type, b.base_salary, b.hourly_rate, b.commission_per_delivery, b.joined_at, b.active);
  audit(req.user.id, 'employee.create', 'employee', Number(res.lastInsertRowid), { name: b.name, role: b.role });
  return { id: Number(res.lastInsertRowid) };
}));

r.put('/employees/:id', mgr, h((req) => {
  const eid = parse(id, req.params.id);
  const b = parse(empSchema, req.body);
  const cur = q.get('SELECT * FROM employees WHERE id = ?', eid);
  if (!cur) throw conflict('Employee not found');
  if ((cur.role === 'admin' || b.role === 'admin') && req.user.role !== 'admin') throw conflict('Only an admin can edit admin accounts');
  if (eid === req.user.id && (!b.active || b.role !== cur.role)) throw conflict('You cannot deactivate or change the role of your own account');
  if (b.username && q.get('SELECT id FROM employees WHERE username = ? AND id != ?', b.username, eid)) throw conflict('Username already taken');
  tx(() => {
    q.run(`UPDATE employees SET name=?, phone=?, cnic=?, role=?, username=?, pay_type=?, base_salary=?, hourly_rate=?,
      commission_per_delivery=?, joined_at=COALESCE(?, joined_at), active=? WHERE id=?`,
      b.name, b.phone, b.cnic, b.role, b.username || null, b.pay_type, b.base_salary, b.hourly_rate,
      b.commission_per_delivery, b.joined_at, b.active, eid);
    if (b.password) q.run('UPDATE employees SET password_hash = ? WHERE id = ?', hashPassword(b.password), eid);
    if (!b.active || b.password) q.run('DELETE FROM sessions WHERE employee_id = ?', eid);
  });
  audit(req.user.id, 'employee.update', 'employee', eid, { role: b.role, active: b.active, password_changed: !!b.password });
  return { ok: true };
}));

/* ---------- Attendance ---------- */
function clock(employeeId, action, actorId) {
  const open = q.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1', employeeId);
  if (action === 'in') {
    if (open) throw conflict('Already clocked in');
    q.run("INSERT INTO attendance(employee_id, clock_in) VALUES (?, datetime('now'))", employeeId);
  } else {
    if (!open) throw conflict('Not clocked in');
    q.run(`UPDATE attendance SET clock_out = datetime('now'),
      hours = ROUND((julianday('now') - julianday(clock_in)) * 24, 2) WHERE id = ?`, open.id);
  }
  audit(actorId, `attendance.${action}`, 'employee', employeeId);
  return q.get('SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC LIMIT 1', employeeId);
}

r.get('/attendance/me', requireRole(), h((req) => ({
  open: q.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', req.user.id) || null,
  week_hours: q.get(`SELECT COALESCE(SUM(CASE WHEN clock_out IS NULL THEN (julianday('now')-julianday(clock_in))*24 ELSE hours END),0) h
    FROM attendance WHERE employee_id = ? AND clock_in >= datetime('now','-7 days')`, req.user.id).h,
})));
r.post('/attendance/me', requireRole(), h((req) => clock(req.user.id, req.body.action === 'out' ? 'out' : 'in', req.user.id)));
r.post('/attendance/clock', mgr, h((req) => {
  const b = parse(z.object({ employee_id: id, action: z.enum(['in', 'out']) }), req.body);
  return clock(b.employee_id, b.action, req.user.id);
}));

r.get('/attendance', mgr, h((req) => {
  const from = req.query.from || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const p = [from, to];
  let extra = '';
  if (req.query.employee_id) { extra = 'AND a.employee_id = ?'; p.push(Number(req.query.employee_id)); }
  return q.all(`SELECT a.*, e.name, e.role,
      CASE WHEN a.clock_out IS NULL THEN ROUND((julianday('now') - julianday(a.clock_in))*24, 2) ELSE a.hours END AS hours_live
    FROM attendance a JOIN employees e ON e.id = a.employee_id
    WHERE date(a.clock_in,'localtime') BETWEEN ? AND ? ${extra} ORDER BY a.clock_in DESC`, ...p);
}));

r.put('/attendance/:id', mgr, h((req) => {
  const b = parse(z.object({ clock_in: z.string(), clock_out: z.string().optional().nullable(), note: z.string().max(200).optional().nullable() }), req.body);
  // Accepts local "YYYY-MM-DDTHH:MM" from the browser; store UTC
  const toUtc = (s) => (s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') : null);
  const ci = toUtc(b.clock_in);
  const co = toUtc(b.clock_out);
  if (co && co <= ci) throw conflict('Clock-out must be after clock-in');
  q.run(`UPDATE attendance SET clock_in = ?, clock_out = ?, note = ?,
    hours = CASE WHEN ? IS NULL THEN 0 ELSE ROUND((julianday(?) - julianday(?))*24, 2) END WHERE id = ?`,
    ci, co, b.note, co, co, ci, parse(id, req.params.id));
  audit(req.user.id, 'attendance.edit', 'attendance', Number(req.params.id), b);
  return { ok: true };
}));

/* ---------- Advances ---------- */
r.get('/advances', mgr, h(() => q.all(`SELECT v.*, e.name FROM advances v JOIN employees e ON e.id = v.employee_id ORDER BY v.id DESC LIMIT 200`)));
r.post('/advances', mgr, h((req) => {
  const b = parse(z.object({ employee_id: id, amount: money.refine((n) => n > 0, 'Enter an amount'), note: z.string().max(200).optional().nullable(), date: dateStr.optional() }), req.body);
  tx(() => {
    q.run("INSERT INTO advances(employee_id, amount, note, date) VALUES (?,?,?,COALESCE(?, date('now')))", b.employee_id, b.amount, b.note, b.date);
    const name = q.get('SELECT name FROM employees WHERE id = ?', b.employee_id).name;
    q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id) VALUES ('payroll', ?, 'cash', ?, ?, ?)`,
      -b.amount, `ADV-${b.employee_id}`, `Salary advance to ${name}`, req.user.id);
  });
  return { ok: true };
}));

/* ---------- Payroll ---------- */
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5) + 1; }
function isFullMonth(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const last = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
  return s.getDate() === 1 && e.getMonth() === s.getMonth() && e.getFullYear() === s.getFullYear() && e.getDate() === last;
}

function computePay(emp, start, end, bonus = 0, deductions = 0) {
  const hours = q.get(`SELECT COALESCE(SUM(hours),0) h FROM attendance WHERE employee_id = ? AND clock_out IS NOT NULL
    AND date(clock_in,'localtime') BETWEEN ? AND ?`, emp.id, start, end).h;
  const del = q.get(`SELECT COUNT(*) n, COALESCE(SUM(commission),0) c FROM deliveries WHERE rider_id = ? AND status = 'delivered'
    AND date(delivered_at,'localtime') BETWEEN ? AND ?`, emp.id, start, end);
  const adv = q.get(`SELECT COALESCE(SUM(amount),0) a FROM advances WHERE employee_id = ? AND payroll_id IS NULL AND date <= ?`, emp.id, end).a;
  const basePay = emp.pay_type === 'monthly'
    ? round(isFullMonth(start, end) ? emp.base_salary : (emp.base_salary * daysBetween(start, end)) / 30, 0) : 0;
  const hourlyPay = emp.pay_type === 'hourly' ? round(hours * emp.hourly_rate, 0) : 0;
  const net = round(basePay + hourlyPay + del.c + bonus - deductions - adv, 0);
  return { base_pay: basePay, hours: round(hours, 2), hourly_pay: hourlyPay, deliveries: del.n, commission: del.c, advances: adv, bonus, deductions, net_pay: net };
}

r.post('/payroll/generate', mgr, h((req) => {
  const b = parse(z.object({ period_start: dateStr, period_end: dateStr }), req.body);
  if (b.period_end < b.period_start) throw conflict('Period end must be after start');
  const emps = q.all('SELECT * FROM employees WHERE active = 1 AND (base_salary > 0 OR hourly_rate > 0 OR commission_per_delivery > 0)');
  let created = 0;
  tx(() => {
    for (const emp of emps) {
      const ex = q.get('SELECT * FROM payroll WHERE employee_id = ? AND period_start = ? AND period_end = ?', emp.id, b.period_start, b.period_end);
      if (ex?.status === 'paid') continue;
      const p = computePay(emp, b.period_start, b.period_end, ex?.bonus || 0, ex?.deductions || 0);
      if (ex) {
        q.run(`UPDATE payroll SET base_pay=?, hours=?, hourly_pay=?, deliveries=?, commission=?, advances=?, net_pay=? WHERE id=?`,
          p.base_pay, p.hours, p.hourly_pay, p.deliveries, p.commission, p.advances, p.net_pay, ex.id);
      } else {
        q.run(`INSERT INTO payroll(employee_id, period_start, period_end, base_pay, hours, hourly_pay, deliveries, commission, bonus, deductions, advances, net_pay)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, emp.id, b.period_start, b.period_end, p.base_pay, p.hours, p.hourly_pay, p.deliveries, p.commission, 0, 0, p.advances, p.net_pay);
        created++;
      }
    }
  });
  audit(req.user.id, 'payroll.generate', 'payroll', null, b);
  return { created };
}));

r.get('/payroll', mgr, h((req) => {
  const periods = q.all('SELECT period_start, period_end, COUNT(*) n, SUM(net_pay) total, SUM(status = \'paid\') paid FROM payroll GROUP BY 1,2 ORDER BY period_start DESC LIMIT 24');
  const ps = req.query.period_start || periods[0]?.period_start;
  const pe = req.query.period_end || periods[0]?.period_end;
  const rows = ps ? q.all(`SELECT p.*, e.name, e.role, e.pay_type FROM payroll p JOIN employees e ON e.id = p.employee_id
    WHERE p.period_start = ? AND p.period_end = ? ORDER BY e.role, e.name`, ps, pe) : [];
  return { periods, period_start: ps, period_end: pe, rows };
}));

r.put('/payroll/:id', mgr, h((req) => {
  const pid = parse(id, req.params.id);
  const b = parse(z.object({ bonus: money, deductions: money, note: z.string().max(200).optional().nullable() }), req.body);
  const row = q.get('SELECT * FROM payroll WHERE id = ?', pid);
  if (!row || row.status === 'paid') throw conflict('Paid payslips cannot be edited');
  const net = round(row.base_pay + row.hourly_pay + row.commission + b.bonus - b.deductions - row.advances, 0);
  q.run('UPDATE payroll SET bonus=?, deductions=?, note=?, net_pay=? WHERE id=?', b.bonus, b.deductions, b.note, net, pid);
  return { ok: true };
}));

r.post('/payroll/:id/pay', mgr, h((req) => {
  const pid = parse(id, req.params.id);
  const row = q.get('SELECT p.*, e.name FROM payroll p JOIN employees e ON e.id = p.employee_id WHERE p.id = ?', pid);
  if (!row || row.status === 'paid') throw conflict('Already paid');
  tx(() => {
    q.run("UPDATE payroll SET status = 'paid', paid_at = datetime('now') WHERE id = ?", pid);
    q.run('UPDATE advances SET payroll_id = ? WHERE employee_id = ? AND payroll_id IS NULL AND date <= ?', pid, row.employee_id, row.period_end);
    // Advances were already paid out as cash, so only the net amount leaves the till now
    q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id) VALUES ('payroll', ?, ?, ?, ?, ?)`,
      -row.net_pay, req.body.method || 'cash', `PAY-${pid}`, `Salary ${row.name} (${row.period_start} to ${row.period_end})`, req.user.id);
  });
  audit(req.user.id, 'payroll.pay', 'payroll', pid, { net: row.net_pay });
  return { ok: true };
}));

/* ---------- Expenses ---------- */
export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Gas', 'Water', 'Internet', 'Maintenance', 'Packaging', 'Marketing', 'Fuel', 'Other'];
r.get('/expenses', mgr, h(() => ({
  categories: EXPENSE_CATEGORIES,
  rows: q.all('SELECT x.*, e.name AS employee_name FROM expenses x LEFT JOIN employees e ON e.id = x.employee_id ORDER BY x.date DESC, x.id DESC LIMIT 300'),
})));
r.post('/expenses', mgr, h((req) => {
  const b = parse(z.object({ category: z.enum(EXPENSE_CATEGORIES), amount: money.refine((n) => n > 0, 'Enter an amount'), note: z.string().max(200).optional().nullable(), date: dateStr.optional(), method: z.enum(['cash', 'card', 'wallet']).default('cash') }), req.body);
  tx(() => {
    const eid = Number(q.run("INSERT INTO expenses(category, amount, note, date, employee_id) VALUES (?,?,?,COALESCE(?, date('now')),?)", b.category, b.amount, b.note, b.date, req.user.id).lastInsertRowid);
    q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id, created_at) VALUES ('expense', ?, ?, ?, ?, ?, COALESCE(datetime(?), datetime('now')))`,
      -b.amount, b.method, `EXP-${eid}`, `${b.category}${b.note ? ': ' + b.note : ''}`, req.user.id, b.date ? `${b.date} 12:00:00` : null);
  });
  return { ok: true };
}));
r.delete('/expenses/:id', mgr, h((req) => {
  const eid = parse(id, req.params.id);
  tx(() => {
    q.run('DELETE FROM expenses WHERE id = ?', eid);
    q.run("DELETE FROM transactions WHERE ref = ? AND type = 'expense'", `EXP-${eid}`);
  });
  audit(req.user.id, 'expense.delete', 'expense', eid);
  return { ok: true };
}));

export default r;
