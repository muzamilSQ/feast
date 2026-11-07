import { q, tx } from '../db.js';
import { broadcast } from '../realtime.js';

/** Apply a stock movement and write the inventory log. Returns new balance. */
export function moveStock({ ingredientId, change, type, unitCost, ref, note, employeeId }) {
  const ing = q.get('SELECT id, name, stock, reorder_level, cost_per_unit, unit FROM ingredients WHERE id = ?', ingredientId);
  if (!ing) throw httpError(404, 'Ingredient not found');
  const balance = round(ing.stock + change, 4);
  q.run('UPDATE ingredients SET stock = ? WHERE id = ?', balance, ingredientId);
  q.run(`INSERT INTO inventory_logs(ingredient_id, change, balance, type, unit_cost, ref, note, employee_id)
         VALUES (?,?,?,?,?,?,?,?)`, ingredientId, change, balance, type, unitCost ?? ing.cost_per_unit, ref, note, employeeId);
  if (change < 0 && ing.stock > ing.reorder_level && balance <= ing.reorder_level) {
    broadcast('stock:low', { id: ing.id, name: ing.name, stock: balance, unit: ing.unit, reorder_level: ing.reorder_level });
  }
  return balance;
}

/** Recipe lines that apply to one order line (base item + selected variant + add-ons). */
export function recipeLines(itemId, variantName, addonNames = []) {
  const base = q.all(`
    SELECT r.ingredient_id, r.qty, i.cost_per_unit FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
    WHERE r.item_id = ? AND r.addon_name IS NULL AND (r.variant_name IS NULL OR r.variant_name = ?)`, itemId, variantName);
  const addons = addonNames.length
    ? q.all(`
      SELECT r.ingredient_id, r.qty, r.addon_name, i.cost_per_unit FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
      WHERE r.item_id = ? AND r.addon_name IS NOT NULL AND (r.variant_name IS NULL OR r.variant_name = ?)`, itemId, variantName)
      .filter((r) => addonNames.includes(r.addon_name))
    : [];
  return [...base, ...addons];
}

export function unitCost(itemId, variantName, addonNames) {
  return round(recipeLines(itemId, variantName, addonNames).reduce((s, r) => s + r.qty * r.cost_per_unit, 0), 2);
}

/** Deduct raw ingredients for every line of an order (called when the kitchen starts preparing). */
export function deductForOrder(orderId, employeeId) {
  const order = q.get('SELECT code FROM orders WHERE id = ?', orderId);
  const lines = q.all('SELECT item_id, variant_name, addons, qty FROM order_items WHERE order_id = ?', orderId);
  const totals = new Map();
  for (const l of lines) {
    if (!l.item_id) continue;
    const addonNames = JSON.parse(l.addons).map((a) => a.name);
    for (const r of recipeLines(l.item_id, l.variant_name, addonNames)) {
      totals.set(r.ingredient_id, (totals.get(r.ingredient_id) || 0) + r.qty * l.qty);
    }
  }
  tx(() => {
    for (const [ingredientId, qty] of totals) {
      moveStock({ ingredientId, change: -round(qty, 4), type: 'usage', ref: `order:${order.code}`, employeeId });
    }
  });
  broadcast('inventory:changed', {});
}

export function lowStock() {
  return q.all(`SELECT id, name, unit, stock, reorder_level FROM ingredients
                WHERE active = 1 AND stock <= reorder_level ORDER BY (stock / NULLIF(reorder_level,0)) ASC`);
}

export function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
