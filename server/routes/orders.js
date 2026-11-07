import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireRole } from '../auth.js';
import { h, parse, id, toCSV } from '../util.js';
import {
  createOrder, getOrder, getOrderEvents, transition, assignRider, toggleItemDone, priceCart,
  allowedTransitions, OPEN_STATUSES, updateRiderLocation, tablesOverview, markServed, requestBill, settleTable, moveTable,
} from '../services/orders.js';

const tableNo = z.coerce.string().trim().regex(/^[A-Za-z0-9-]{1,10}$/, 'Invalid table');

const r = Router();
const staff = requireRole('manager', 'cashier', 'waiter', 'chef', 'rider');

const cartItem = z.object({
  item_id: id, variant_id: id.optional().nullable(), addons: z.array(z.string()).default([]),
  options: z.record(z.string().max(40), z.string().max(60)).default({}),
  qty: z.coerce.number().int().min(1).max(50), notes: z.string().max(200).optional().nullable(),
});

const posOrder = z.object({
  type: z.enum(['delivery', 'takeaway', 'dine_in']),
  source: z.enum(['pos', 'phone', 'whatsapp']).default('pos'),
  items: z.array(cartItem).min(1),
  customer_name: z.string().trim().max(60).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  zone_id: id.optional().nullable(),
  table_no: z.string().max(10).optional().nullable(),
  payment_method: z.enum(['cash', 'card', 'wallet']).default('cash'),
  paid_now: z.boolean().default(false),
  discount: z.coerce.number().min(0).default(0),
  notes: z.string().max(300).optional().nullable(),
  promo_code: z.string().trim().max(30).optional().nullable(),
}).superRefine((o, ctx) => {
  if (o.type === 'delivery') {
    if (!o.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Address is required for delivery' });
    if (!o.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Phone is required for delivery' });
    if (!o.zone_id) ctx.addIssue({ code: 'custom', path: ['zone_id'], message: 'Choose a delivery zone' });
  }
  if (o.type === 'dine_in' && !o.table_no) ctx.addIssue({ code: 'custom', path: ['table_no'], message: 'Choose a table' });
});

function withActions(order, user) {
  if (!order) return order;
  const actions = allowedTransitions(order, user.role);
  // Dine-in food is served to the table first; the table is billed once at the end (Tables screen)
  if (order.type === 'dine_in' && order.status === 'ready' && !order.served_at && ['admin', 'manager', 'cashier', 'waiter'].includes(user.role)) actions.unshift('served');
  // ...so single dine-in orders aren't completed one by one from the boards
  return { ...order, actions: order.type === 'dine_in' ? actions.filter((a) => a !== 'completed') : actions };
}

const floor = requireRole('manager', 'cashier', 'waiter');
r.get('/tables', floor, h((req) => tablesOverview().map((t) => ({ ...t, orders: t.orders.map((o) => withActions(o, req.user)) }))));
r.post('/tables/:no/bill', floor, h((req) => requestBill(parse(tableNo, req.params.no), req.user)));
r.post('/tables/:no/settle', floor, h((req) => {
  const b = parse(z.object({ payment_method: z.enum(['cash', 'card', 'wallet']) }), req.body);
  return settleTable(parse(tableNo, req.params.no), req.user, b);
}));
r.post('/tables/:no/move', floor, h((req) => moveTable(parse(tableNo, req.params.no), parse(z.object({ to: tableNo }), req.body).to, req.user)));
r.post('/:id/served', floor, h((req) => withActions(markServed(parse(id, req.params.id), req.user), req.user)));

function openOrders() {
  const ids = q.all(`SELECT id FROM orders WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')}) ORDER BY created_at`, ...OPEN_STATUSES);
  return ids.map((x) => getOrder(x.id));
}

r.get('/board', staff, h((req) => ({
  orders: openOrders().map((o) => withActions(o, req.user)),
  recent: q.all(`SELECT id, code, type, status, total, customer_name, closed_at FROM orders
                 WHERE status IN ('delivered','completed','cancelled') AND closed_at >= datetime('now','-3 hours')
                 ORDER BY closed_at DESC LIMIT 20`),
})));

r.get('/', requireRole('manager', 'cashier'), h((req, res) => {
  const { status = 'all', type, q: search, from, to, format } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = [];
  const p = [];
  if (status === 'open') where.push(`o.status IN ('received','preparing','ready','out_for_delivery')`);
  else if (status === 'closed') where.push(`o.status IN ('delivered','completed')`);
  else if (status !== 'all') { where.push('o.status = ?'); p.push(status); }
  if (type) { where.push('o.type = ?'); p.push(type); }
  if (from) { where.push("date(o.created_at,'localtime') >= ?"); p.push(from); }
  if (to) { where.push("date(o.created_at,'localtime') <= ?"); p.push(to); }
  if (search) {
    where.push('(o.code LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ? OR CAST(o.id AS TEXT) = ?)');
    p.push(`%${search}%`, `%${search}%`, `%${search}%`, String(search).replace('#', ''));
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT o.id, o.code, o.type, o.source, o.status, o.customer_name, o.phone, o.subtotal, o.delivery_fee, o.discount,
      o.tax, o.total, o.cogs, o.payment_method, o.payment_status, o.created_at, o.closed_at, r.name AS rider_name,
      (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o LEFT JOIN employees r ON r.id = o.rider_id ${w} ORDER BY o.id DESC`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return res.send(toCSV(q.all(sql, ...p)));
  }
  const total = q.get(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN o.status IN ('delivered','completed') THEN o.total END),0) revenue FROM orders o ${w}`, ...p);
  const rows = q.all(`${sql} LIMIT 50 OFFSET ${(page - 1) * 50}`, ...p);
  return { rows, total: total.n, revenue: total.revenue, page, pages: Math.max(1, Math.ceil(total.n / 50)) };
}));

r.get('/:id', staff, h((req, res) => {
  const o = getOrder(parse(id, req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found' });
  return { ...withActions(o, req.user), events: getOrderEvents(o.id) };
}));

r.post('/quote', requireRole('manager', 'cashier', 'waiter'), h((req) => {
  const b = parse(z.object({ type: z.enum(['delivery', 'takeaway', 'dine_in']), items: z.array(cartItem), zone_id: id.optional().nullable(), discount: z.coerce.number().min(0).default(0), promo_code: z.string().trim().max(30).optional().nullable() }), req.body);
  if (!b.items.length) return { subtotal: 0, tax: 0, delivery_fee: 0, discount: 0, total: 0 };
  const { lines, ...rest } = priceCart(b.items, { type: b.type, zoneId: b.zone_id, discount: b.discount, promoCode: b.promo_code, source: 'pos' });
  return { ...rest, cost: lines.reduce((s, l) => s + l.unit_cost * l.qty, 0) };
}));

r.post('/', requireRole('manager', 'cashier', 'waiter'), h((req, res) => {
  const body = parse(posOrder, req.body);
  if (body.discount > 0 && !['admin', 'manager', 'cashier'].includes(req.user.role)) body.discount = 0;
  res.status(201);
  return withActions(createOrder(body, req.user), req.user);
}));

r.post('/:id/status', staff, h((req) => {
  const b = parse(z.object({
    to: z.string(), reason: z.string().max(200).optional(), note: z.string().max(200).optional(),
    rider_id: id.optional(), payment_method: z.enum(['cash', 'card', 'wallet']).optional(),
    cash_collected: z.coerce.number().min(0).optional(),
  }), req.body);
  return withActions(transition(parse(id, req.params.id), b.to, req.user, b), req.user);
}));

r.post('/:id/assign', requireRole('manager', 'cashier'), h((req) => {
  const b = parse(z.object({ rider_id: id.nullable() }), req.body);
  return withActions(assignRider(parse(id, req.params.id), b.rider_id, req.user), req.user);
}));

r.post('/:id/items/:itemId/done', requireRole('chef', 'manager', 'cashier'), h((req) => {
  return toggleItemDone(parse(id, req.params.id), parse(id, req.params.itemId), !!req.body.done);
}));

export default r;

/* ---------------- Rider ---------------- */
export const rider = Router();

rider.get('/dashboard', requireRole('rider'), h((req) => {
  const me = req.user.id;
  const open = openOrders().filter((o) => o.type === 'delivery');
  const stats = q.get(`SELECT COUNT(*) deliveries, COALESCE(SUM(d.commission),0) commission
      FROM deliveries d WHERE d.rider_id = ? AND d.status = 'delivered' AND date(d.delivered_at,'localtime') = date('now','localtime')`, me);
  // Cash still in the rider's pocket: everything collected and not yet handed in at the counter
  stats.cash = q.get(`SELECT COALESCE(SUM(cash_collected),0) v FROM deliveries WHERE rider_id = ? AND status = 'delivered' AND settled_at IS NULL`, me).v;
  const history = q.all(`SELECT o.id, o.code, o.customer_name, o.address, o.total, o.payment_method, d.delivered_at, d.cash_collected, d.commission
      FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.rider_id = ? AND d.status = 'delivered'
      ORDER BY d.delivered_at DESC LIMIT 15`, me);
  return {
    // Shelf: ready orders not taken by another rider, plus orders pre-assigned to me still cooking
    available: open.filter((o) => (o.status === 'ready' && (!o.rider_id || o.rider_id === me)) ||
      (['received', 'preparing'].includes(o.status) && o.rider_id === me)).map((o) => withActions(o, req.user)),
    active: open.filter((o) => o.status === 'out_for_delivery' && o.rider_id === me).map((o) => withActions(o, req.user)),
    stats, history,
  };
}));

rider.post('/location', requireRole('rider'), h((req) => {
  const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), req.body);
  return { updated: updateRiderLocation(req.user.id, b.lat, b.lng) };
}));

rider.get('/list', requireRole('manager', 'cashier'), h(() => q.all(`
  SELECT e.id, e.name, e.phone,
    (SELECT COUNT(*) FROM deliveries d WHERE d.rider_id = e.id AND d.status IN ('assigned','picked_up')) AS active_deliveries,
    (SELECT COUNT(*) FROM attendance a WHERE a.employee_id = e.id AND a.clock_out IS NULL) AS on_shift
  FROM employees e WHERE e.role = 'rider' AND e.active = 1 ORDER BY on_shift DESC, active_deliveries, e.name`)));
