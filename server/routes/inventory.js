import { Router } from 'express';
import { z } from 'zod';
import { q, tx, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { broadcast } from '../realtime.js';
import { h, parse, id, money, toCSV } from '../util.js';
import { moveStock, lowStock, round } from '../services/inventory.js';

const r = Router();
const mgr = requireRole('manager');

r.get('/ingredients', requireRole('manager', 'chef'), h(() => q.all(`
  SELECT i.*, s.name AS supplier_name,
    (SELECT COALESCE(-SUM(change),0) FROM inventory_logs l WHERE l.ingredient_id = i.id AND l.type = 'usage' AND l.created_at >= datetime('now','-7 days')) AS used_7d,
    (SELECT COALESCE(-SUM(change),0) FROM inventory_logs l WHERE l.ingredient_id = i.id AND l.type = 'waste' AND l.created_at >= datetime('now','-30 days')) AS waste_30d
  FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.active = 1 ORDER BY i.name`)));

r.get('/low-stock', requireRole('manager', 'chef'), h(() => lowStock()));

const ingSchema = z.object({
  name: z.string().trim().min(2).max(60),
  unit: z.enum(['kg', 'g', 'L', 'ml', 'pcs', 'pack']),
  reorder_level: money,
  cost_per_unit: money,
  supplier_id: id.optional().nullable(),
  stock: money.optional(),
});

r.post('/ingredients', mgr, h((req) => {
  const b = parse(ingSchema, req.body);
  const newId = tx(() => {
    const iid = Number(q.run('INSERT INTO ingredients(name, unit, reorder_level, cost_per_unit, supplier_id) VALUES (?,?,?,?,?)',
      b.name, b.unit, b.reorder_level, b.cost_per_unit, b.supplier_id).lastInsertRowid);
    if (b.stock) moveStock({ ingredientId: iid, change: b.stock, type: 'adjust', note: 'Opening stock', employeeId: req.user.id });
    return iid;
  });
  return { id: newId };
}));

r.put('/ingredients/:id', mgr, h((req) => {
  const b = parse(ingSchema, req.body);
  q.run('UPDATE ingredients SET name=?, unit=?, reorder_level=?, cost_per_unit=?, supplier_id=? WHERE id=?',
    b.name, b.unit, b.reorder_level, b.cost_per_unit, b.supplier_id, parse(id, req.params.id));
  return { ok: true };
}));

r.delete('/ingredients/:id', mgr, h((req) => {
  q.run('UPDATE ingredients SET active = 0 WHERE id = ?', parse(id, req.params.id));
  return { ok: true };
}));

// Manual stock movements: waste, physical count adjustment, or ad-hoc purchase
r.post('/ingredients/:id/movement', requireRole('manager', 'chef'), h((req) => {
  const iid = parse(id, req.params.id);
  const b = parse(z.object({
    type: z.enum(['purchase', 'waste', 'adjust', 'count']),
    qty: z.coerce.number(),
    unit_cost: money.optional(),
    note: z.string().max(200).optional(),
  }), req.body);
  if (req.user.role === 'chef' && b.type !== 'waste') { const e = new Error('Chefs can only record waste'); e.status = 403; throw e; }
  const ing = q.get('SELECT * FROM ingredients WHERE id = ?', iid);
  let change = b.qty;
  let type = b.type;
  if (type === 'waste') change = -Math.abs(b.qty);
  if (type === 'purchase') change = Math.abs(b.qty);
  if (type === 'count') { change = round(b.qty - ing.stock, 4); type = 'adjust'; }
  const balance = tx(() => {
    const bal = moveStock({ ingredientId: iid, change, type, unitCost: b.unit_cost, note: b.note || (b.type === 'count' ? 'Physical count' : null), employeeId: req.user.id });
    if (type === 'purchase') {
      const cost = b.unit_cost ?? ing.cost_per_unit;
      // Weighted average cost keeps COGS accurate as supplier prices change
      const newCost = ing.stock > 0 ? (ing.stock * ing.cost_per_unit + change * cost) / (ing.stock + change) : cost;
      q.run('UPDATE ingredients SET cost_per_unit = ? WHERE id = ?', round(newCost, 4), iid);
      q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id) VALUES ('purchase', ?, 'cash', ?, ?, ?)`,
        -round(change * cost), `ing:${iid}`, `Purchase: ${change} ${ing.unit} ${ing.name}`, req.user.id);
    }
    return bal;
  });
  broadcast('inventory:changed', {});
  return { balance };
}));

r.get('/logs', requireRole('manager', 'chef'), h((req, res) => {
  const where = [];
  const p = [];
  if (req.query.ingredient_id) { where.push('l.ingredient_id = ?'); p.push(Number(req.query.ingredient_id)); }
  if (req.query.type) { where.push('l.type = ?'); p.push(req.query.type); }
  const sql = `SELECT l.*, i.name AS ingredient, i.unit, e.name AS employee_name FROM inventory_logs l
    JOIN ingredients i ON i.id = l.ingredient_id LEFT JOIN employees e ON e.id = l.employee_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ${req.query.format === 'csv' ? 10000 : 300}`;
  const rows = q.all(sql, ...p);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-log.csv"');
    return res.send(toCSV(rows));
  }
  return rows;
}));

/* Suppliers */
const supSchema = z.object({
  name: z.string().trim().min(2).max(80), phone: z.string().max(20).optional().nullable(),
  contact_person: z.string().max(60).optional().nullable(), address: z.string().max(200).optional().nullable(),
});
r.get('/suppliers', mgr, h(() => q.all(`SELECT s.*, (SELECT COUNT(*) FROM ingredients i WHERE i.supplier_id = s.id AND i.active = 1) AS ingredient_count
  FROM suppliers s WHERE active = 1 ORDER BY name`)));
r.post('/suppliers', mgr, h((req) => {
  const b = parse(supSchema, req.body);
  return { id: Number(q.run('INSERT INTO suppliers(name, phone, contact_person, address) VALUES (?,?,?,?)', b.name, b.phone, b.contact_person, b.address).lastInsertRowid) };
}));
r.put('/suppliers/:id', mgr, h((req) => {
  const b = parse(supSchema, req.body);
  q.run('UPDATE suppliers SET name=?, phone=?, contact_person=?, address=? WHERE id=?', b.name, b.phone, b.contact_person, b.address, parse(id, req.params.id));
  return { ok: true };
}));
r.delete('/suppliers/:id', mgr, h((req) => {
  q.run('UPDATE suppliers SET active = 0 WHERE id = ?', parse(id, req.params.id));
  return { ok: true };
}));

/* Purchase orders */
r.get('/purchase-orders', mgr, h(() => {
  const pos = q.all(`SELECT po.*, s.name AS supplier_name, e.name AS created_by_name FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN employees e ON e.id = po.created_by ORDER BY po.id DESC LIMIT 100`);
  for (const po of pos) {
    po.items = q.all(`SELECT pi.*, i.name AS ingredient, i.unit FROM purchase_order_items pi JOIN ingredients i ON i.id = pi.ingredient_id WHERE pi.po_id = ?`, po.id);
  }
  return pos;
}));

r.post('/purchase-orders', mgr, h((req) => {
  const b = parse(z.object({
    supplier_id: id.optional().nullable(), note: z.string().max(200).optional().nullable(),
    items: z.array(z.object({ ingredient_id: id, qty: z.coerce.number().positive(), unit_cost: money })).min(1),
  }), req.body);
  const total = round(b.items.reduce((s, i) => s + i.qty * i.unit_cost, 0));
  const poId = tx(() => {
    const pid = Number(q.run('INSERT INTO purchase_orders(supplier_id, note, total, created_by) VALUES (?,?,?,?)', b.supplier_id, b.note, total, req.user.id).lastInsertRowid);
    for (const i of b.items) q.run('INSERT INTO purchase_order_items(po_id, ingredient_id, qty, unit_cost) VALUES (?,?,?,?)', pid, i.ingredient_id, i.qty, i.unit_cost);
    return pid;
  });
  audit(req.user.id, 'po.create', 'purchase_order', poId, { total });
  return { id: poId };
}));

r.post('/purchase-orders/:id/receive', mgr, h((req) => {
  const pid = parse(id, req.params.id);
  const po = q.get('SELECT * FROM purchase_orders WHERE id = ?', pid);
  if (!po || po.status !== 'pending') { const e = new Error('Only pending purchase orders can be received'); e.status = 409; throw e; }
  const method = req.body.method || 'cash';
  tx(() => {
    for (const it of q.all('SELECT * FROM purchase_order_items WHERE po_id = ?', pid)) {
      const ing = q.get('SELECT * FROM ingredients WHERE id = ?', it.ingredient_id);
      const newCost = ing.stock > 0 ? (ing.stock * ing.cost_per_unit + it.qty * it.unit_cost) / (ing.stock + it.qty) : it.unit_cost;
      moveStock({ ingredientId: it.ingredient_id, change: it.qty, type: 'purchase', unitCost: it.unit_cost, ref: `PO-${pid}`, employeeId: req.user.id });
      q.run('UPDATE ingredients SET cost_per_unit = ? WHERE id = ?', round(newCost, 4), it.ingredient_id);
    }
    q.run("UPDATE purchase_orders SET status = 'received', received_at = datetime('now') WHERE id = ?", pid);
    const sup = po.supplier_id ? q.get('SELECT name FROM suppliers WHERE id = ?', po.supplier_id)?.name : 'supplier';
    q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id) VALUES ('purchase', ?, ?, ?, ?, ?)`,
      -po.total, method, `PO-${pid}`, `Purchase order PO-${pid} from ${sup}`, req.user.id);
  });
  audit(req.user.id, 'po.receive', 'purchase_order', pid);
  broadcast('inventory:changed', {});
  return { ok: true };
}));

r.post('/purchase-orders/:id/cancel', mgr, h((req) => {
  q.run("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", parse(id, req.params.id));
  return { ok: true };
}));

export default r;
