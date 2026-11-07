import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { q, tx, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { broadcast } from '../realtime.js';
import { h, parse, id, money } from '../util.js';
import { loadMenu } from './public.js';
import { unitCost } from '../services/inventory.js';

const r = Router();
const admin = requireRole('manager');
const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'uploads');

const STATIONS = ['grill', 'fryer', 'pizza', 'wraps', 'drinks'];

r.get('/', requireRole('manager', 'cashier', 'waiter', 'chef'), h(() => {
  const cats = loadMenu({ includeHidden: true });
  for (const c of cats) for (const i of c.items) {
    for (const v of i.variants) v.cost = unitCost(i.id, v.name, []);
    i.recipe_count = q.get('SELECT COUNT(*) n FROM recipes WHERE item_id = ?', i.id).n;
  }
  return { categories: cats, stations: STATIONS };
}));

const catSchema = z.object({ name: z.string().trim().min(2).max(40), sort: z.coerce.number().int().default(0) });
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

r.post('/categories', admin, h((req) => {
  const b = parse(catSchema, req.body);
  const res = q.run('INSERT INTO categories(name, slug, sort) VALUES (?,?,?)', b.name, `${slugify(b.name)}-${Date.now() % 10000}`, b.sort);
  return { id: Number(res.lastInsertRowid) };
}));
r.put('/categories/:id', admin, h((req) => {
  const b = parse(catSchema, req.body);
  q.run('UPDATE categories SET name = ?, sort = ? WHERE id = ?', b.name, b.sort, parse(id, req.params.id));
  return { ok: true };
}));
r.delete('/categories/:id', admin, h((req, res) => {
  const cid = parse(id, req.params.id);
  if (q.get('SELECT COUNT(*) n FROM menu_items WHERE category_id = ? AND archived = 0', cid).n) {
    return res.status(409).json({ error: 'Move or archive the items in this category first' });
  }
  q.run('UPDATE menu_items SET category_id = (SELECT MIN(id) FROM categories WHERE id != ?) WHERE category_id = ?', cid, cid);
  q.run('DELETE FROM categories WHERE id = ?', cid);
  return { ok: true };
}));

const itemSchema = z.object({
  category_id: id,
  name: z.string().trim().min(2).max(60),
  description: z.string().max(300).default(''),
  image: z.string().max(300).optional().nullable(),
  is_veg: z.boolean().default(false),
  spicy: z.coerce.number().int().min(0).max(3).default(0),
  station: z.enum(STATIONS),
  available: z.boolean().default(true),
  featured: z.boolean().default(false),
  sort: z.coerce.number().int().default(0),
  variants: z.array(z.object({ name: z.string().trim().min(1).max(30), price: money })).min(1, 'Add at least one price'),
  addons: z.array(z.object({ name: z.string().trim().min(1).max(40), price: money, variant_name: z.string().optional().nullable() })).default([]),
  compare_at: money.optional().nullable(),
  choices: z.array(z.object({ group: z.string().trim().min(1).max(40), options: z.array(z.string().trim().min(1).max(60)).min(2, 'A choice needs at least two options').max(30) })).max(6).default([]),
});

function saveChildren(itemId, b) {
  // Keep variant ids stable where names are unchanged so carts don't break
  const existing = q.all('SELECT * FROM item_variants WHERE item_id = ?', itemId);
  const keep = new Set();
  b.variants.forEach((v, i) => {
    const match = existing.find((e) => e.name === v.name);
    if (match) { q.run('UPDATE item_variants SET price = ?, sort = ? WHERE id = ?', v.price, i, match.id); keep.add(match.id); }
    else q.run('INSERT INTO item_variants(item_id, name, price, sort) VALUES (?,?,?,?)', itemId, v.name, v.price, i);
  });
  for (const e of existing) if (!keep.has(e.id)) q.run('DELETE FROM item_variants WHERE id = ?', e.id);
  q.run('DELETE FROM item_addons WHERE item_id = ?', itemId);
  for (const a of b.addons) q.run('INSERT INTO item_addons(item_id, name, variant_name, price) VALUES (?,?,?,?)', itemId, a.name, a.variant_name || null, a.price);
  q.run('DELETE FROM item_choices WHERE item_id = ?', itemId);
  let n = 0;
  for (const g of b.choices) for (const o of [...new Set(g.options)]) q.run('INSERT INTO item_choices(item_id, grp, name, sort) VALUES (?,?,?,?)', itemId, g.group, o, n++);
  q.run('UPDATE menu_items SET compare_at = ? WHERE id = ?', b.compare_at || null, itemId);
}

