import crypto from 'node:crypto';
import { db, q, tx, getSettings, audit } from '../db.js';
import { broadcast, notifyOrder } from '../realtime.js';
import { deductForOrder, unitCost, round, httpError } from './inventory.js';

export const STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'cancelled'];
export const OPEN_STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery'];
export const CLOSED_STATUSES = ['delivered', 'completed'];

/**
 * Order state machine. Each transition lists the roles allowed to perform it
 * (admin is always allowed). Delivery orders go ready -> out_for_delivery -> delivered;
 * takeaway / dine-in go ready -> completed.
 */
const TRANSITIONS = {
  received: { preparing: ['chef', 'manager', 'cashier'], cancelled: ['manager', 'cashier'] },
  preparing: { ready: ['chef', 'manager', 'cashier'], cancelled: ['manager'] },
  ready: {
    out_for_delivery: ['rider', 'manager', 'cashier'],
    completed: ['cashier', 'waiter', 'manager'],
    cancelled: ['manager'],
  },
  out_for_delivery: { delivered: ['rider', 'manager'], ready: ['rider', 'manager'] },
};

export function allowedTransitions(order, role) {
  const t = TRANSITIONS[order.status] || {};
  return Object.entries(t)
    .filter(([to]) => {
      if (to === 'out_for_delivery' || to === 'delivered') return order.type === 'delivery';
      if (to === 'completed') return order.type !== 'delivery';
      return true;
    })
    .filter(([, roles]) => role === 'admin' || roles.includes(role))
    .map(([to]) => to);
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += alphabet[b % alphabet.length];
  return s;
}

/** Validate and price a cart entirely server-side. Never trust client prices. */
/**
 * Validates a promo code against a subtotal. Returns { promo, amount } or { error }.
 */
export function checkPromo(code, subtotal, { source = 'online' } = {}) {
  if (!code) return {};
  const p = q.get('SELECT * FROM promos WHERE code = ? COLLATE NOCASE', String(code).trim());
  const today = new Date().toLocaleDateString('en-CA');
  if (!p || !p.active) return { error: 'That promo code is not valid' };
  if (p.starts_on && today < p.starts_on) return { error: 'That promo code is not active yet' };
  if (p.ends_on && today > p.ends_on) return { error: 'That promo code has expired' };
  if (p.max_uses && p.uses >= p.max_uses) return { error: 'That promo code has been fully used' };
  if (p.online_only && source !== 'online') return { error: 'That promo code is for online orders only' };
  if (subtotal < p.min_subtotal) return { error: `Spend Rs. ${p.min_subtotal.toLocaleString('en-PK')} or more to use ${p.code}` };
  let amount = p.kind === 'percent' ? (subtotal * p.value) / 100 : p.value;
  if (p.max_discount) amount = Math.min(amount, p.max_discount);
  return { promo: p, amount: Math.round(Math.min(amount, subtotal)) };
}

