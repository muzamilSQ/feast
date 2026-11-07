import { Router } from 'express';
import { z } from 'zod';
import { q, getSettings } from '../db.js';
import { h, parse, id, phone } from '../util.js';
import { createOrder, getOrder, priceCart, publicOrder } from '../services/orders.js';
import { subscribeOrder } from '../realtime.js';

const r = Router();

/** [{grp,name}] rows -> [{ group, options: [..] }] keeping first-seen group order */
export function groupChoices(rows) {
  const out = [];
  for (const r of rows) {
    let g = out.find((x) => x.group === r.grp);
    if (!g) out.push(g = { group: r.grp, options: [] });
    g.options.push(r.name);
  }
  return out;
}

export function loadMenu({ includeHidden = false } = {}) {
  const categories = q.all('SELECT * FROM categories ORDER BY sort, id');
  const items = q.all(`SELECT * FROM menu_items WHERE archived = 0 ${includeHidden ? '' : 'AND available = 1'} ORDER BY sort, id`);
  const variants = q.all('SELECT * FROM item_variants ORDER BY sort, id');
  const addons = q.all('SELECT * FROM item_addons ORDER BY id');
  const choiceRows = q.all('SELECT * FROM item_choices ORDER BY item_id, sort, id');
  const byItem = (rows) => rows.reduce((m, x) => ((m[x.item_id] ||= []).push(x), m), {});
  const v = byItem(variants);
  const a = byItem(addons);
  return categories.map((c) => ({
    ...c,
    items: items.filter((i) => i.category_id === c.id).map((i) => ({
      ...i, is_veg: !!i.is_veg, available: !!i.available, featured: !!i.featured,
      variants: v[i.id] || [], addons: a[i.id] || [], choices: groupChoices(choiceRows.filter((c) => c.item_id === i.id)),
    })),
  }));
}

export function publicSettings() {
  const s = getSettings();
  return {
    name: s.restaurant_name, tagline: s.tagline, phone: s.phone, whatsapp: s.whatsapp, address: s.address,
    tax_rate: s.tax_rate, free_delivery_threshold: s.free_delivery_threshold, min_delivery_order: s.min_delivery_order,
    tables: s.tables, dine_in_billing: s.dine_in_billing || 'after', accepting_orders: s.accepting_orders !== false, opening_hours: s.opening_hours, currency: s.currency || 'Rs.',
    zones: q.all('SELECT id, name, fee FROM delivery_zones WHERE active = 1 ORDER BY fee, name'),
  };
}

r.get('/menu', h(() => ({ settings: publicSettings(), categories: loadMenu().filter((c) => c.items.length) })));

const cartItem = z.object({
  item_id: id,
  variant_id: id.optional().nullable(),
  addons: z.array(z.string()).max(10).default([]),
  options: z.record(z.string().max(40), z.string().max(60)).default({}),
  qty: z.coerce.number().int().min(1).max(50),
  notes: z.string().max(200).optional().nullable(),
});

const orderSchema = z.object({
  type: z.enum(['delivery', 'takeaway', 'dine_in']),
  items: z.array(cartItem).min(1).max(60),
  customer_name: z.string().trim().min(2, 'Enter your name').max(60),
  phone,
  address: z.string().trim().max(300).optional().nullable(),
  zone_id: id.optional().nullable(),
  table_no: z.string().max(10).optional().nullable(),
  payment_method: z.enum(['cash', 'card', 'wallet']).default('cash'),
  notes: z.string().max(300).optional().nullable(),
  promo_code: z.string().trim().max(30).optional().nullable(),
}).superRefine((o, ctx) => {
  if (o.type === 'delivery' && (!o.address || o.address.length < 8)) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Enter your full delivery address' });
  if (o.type === 'delivery' && !o.zone_id) ctx.addIssue({ code: 'custom', path: ['zone_id'], message: 'Choose your area' });
  if (o.type === 'dine_in' && !o.table_no) ctx.addIssue({ code: 'custom', path: ['table_no'], message: 'Choose your table' });
});

r.post('/quote', h((req) => {
  const body = parse(z.object({ type: z.enum(['delivery', 'takeaway', 'dine_in']), items: z.array(cartItem), zone_id: id.optional().nullable(), promo_code: z.string().trim().max(30).optional().nullable() }), req.body);
  if (!body.items.length) return { subtotal: 0, tax: 0, delivery_fee: 0, discount: 0, total: 0, lines: [] };
  const p = priceCart(body.items, { type: body.type, zoneId: body.zone_id, promoCode: body.promo_code, source: 'online' });
  return { ...p, lines: p.lines.map(({ unit_cost, recipe_variant, ...l }) => l) };
}));

r.post('/orders', h((req, res) => {
  const body = parse(orderSchema, req.body);
  const order = createOrder({ ...body, source: 'online' }, null);
  res.status(201);
  return publicOrder(order);
}));

function byCode(code) {
  const row = q.get('SELECT id FROM orders WHERE code = ?', String(code).toUpperCase());
  return row ? getOrder(row.id) : null;
}

r.get('/orders/:code', h((req, res) => {
  const o = byCode(req.params.code);
  if (!o) return res.status(404).json({ error: 'Order not found. Check your order code.' });
  return publicOrder(o);
}));

r.get('/orders/:code/stream', (req, res) => {
  const o = byCode(req.params.code);
  if (!o) return res.status(404).end();
  subscribeOrder(o.code, req, res);
  res.write(`event: order\ndata: ${JSON.stringify(publicOrder(o))}\n\n`);
});

export default r;