r.post('/items', admin, h((req) => {
  const b = parse(itemSchema, req.body);
  const newId = tx(() => {
    const res = q.run(`INSERT INTO menu_items(category_id, name, description, image, is_veg, spicy, station, available, featured, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, b.category_id, b.name, b.description, b.image, b.is_veg, b.spicy, b.station, b.available, b.featured, b.sort);
    const iid = Number(res.lastInsertRowid);
    saveChildren(iid, b);
    audit(req.user.id, 'menu.create', 'menu_item', iid, { name: b.name });
    return iid;
  });
  broadcast('menu:changed', {});
  return { id: newId };
}));

r.put('/items/:id', admin, h((req) => {
  const iid = parse(id, req.params.id);
  const b = parse(itemSchema, req.body);
  tx(() => {
    q.run(`UPDATE menu_items SET category_id=?, name=?, description=?, image=?, is_veg=?, spicy=?, station=?, available=?, featured=?, sort=? WHERE id=?`,
      b.category_id, b.name, b.description, b.image, b.is_veg, b.spicy, b.station, b.available, b.featured, b.sort, iid);
    saveChildren(iid, b);
    audit(req.user.id, 'menu.update', 'menu_item', iid, { name: b.name, variants: b.variants });
  });
  broadcast('menu:changed', {});
  return { ok: true };
}));

r.delete('/items/:id', admin, h((req) => {
  const iid = parse(id, req.params.id);
  q.run('UPDATE menu_items SET archived = 1, available = 0 WHERE id = ?', iid);
  audit(req.user.id, 'menu.archive', 'menu_item', iid);
  broadcast('menu:changed', {});
  return { ok: true };
}));

// Kitchen and front counter can "86" an item when it runs out
r.patch('/items/:id/availability', requireRole('manager', 'chef', 'cashier'), h((req) => {
  const iid = parse(id, req.params.id);
  const available = !!req.body.available;
  q.run('UPDATE menu_items SET available = ? WHERE id = ?', available ? 1 : 0, iid);
  audit(req.user.id, available ? 'menu.enable' : 'menu.disable', 'menu_item', iid);
  broadcast('menu:changed', { id: iid, available });
  return { ok: true };
}));

r.get('/items/:id/recipe', admin, h((req) => {
  const iid = parse(id, req.params.id);
  return q.all(`SELECT r.id, r.variant_name, r.addon_name, r.ingredient_id, r.qty, i.name AS ingredient, i.unit, i.cost_per_unit
                FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.item_id = ? ORDER BY r.addon_name, r.variant_name, i.name`, iid);
}));

r.put('/items/:id/recipe', admin, h((req) => {
  const iid = parse(id, req.params.id);
  const rows = parse(z.array(z.object({
    ingredient_id: id, qty: z.coerce.number().positive(), variant_name: z.string().optional().nullable(), addon_name: z.string().optional().nullable(),
  })), req.body);
  tx(() => {
    q.run('DELETE FROM recipes WHERE item_id = ?', iid);
    for (const x of rows) q.run('INSERT INTO recipes(item_id, variant_name, addon_name, ingredient_id, qty) VALUES (?,?,?,?,?)', iid, x.variant_name || null, x.addon_name || null, x.ingredient_id, x.qty);
    audit(req.user.id, 'menu.recipe', 'menu_item', iid, { lines: rows.length });
  });
  return { ok: true };
}));

r.post('/upload', admin, h((req) => {
  const { data } = parse(z.object({ data: z.string().max(4_000_000) }), req.body);
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(data);
  if (!m) { const e = new Error('Upload a PNG, JPG or WEBP image'); e.status = 400; throw e; }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${crypto.randomBytes(8).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  return { url: `/uploads/${name}` };
}));

export default r;