export function priceCart(items, { type, zoneId, discount = 0, promoCode = null, source = 'online', strictPromo = false } = {}) {
  const settings = getSettings();
  const lines = [];
  for (const it of items) {
    const item = q.get('SELECT * FROM menu_items WHERE id = ? AND archived = 0', it.item_id);
    if (!item) throw httpError(400, 'An item in your cart no longer exists');
    if (!item.available) throw httpError(400, `${item.name} is currently unavailable`);
    const variants = q.all('SELECT * FROM item_variants WHERE item_id = ? ORDER BY sort, id', item.id);
    const variant = it.variant_id ? variants.find((v) => v.id === it.variant_id) : variants[0];
    if (!variant) throw httpError(400, `Please choose an option for ${item.name}`);
    const addonRows = q.all('SELECT * FROM item_addons WHERE item_id = ? AND (variant_name IS NULL OR variant_name = ?)', item.id, variant.name);
    const addons = [];
    for (const name of it.addons || []) {
      const a = addonRows.find((r) => r.name === name);
      if (!a) throw httpError(400, `Add-on "${name}" is not available for ${item.name}`);
      addons.push({ name: a.name, price: a.price });
    }
    // Required single-choice groups (e.g. drink flavour). Stored in the line's display name.
    const groups = q.all('SELECT grp, name FROM item_choices WHERE item_id = ? ORDER BY sort, id', item.id);
    const picked = [];
    for (const g of [...new Set(groups.map((c) => c.grp))]) {
      const val = it.options?.[g];
      if (!val) throw httpError(400, `Please choose ${g.toLowerCase()} for ${item.name}`);
      if (!groups.some((c) => c.grp === g && c.name === val)) throw httpError(400, `"${val}" is not an option for ${item.name}`);
      picked.push(val);
    }
    const unitPrice = variant.price + addons.reduce((s, a) => s + a.price, 0);
    const qty = Math.max(1, Math.min(50, Math.floor(it.qty || 1)));
    lines.push({
      item_id: item.id,
      name: item.name,
      variant_name: [variants.length > 1 ? variant.name : null, ...picked].filter(Boolean).join(' · ') || null,
      recipe_variant: variant.name,
      addons,
      unit_price: unitPrice,
      qty,
      line_total: unitPrice * qty,
      unit_cost: unitCost(item.id, variant.name, addons.map((a) => a.name)),
      station: item.station,
      notes: it.notes?.trim() || null,
    });
  }
  if (!lines.length) throw httpError(400, 'Your cart is empty');

  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  let deliveryFee = 0;
  if (type === 'delivery') {
    const zone = q.get('SELECT * FROM delivery_zones WHERE id = ? AND active = 1', zoneId);
    if (!zone) throw httpError(400, 'Please choose your delivery area');
    const threshold = Number(settings.free_delivery_threshold || 0);
    deliveryFee = threshold && subtotal >= threshold ? 0 : zone.fee;
  }
  const pc = checkPromo(promoCode, subtotal, { source });
  if (pc.error && strictPromo) throw httpError(400, pc.error);
  const promoAmount = pc.amount || 0;
  const disc = Math.min(Math.max(0, discount) + promoAmount, subtotal);
  const taxRate = Number(settings.tax_rate || 0);
  const tax = round(((subtotal - disc) * taxRate) / 100, 0);
  const total = subtotal - disc + tax + deliveryFee;
  return {
    lines, subtotal, discount: disc, tax, delivery_fee: deliveryFee, total, tax_rate: taxRate,
    promo: pc.promo ? { code: pc.promo.code, description: pc.promo.description, amount: promoAmount } : null,
    promo_error: pc.error || null,
  };
}

