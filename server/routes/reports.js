import { Router } from 'express';
import { z } from 'zod';
import { q, getSettings, setSetting, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { h, parse, id, money, range, today, toCSV, dateStr } from '../util.js';
import { lowStock, round } from '../services/inventory.js';
import { publicSettings } from './public.js';

const r = Router();
const mgr = requireRole('manager');
const CLOSED = "o.status IN ('delivered','completed')";
const DAY = "date(o.closed_at,'localtime')";

function kpis(day) {
  const s = q.get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cogs),0) cogs, COALESCE(AVG(total),0) aov
    FROM orders o WHERE ${CLOSED} AND ${DAY} = ?`, day);
  const cancelled = q.get(`SELECT COUNT(*) n FROM orders o WHERE status = 'cancelled' AND ${DAY} = ?`, day).n;
  const prep = q.get(`SELECT AVG((julianday(ready_at) - julianday(preparing_at)) * 1440) m FROM orders o
    WHERE ready_at IS NOT NULL AND preparing_at IS NOT NULL AND date(o.ready_at,'localtime') = ?`, day).m;
  const deliveryTime = q.get(`SELECT AVG((julianday(closed_at) - julianday(created_at)) * 1440) m FROM orders o
    WHERE status = 'delivered' AND ${DAY} = ?`, day).m;
  return { ...s, cancelled, avg_prep_min: prep ? round(prep, 1) : null, avg_delivery_min: deliveryTime ? round(deliveryTime, 1) : null };
}

r.get('/dashboard', mgr, h(() => {
  const t = today();
  const series = q.all(`SELECT ${DAY} AS day, COUNT(*) orders, SUM(total) revenue, SUM(cogs) cogs FROM orders o
    WHERE ${CLOSED} AND ${DAY} >= ? GROUP BY 1 ORDER BY 1`, today(-13));
  const filled = [];
  for (let i = 13; i >= 0; i--) {
    const d = today(-i);
    filled.push(series.find((x) => x.day === d) || { day: d, orders: 0, revenue: 0, cogs: 0 });
  }
  return {
    today: kpis(t),
    yesterday: kpis(today(-1)),
    series: filled,
    by_status: q.all(`SELECT status, COUNT(*) n FROM orders WHERE status IN ('received','preparing','ready','out_for_delivery') GROUP BY status`),
    by_type: q.all(`SELECT type, COUNT(*) n, SUM(total) revenue FROM orders o WHERE ${CLOSED} AND ${DAY} >= ? GROUP BY type`, today(-6)),
    by_hour: q.all(`SELECT CAST(strftime('%H', o.created_at, 'localtime') AS INTEGER) hour, COUNT(*) n FROM orders o
      WHERE ${CLOSED} AND ${DAY} >= ? GROUP BY 1 ORDER BY 1`, today(-6)),
    top_items: q.all(`SELECT oi.name, SUM(oi.qty) qty, SUM(oi.line_total) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${CLOSED} AND ${DAY} >= ? GROUP BY oi.name ORDER BY revenue DESC LIMIT 6`, today(-6)),
    low_stock: lowStock(),
    riders: q.all(`SELECT e.id, e.name,
      (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'picked_up') active,
      (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'delivered' AND date(d.delivered_at,'localtime') = ?) done_today,
      (SELECT COUNT(*) FROM attendance a WHERE a.employee_id = e.id AND a.clock_out IS NULL) on_shift
      FROM employees e WHERE e.role = 'rider' AND e.active = 1 ORDER BY active DESC, e.name`, t),
    on_shift: q.get('SELECT COUNT(*) n FROM attendance WHERE clock_out IS NULL').n,
  };
}));

r.get('/sales', mgr, h((req, res) => {
  const { from, to } = range(req, 30);
  const group = ['day', 'week', 'month'].includes(req.query.group) ? req.query.group : 'day';
  const key = group === 'day' ? DAY : group === 'week' ? `strftime('%Y-W%W', o.closed_at, 'localtime')` : `strftime('%Y-%m', o.closed_at, 'localtime')`;
  const rows = q.all(`SELECT ${key} AS period, COUNT(*) orders, SUM(subtotal) gross_sales, SUM(discount) discounts, SUM(delivery_fee) delivery_fees,
      SUM(tax) tax, SUM(total) revenue, SUM(cogs) cogs, SUM(subtotal - discount - cogs) gross_profit,
      SUM(CASE WHEN type='delivery' THEN 1 ELSE 0 END) delivery, SUM(CASE WHEN type='takeaway' THEN 1 ELSE 0 END) takeaway,
      SUM(CASE WHEN type='dine_in' THEN 1 ELSE 0 END) dine_in,
      SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END) cash, SUM(CASE WHEN payment_method!='cash' THEN total ELSE 0 END) non_cash
    FROM orders o WHERE ${CLOSED} AND ${DAY} BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`, from, to);
  if (req.query.format === 'csv') return csv(req, res, rows, 'sales');
  return { from, to, group, rows };
}));

r.get('/items', mgr, h((req) => {
  const { from, to } = range(req, 30);
  const rows = q.all(`SELECT oi.item_id, oi.name, c.name AS category, SUM(oi.qty) qty, SUM(oi.line_total) revenue,
      SUM(oi.unit_cost * oi.qty) cogs, SUM(oi.line_total - oi.unit_cost * oi.qty) profit
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_items m ON m.id = oi.item_id LEFT JOIN categories c ON c.id = m.category_id
    WHERE ${CLOSED} AND ${DAY} BETWEEN ? AND ? GROUP BY oi.item_id, oi.name ORDER BY revenue DESC`, from, to)
    .map((x) => ({ ...x, margin: x.revenue ? round((x.profit / x.revenue) * 100, 1) : 0 }));
  return { from, to, rows };
}));

r.get('/pnl', mgr, h((req) => {
  const { from, to } = range(req, 30);
  const sales = q.get(`SELECT COUNT(*) orders, COALESCE(SUM(subtotal),0) gross_sales, COALESCE(SUM(discount),0) discounts,
    COALESCE(SUM(delivery_fee),0) delivery_fees, COALESCE(SUM(tax),0) tax, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cogs),0) cogs
    FROM orders o WHERE ${CLOSED} AND ${DAY} BETWEEN ? AND ?`, from, to);
  const waste = q.get(`SELECT COALESCE(SUM(-change * unit_cost),0) v FROM inventory_logs WHERE type = 'waste' AND date(created_at,'localtime') BETWEEN ? AND ?`, from, to).v;
  const expenses = q.all('SELECT category, SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to);
  const payroll = q.get(`SELECT COALESCE(SUM(-amount),0) v FROM transactions WHERE type = 'payroll' AND date(created_at,'localtime') BETWEEN ? AND ?`, from, to).v;
  const commissions = q.get(`SELECT COALESCE(SUM(commission),0) v FROM deliveries WHERE status='delivered' AND date(delivered_at,'localtime') BETWEEN ? AND ?`, from, to).v;
  const purchases = q.get(`SELECT COALESCE(SUM(-amount),0) v FROM transactions WHERE type = 'purchase' AND date(created_at,'localtime') BETWEEN ? AND ?`, from, to).v;
  const netSales = sales.revenue - sales.tax;
  const grossProfit = netSales - sales.cogs - waste;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  return {
    from, to, sales, waste: round(waste), expenses, total_expenses: totalExpenses, payroll, commissions, purchases,
    net_sales: netSales, gross_profit: round(grossProfit), net_profit: round(grossProfit - totalExpenses - payroll),
    food_cost_pct: netSales ? round((sales.cogs / netSales) * 100, 1) : 0,
  };
}));

r.get('/transactions', mgr, h((req, res) => {
  const { from, to } = range(req, 30);
  const where = ["date(t.created_at,'localtime') BETWEEN ? AND ?"];
  const p = [from, to];
  if (req.query.type) { where.push('t.type = ?'); p.push(req.query.type); }
  if (req.query.q) { where.push('(t.ref LIKE ? OR t.description LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = q.all(`SELECT t.id, t.created_at, t.type, t.amount, t.method, t.ref, t.description, t.order_id, e.name AS employee
    FROM transactions t LEFT JOIN employees e ON e.id = t.employee_id WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 2000`, ...p);
  if (req.query.format === 'csv') return csv(req, res, rows, 'transactions');
  const totals = q.all(`SELECT type, SUM(amount) amount, COUNT(*) n FROM transactions t WHERE ${where.join(' AND ')} GROUP BY type`, ...p);
  return { from, to, rows: rows.slice(0, 500), totals };
}));

r.get('/audit', requireRole(), h((req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  return q.all(`SELECT a.*, e.name AS employee FROM audit_log a LEFT JOIN employees e ON e.id = a.employee_id ORDER BY a.id DESC LIMIT 300`);
}));

r.get('/customers', mgr, h(() => q.all(`SELECT c.*, COUNT(o.id) orders, COALESCE(SUM(o.total),0) spent, MAX(o.created_at) last_order
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status IN ('delivered','completed')
  GROUP BY c.id ORDER BY spent DESC LIMIT 500`)));

r.get('/customers/:id', mgr, h((req, res) => {
  const cid = parse(id, req.params.id);
  const c = q.get('SELECT * FROM customers WHERE id = ?', cid);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const orders = q.all(`SELECT id, code, type, status, total, payment_method, created_at FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 100`, cid);
  const done = orders.filter((o) => ['delivered', 'completed'].includes(o.status));
  const favourites = q.all(`SELECT oi.name, SUM(oi.qty) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.customer_id = ? AND o.status IN ('delivered','completed') GROUP BY oi.name ORDER BY qty DESC LIMIT 5`, cid);
  return {
    ...c, orders, favourites,
    stats: {
      orders: done.length, spent: done.reduce((s, o) => s + o.total, 0),
      avg: done.length ? done.reduce((s, o) => s + o.total, 0) / done.length : 0,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
      first: orders.at(-1)?.created_at || null, last: orders[0]?.created_at || null,
    },
  };
}));

/* ---------- End-of-day close (Z report) & rider cash hand-in ---------- */
const desk = requireRole('manager', 'cashier');

r.get('/day-close', desk, h((req) => {
  const day = req.query.date ? parse(dateStr, req.query.date) : today();
  const closed = `${CLOSED} AND ${DAY} = ?`;
  const totals = q.get(`SELECT COUNT(*) orders, COALESCE(SUM(subtotal),0) food_sales, COALESCE(SUM(discount),0) discounts,
      COALESCE(SUM(delivery_fee),0) delivery_fees, COALESCE(SUM(tax),0) tax, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cogs),0) cogs,
      COALESCE(SUM(CASE WHEN promo_code IS NOT NULL THEN 1 ELSE 0 END),0) promo_orders
    FROM orders o WHERE ${closed}`, day);
  const byMethod = q.all(`SELECT payment_method k, COUNT(*) n, SUM(total) v FROM orders o WHERE ${closed} GROUP BY 1 ORDER BY v DESC`, day);
  const byType = q.all(`SELECT type k, COUNT(*) n, SUM(total) v FROM orders o WHERE ${closed} GROUP BY 1 ORDER BY v DESC`, day);
  const bySource = q.all(`SELECT source k, COUNT(*) n, SUM(total) v FROM orders o WHERE ${closed} GROUP BY 1 ORDER BY v DESC`, day);
  const cancelled = q.get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM orders o WHERE status = 'cancelled' AND date(o.updated_at,'localtime') = ?`, day);
  const open = q.get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM orders o WHERE status NOT IN ('delivered','completed','cancelled')`);
  const ledger = q.all(`SELECT type, COALESCE(method,'—') method, COUNT(*) n, SUM(amount) v FROM transactions
    WHERE date(created_at,'localtime') = ? GROUP BY 1, 2 ORDER BY 1, 2`, day);
  const cashIn = ledger.filter((l) => l.method === 'cash' && l.v > 0).reduce((s, l) => s + l.v, 0);
  const cashOut = -ledger.filter((l) => l.method === 'cash' && l.v < 0).reduce((s, l) => s + l.v, 0);
  const riders = q.all(`SELECT e.id, e.name,
      (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'delivered' AND date(d.delivered_at,'localtime') = ?) deliveries,
      (SELECT COALESCE(SUM(commission),0) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'delivered' AND date(d.delivered_at,'localtime') = ?) commission,
      (SELECT COALESCE(SUM(cash_collected),0) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'delivered' AND date(d.delivered_at,'localtime') = ?) cash_collected,
      (SELECT COALESCE(SUM(cash_collected),0) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'delivered' AND d.settled_at IS NULL) cash_due,
      (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = e.id AND d.status = 'delivered' AND d.settled_at IS NULL AND d.cash_collected > 0) due_orders
    FROM employees e WHERE e.role = 'rider' AND (e.active = 1 OR EXISTS (SELECT 1 FROM deliveries d WHERE d.rider_id = e.id AND d.settled_at IS NULL)) ORDER BY e.name`, day, day, day);
  // Rider cash for this day's deliveries that hasn't reached the till yet
  const riderUnsettledToday = q.get(`SELECT COALESCE(SUM(cash_collected),0) v FROM deliveries WHERE status = 'delivered' AND settled_at IS NULL AND date(delivered_at,'localtime') = ?`, day).v;
  const hours = q.all(`SELECT CAST(strftime('%H', o.closed_at, 'localtime') AS INTEGER) h, COUNT(*) n, SUM(total) v FROM orders o WHERE ${closed} GROUP BY 1 ORDER BY 1`, day);
  const top = q.all(`SELECT oi.name, SUM(oi.qty) qty, SUM(oi.line_total) v FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${closed} GROUP BY oi.name ORDER BY qty DESC LIMIT 8`, day);
  const staff = q.all(`SELECT e.name, e.role, a.clock_in, a.clock_out FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE date(a.clock_in,'localtime') = ? ORDER BY a.clock_in`, day);
  return {
    date: day, totals, byMethod, byType, bySource, cancelled, open, ledger, riders, hours, top, staff,
    cash: { in: cashIn, out: cashOut, rider_pending: riderUnsettledToday, expected: cashIn - cashOut - riderUnsettledToday },
  };
}));

r.post('/riders/:id/settle', desk, h((req) => {
  const rid = parse(id, req.params.id);
  const due = q.get(`SELECT COUNT(*) n, COALESCE(SUM(cash_collected),0) v FROM deliveries WHERE rider_id = ? AND status = 'delivered' AND settled_at IS NULL`, rid);
  q.run(`UPDATE deliveries SET settled_at = datetime('now'), settled_by = ? WHERE rider_id = ? AND status = 'delivered' AND settled_at IS NULL`, req.user.id, rid);
  audit(req.user.id, 'rider.settle', 'employee', rid, { amount: due.v, deliveries: due.n });
  return { amount: due.v, deliveries: due.n };
}));

function csv(req, res, rows, name) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(toCSV(rows));
}

export default r;

/* ---------------- Settings ---------------- */
export const settings = Router();

settings.get('/', requireRole(), h(() => ({ ...getSettings(), zones: q.all('SELECT * FROM delivery_zones ORDER BY fee, name') })));
settings.get('/public', h(() => publicSettings()));

settings.put('/', mgr, h((req) => {
  const b = parse(z.object({
    restaurant_name: z.string().min(2).max(60), tagline: z.string().max(100).optional(), phone: z.string().max(20), whatsapp: z.string().max(20),
    address: z.string().max(200).optional(), tax_rate: z.coerce.number().min(0).max(30), free_delivery_threshold: money,
    min_delivery_order: money, tables: z.coerce.number().int().min(0).max(200), accepting_orders: z.boolean(), dine_in_billing: z.enum(['after', 'before']).default('after'), opening_hours: z.string().max(60).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(b)) setSetting(k, v);
  audit(req.user.id, 'settings.update', 'settings', null, b);
  return { ok: true };
}));

settings.patch('/tables', mgr, h((req) => {
  const { tables } = parse(z.object({ tables: z.coerce.number().int().min(1).max(200) }), req.body);
  setSetting('tables', tables);
  audit(req.user.id, 'settings.tables', 'settings', null, { tables });
  return { tables };
}));

settings.post('/zones', mgr, h((req) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60), fee: money }), req.body);
  return { id: Number(q.run('INSERT INTO delivery_zones(name, fee) VALUES (?,?)', b.name, b.fee).lastInsertRowid) };
}));
settings.put('/zones/:id', mgr, h((req) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60), fee: money, active: z.boolean().default(true) }), req.body);
  q.run('UPDATE delivery_zones SET name = ?, fee = ?, active = ? WHERE id = ?', b.name, b.fee, b.active ? 1 : 0, parse(id, req.params.id));
  return { ok: true };
}));

/* ---------------- Promo codes ---------------- */
const promoSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, 'Use 3–20 letters, numbers, - or _'),
  description: z.string().trim().max(120).optional().nullable(),
  kind: z.enum(['percent', 'flat']),
  value: z.coerce.number().positive().max(100000),
  min_subtotal: money.default(0),
  max_discount: money.optional().nullable(),
  starts_on: dateStr.optional().nullable().or(z.literal('').transform(() => null)),
  ends_on: dateStr.optional().nullable().or(z.literal('').transform(() => null)),
  max_uses: z.coerce.number().int().positive().optional().nullable(),
  online_only: z.boolean().default(false),
  active: z.boolean().default(true),
}).refine((p) => p.kind !== 'percent' || p.value <= 100, { path: ['value'], message: 'A percentage must be 100 or less' });

settings.get('/promos', mgr, h(() => q.all(`SELECT p.*, (SELECT COALESCE(SUM(discount),0) FROM orders o WHERE o.promo_code = p.code AND o.status IN ('delivered','completed')) given
  FROM promos p ORDER BY p.active DESC, p.id DESC`)));
settings.post('/promos', mgr, h((req) => {
  const b = parse(promoSchema, req.body);
  if (q.get('SELECT id FROM promos WHERE code = ? COLLATE NOCASE', b.code)) throw Object.assign(new Error(`Code ${b.code} already exists`), { status: 400 });
  const pid = Number(q.run(`INSERT INTO promos(code, description, kind, value, min_subtotal, max_discount, starts_on, ends_on, max_uses, online_only, active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, b.code, b.description, b.kind, b.value, b.min_subtotal, b.max_discount || null, b.starts_on, b.ends_on, b.max_uses || null, b.online_only, b.active).lastInsertRowid);
  audit(req.user.id, 'promo.create', 'promo', pid, b);
  return { id: pid };
}));
settings.put('/promos/:id', mgr, h((req) => {
  const pid = parse(id, req.params.id);
  const b = parse(promoSchema, req.body);
  if (q.get('SELECT id FROM promos WHERE code = ? COLLATE NOCASE AND id <> ?', b.code, pid)) throw Object.assign(new Error(`Code ${b.code} already exists`), { status: 400 });
  q.run(`UPDATE promos SET code=?, description=?, kind=?, value=?, min_subtotal=?, max_discount=?, starts_on=?, ends_on=?, max_uses=?, online_only=?, active=? WHERE id=?`,
    b.code, b.description, b.kind, b.value, b.min_subtotal, b.max_discount || null, b.starts_on, b.ends_on, b.max_uses || null, b.online_only, b.active, pid);
  audit(req.user.id, 'promo.update', 'promo', pid, b);
  return { ok: true };
}));