export function createOrder(input, user) {
  const settings = getSettings();
  if (input.source === 'online' && settings.accepting_orders === false) {
    throw httpError(503, 'We are not accepting online orders right now. Please try again later.');
  }
  const priced = priceCart(input.items, { type: input.type, zoneId: input.zone_id, discount: user ? input.discount : 0, promoCode: input.promo_code, source: input.source, strictPromo: true });
  const minOrder = Number(settings.min_delivery_order || 0);
  if (input.type === 'delivery' && input.source === 'online' && priced.subtotal < minOrder) {
    throw httpError(400, `Minimum order for delivery is Rs. ${minOrder}`);
  }

  const id = tx(() => {
    let customerId = null;
    if (input.phone) {
      const existing = q.get('SELECT id FROM customers WHERE phone = ?', input.phone);
      if (existing) {
        customerId = existing.id;
        q.run('UPDATE customers SET name = ?, address = COALESCE(?, address) WHERE id = ?', input.customer_name || 'Guest', input.address || null, customerId);
      } else {
        customerId = q.run('INSERT INTO customers(name, phone, address) VALUES (?,?,?)', input.customer_name || 'Guest', input.phone, input.address || null).lastInsertRowid;
      }
    }
    const cogs = priced.lines.reduce((s, l) => s + l.unit_cost * l.qty, 0);
    const res = q.run(`
      INSERT INTO orders(code, type, source, customer_id, customer_name, phone, address, zone_id, table_no,
        subtotal, tax, delivery_fee, discount, total, cogs, payment_method, payment_status, notes, created_by, promo_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      newCode(), input.type, input.source, customerId, input.customer_name || null, input.phone || null,
      input.type === 'delivery' ? input.address : null, input.type === 'delivery' ? input.zone_id : null,
      input.type === 'dine_in' ? input.table_no : null,
      priced.subtotal, priced.tax, priced.delivery_fee, priced.discount, priced.total, round(cogs),
      input.payment_method || 'cash', input.paid_now ? 'paid' : 'unpaid', input.notes || null, user?.id ?? null, priced.promo?.code ?? null);
    if (priced.promo) q.run('UPDATE promos SET uses = uses + 1 WHERE code = ? COLLATE NOCASE', priced.promo.code);
    const orderId = Number(res.lastInsertRowid);
    for (const l of priced.lines) {
      q.run(`INSERT INTO order_items(order_id, item_id, name, variant_name, addons, unit_price, qty, line_total, unit_cost, station, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.item_id, l.name, l.variant_name ?? null, JSON.stringify(l.addons), l.unit_price, l.qty, l.line_total, l.unit_cost, l.station, l.notes);
    }
    q.run('INSERT INTO order_events(order_id, from_status, to_status, employee_id, note) VALUES (?,?,?,?,?)',
      orderId, null, 'received', user?.id ?? null, `Order placed via ${input.source}`);
    return orderId;
  });

  const order = getOrder(id);
  broadcast('order:new', order);
  return order;
}

export function getOrder(id) {
  const order = q.get(`
    SELECT o.*, r.name AS rider_name, r.phone AS rider_phone, z.name AS zone_name, c.name AS created_by_name
    FROM orders o
    LEFT JOIN employees r ON r.id = o.rider_id
    LEFT JOIN employees c ON c.id = o.created_by
    LEFT JOIN delivery_zones z ON z.id = o.zone_id
    WHERE o.id = ?`, id);
  if (!order) return null;
  order.items = q.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id).map((i) => ({ ...i, addons: JSON.parse(i.addons) }));
  order.delivery = q.get('SELECT * FROM deliveries WHERE order_id = ?', id) || null;
  return order;
}

export function getOrderEvents(id) {
  return q.all(`SELECT ev.*, e.name AS employee_name FROM order_events ev LEFT JOIN employees e ON e.id = ev.employee_id
                WHERE ev.order_id = ? ORDER BY ev.id`, id);
}

/** Customer-safe projection used by the public tracker. */
export function publicOrder(order) {
  if (!order) return null;
  return {
    code: order.code, number: order.id, type: order.type, status: order.status,
    customer_name: order.customer_name, table_no: order.table_no, zone_name: order.zone_name,
    subtotal: order.subtotal, tax: order.tax, delivery_fee: order.delivery_fee, discount: order.discount, total: order.total,
    payment_method: order.payment_method, payment_status: order.payment_status,
    created_at: order.created_at, preparing_at: order.preparing_at, ready_at: order.ready_at,
    picked_at: order.picked_at, closed_at: order.closed_at, cancel_reason: order.cancel_reason,
    rider_name: order.rider_name ? order.rider_name.split(' ')[0] : null,
    rider_phone: order.status === 'out_for_delivery' ? order.rider_phone : null,
    rider_location: order.status === 'out_for_delivery' && order.delivery?.last_lat
      ? { lat: order.delivery.last_lat, lng: order.delivery.last_lng, at: order.delivery.location_at } : null,
    items: order.items.map((i) => ({ name: i.name, variant_name: i.variant_name, addons: i.addons, qty: i.qty, line_total: i.line_total })),
  };
}

function emit(order) {
  broadcast('order:updated', order);
  notifyOrder(order.code, publicOrder(order));
}

/* ---------------- Dine-in tables ---------------- */
const tableOrders = (no) => q.all(`SELECT id FROM orders WHERE type = 'dine_in' AND table_no = ? AND status IN ('received','preparing','ready') ORDER BY id`, String(no)).map((r) => getOrder(r.id));

/** Floor overview: every table with its open tab (one or more rounds of orders). */
export function tablesOverview() {
  const count = Number(getSettings().tables || 0);
  const open = q.all(`SELECT id FROM orders WHERE type = 'dine_in' AND status IN ('received','preparing','ready') ORDER BY id`).map((r) => getOrder(r.id));
  const byTable = new Map();
  for (const o of open) {
    const k = String(o.table_no || '?');
    if (!byTable.has(k)) byTable.set(k, []);
    byTable.get(k).push(o);
  }
  const names = Array.from({ length: count }, (_, i) => String(i + 1));
  for (const k of byTable.keys()) if (!names.includes(k)) names.push(k);
  return names.map((no) => {
    const orders = byTable.get(no) || [];
    let state = 'free';
    if (orders.length) {
      if (orders.some((o) => o.status === 'ready' && !o.served_at)) state = 'to_serve';
      else if (orders.some((o) => o.status !== 'ready')) state = 'cooking';
      else state = 'eating';
      if (orders.some((o) => o.bill_requested_at) && state === 'eating') state = 'bill';
    }
    const unpaid = orders.filter((o) => o.payment_status !== 'paid');
    return {
      table: no, state, orders,
      seated_at: orders[0]?.created_at || null,
      total: orders.reduce((s, o) => s + o.total, 0),
      due: unpaid.reduce((s, o) => s + o.total, 0),
      items: orders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0),
      customer: orders.find((o) => o.customer_name)?.customer_name || null,
      bill_requested: orders.some((o) => o.bill_requested_at),
    };
  });
}

export function markServed(orderId, user) {
  const o = q.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw httpError(404, 'Order not found');
  if (o.type !== 'dine_in') throw httpError(400, 'Only dine-in orders are served to a table');
  if (o.status !== 'ready') throw httpError(409, 'This order is not ready yet');
  if (o.served_at) return getOrder(orderId);
  q.run("UPDATE orders SET served_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", orderId);
  q.run('INSERT INTO order_events(order_id, from_status, to_status, employee_id, note) VALUES (?,?,?,?,?)', orderId, 'ready', 'ready', user.id, `Served to table ${o.table_no}`);
  const u = getOrder(orderId);
  emit(u);
  return u;
}

export function requestBill(tableNo, user) {
  const orders = tableOrders(tableNo);
  if (!orders.length) throw httpError(404, `Table ${tableNo} has no open orders`);
  q.run(`UPDATE orders SET bill_requested_at = COALESCE(bill_requested_at, datetime('now')) WHERE type = 'dine_in' AND table_no = ? AND status IN ('received','preparing','ready')`, String(tableNo));
  audit(user.id, 'table.bill', 'table', Number(tableNo) || null, { orders: orders.map((o) => o.id) });
  broadcast('order:updated', { table: tableNo });
  return tableOrders(tableNo);
}

/** Close a table: every round is completed (and paid) in one go and posted to the ledger. */
export function settleTable(tableNo, user, { payment_method }) {
  const orders = tableOrders(tableNo);
  if (!orders.length) throw httpError(404, `Table ${tableNo} has no open orders`);
  const cooking = orders.filter((o) => o.status !== 'ready');
  if (cooking.length) throw httpError(409, `Table ${tableNo} still has ${cooking.length === 1 ? 'an order' : `${cooking.length} orders`} in the kitchen (#${cooking.map((o) => o.id).join(', #')}). Serve or cancel it first.`);
  const closed = tx(() => orders.map((o) => {
    if (!o.served_at) q.run("UPDATE orders SET served_at = datetime('now') WHERE id = ?", o.id);
    return transition(o.id, 'completed', user, { payment_method: o.payment_status === 'paid' ? o.payment_method : payment_method, note: `Table ${tableNo} settled` });
  }));
  audit(user.id, 'table.settle', 'table', Number(tableNo) || null, { orders: closed.map((o) => o.id), total: closed.reduce((s, o) => s + o.total, 0), payment_method });
  return closed;
}

export function moveTable(from, to, user) {
  const orders = tableOrders(from);
  if (!orders.length) throw httpError(404, `Table ${from} has no open orders`);
  if (String(from) === String(to)) throw httpError(400, 'Choose a different table');
  q.run(`UPDATE orders SET table_no = ?, updated_at = datetime('now') WHERE type = 'dine_in' AND table_no = ? AND status IN ('received','preparing','ready')`, String(to), String(from));
  for (const o of orders) q.run('INSERT INTO order_events(order_id, from_status, to_status, employee_id, note) VALUES (?,?,?,?,?)', o.id, o.status, o.status, user.id, `Moved from table ${from} to table ${to}`);
  audit(user.id, 'table.move', 'table', Number(from) || null, { to, orders: orders.map((o) => o.id) });
  broadcast('order:updated', { table: to });
  return tableOrders(to);
}

/** Move an order through the state machine, applying side effects atomically. */
export function transition(orderId, to, user, opts = {}) {
  const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (!STATUSES.includes(to)) throw httpError(400, 'Unknown status');
  if (!allowedTransitions(order, user.role).includes(to)) {
    throw httpError(409, `Cannot move order from "${order.status}" to "${to}"`);
  }
  if (to === 'cancelled' && !opts.reason) throw httpError(400, 'A cancellation reason is required');

  tx(() => {
    const sets = ['status = :to', "updated_at = datetime('now')"];
    let note = opts.note || null;

    if (to === 'preparing') {
      sets.push("preparing_at = datetime('now')");
      deductForOrder(orderId, user.id);
    }
    if (to === 'ready' && order.status === 'preparing') {
      sets.push("ready_at = datetime('now')");
      q.run('UPDATE order_items SET done = 1 WHERE order_id = ?', orderId);
    }
    if (to === 'out_for_delivery') {
      let riderId = order.rider_id;
      if (user.role === 'rider') {
        if (riderId && riderId !== user.id) throw httpError(409, 'This order is assigned to another rider');
        riderId = user.id;
      } else {
        riderId = opts.rider_id || riderId;
        if (!riderId) throw httpError(400, 'Choose a rider for this delivery');
      }
      assertRider(riderId);
      sets.push("picked_at = datetime('now')", 'rider_id = :rider');
      q.run(`INSERT INTO deliveries(order_id, rider_id, status, picked_at) VALUES (?, ?, 'picked_up', datetime('now'))
             ON CONFLICT(order_id) DO UPDATE SET rider_id = excluded.rider_id, status = 'picked_up', picked_at = datetime('now')`,
        orderId, riderId);
      opts._rider = riderId;
    }
    if (to === 'ready' && order.status === 'out_for_delivery') {
      // Delivery attempt failed - order goes back to the dispatch shelf
      q.run("UPDATE deliveries SET status = 'failed', note = ? WHERE order_id = ?", opts.note || 'Returned to restaurant', orderId);
      sets.push('rider_id = NULL');
      note = `Delivery attempt failed: ${opts.note || 'returned'}`;
    }
    if (to === 'delivered' || to === 'completed') {
      if (user.role === 'rider' && order.rider_id !== user.id) throw httpError(403, 'This delivery belongs to another rider');
      sets.push("closed_at = datetime('now')", "payment_status = 'paid'");
      if (opts.payment_method) sets.push('payment_method = :pm');
      const method = opts.payment_method || order.payment_method;
      // Finalise into the central ledger
      q.run(`INSERT INTO transactions(type, amount, method, order_id, ref, description, employee_id)
             VALUES ('sale', ?, ?, ?, ?, ?, ?)`,
        order.total, method, orderId, order.code,
        `${order.type === 'delivery' ? 'Delivery' : order.type === 'dine_in' ? 'Dine-in' : 'Takeaway'} order #${order.id}`, user.id);
      if (to === 'delivered') {
        const commission = Number(q.get('SELECT commission_per_delivery c FROM employees WHERE id = ?', order.rider_id)?.c || 0);
        q.run(`UPDATE deliveries SET status = 'delivered', delivered_at = datetime('now'), cash_collected = ?, commission = ?
               WHERE order_id = ?`, method === 'cash' ? (opts.cash_collected ?? order.total) : 0, commission, orderId);
      }
    }
    if (to === 'cancelled') {
      sets.push("closed_at = datetime('now')", 'cancel_reason = :reason');
      if (order.payment_status === 'paid') {
        sets.push("payment_status = 'refunded'");
        q.run(`INSERT INTO transactions(type, amount, method, order_id, ref, description, employee_id)
               VALUES ('refund', ?, ?, ?, ?, ?, ?)`, -order.total, order.payment_method, orderId, order.code, `Refund for cancelled order #${order.id}`, user.id);
      }
      note = opts.reason + (order.status === 'preparing' ? ' (ingredients already used were not restocked)' : '');
    }

    const sql = `UPDATE orders SET ${sets.join(', ')} WHERE id = :id`;
    const params = { to, id: orderId, rider: opts._rider ?? null, pm: opts.payment_method ?? null, reason: opts.reason ?? null };
    // node:sqlite rejects unused named parameters, so only bind those present in the statement
    db.prepare(sql).run(Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes(`:${k}`))));
    q.run('INSERT INTO order_events(order_id, from_status, to_status, employee_id, note) VALUES (?,?,?,?,?)',
      orderId, order.status, to, user.id, note);
  });

  const updated = getOrder(orderId);
  emit(updated);
  if (CLOSED_STATUSES.includes(to)) broadcast('order:closed', { id: orderId, total: updated.total });
  return updated;
}

function assertRider(id) {
  const r = q.get("SELECT id FROM employees WHERE id = ? AND role = 'rider' AND active = 1", id);
  if (!r) throw httpError(400, 'Selected rider is not active');
}

/** Pre-assign a rider while the order is still being prepared / waiting on the shelf. */
export function assignRider(orderId, riderId, user) {
  const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (order.type !== 'delivery') throw httpError(400, 'Only delivery orders can have a rider');
  if (!['received', 'preparing', 'ready'].includes(order.status)) throw httpError(409, 'Rider can no longer be changed');
  if (riderId) assertRider(riderId);
  tx(() => {
    q.run("UPDATE orders SET rider_id = ?, updated_at = datetime('now') WHERE id = ?", riderId || null, orderId);
    if (riderId) {
      q.run(`INSERT INTO deliveries(order_id, rider_id, status) VALUES (?, ?, 'assigned')
             ON CONFLICT(order_id) DO UPDATE SET rider_id = excluded.rider_id, status = 'assigned', assigned_at = datetime('now')`, orderId, riderId);
    } else {
      q.run('DELETE FROM deliveries WHERE order_id = ?', orderId);
    }
    audit(user.id, 'order.assign_rider', 'order', orderId, { riderId });
  });
  const updated = getOrder(orderId);
  emit(updated);
  return updated;
}

export function toggleItemDone(orderId, itemId, done) {
  q.run('UPDATE order_items SET done = ? WHERE id = ? AND order_id = ?', done ? 1 : 0, itemId, orderId);
  const updated = getOrder(orderId);
  broadcast('order:updated', updated);
  return updated;
}

export function updateRiderLocation(riderId, lat, lng) {
  const active = q.all("SELECT order_id FROM deliveries WHERE rider_id = ? AND status = 'picked_up'", riderId);
  q.run(`UPDATE deliveries SET last_lat = ?, last_lng = ?, location_at = datetime('now')
         WHERE rider_id = ? AND status = 'picked_up'`, lat, lng, riderId);
  for (const { order_id } of active) emit(getOrder(order_id));
  broadcast('rider:location', { rider_id: riderId, lat, lng });
  return active.length;
}
