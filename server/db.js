import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'feast.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  cnic TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','chef','waiter','rider')),
  username TEXT UNIQUE,
  password_hash TEXT,
  pay_type TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly','hourly')),
  base_salary REAL NOT NULL DEFAULT 0,
  hourly_rate REAL NOT NULL DEFAULT 0,
  commission_per_delivery REAL NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (date('now')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  is_veg INTEGER NOT NULL DEFAULT 0,
  spicy INTEGER NOT NULL DEFAULT 0,
  station TEXT NOT NULL DEFAULT 'grill',
  available INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Add-ons can be global for an item (variant_name NULL) or priced per variant (e.g. pizza size)
CREATE TABLE IF NOT EXISTS item_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  variant_name TEXT,
  price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  contact_person TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  cost_per_unit REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  active INTEGER NOT NULL DEFAULT 1
);

-- Bill of materials. A row applies to an item (all variants when variant_name is NULL)
-- or to a specific add-on name of an item.
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  variant_name TEXT,
  addon_name TEXT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  change REAL NOT NULL,
  balance REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('purchase','usage','waste','adjust','return')),
  unit_cost REAL NOT NULL DEFAULT 0,
  ref TEXT,
  note TEXT,
  employee_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','cancelled')),
  total REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  fee REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('delivery','takeaway','dine_in')),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','preparing','ready','out_for_delivery','delivered','completed','cancelled')),
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online','pos','whatsapp','phone')),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  phone TEXT,
  address TEXT,
  zone_id INTEGER REFERENCES delivery_zones(id),
  table_no TEXT,
  subtotal REAL NOT NULL,
  tax REAL NOT NULL DEFAULT 0,
  delivery_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  cogs REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card','wallet')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  notes TEXT,
  cancel_reason TEXT,
  created_by INTEGER REFERENCES employees(id),
  rider_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  preparing_at TEXT,
  ready_at TEXT,
  picked_at TEXT,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES menu_items(id),
  name TEXT NOT NULL,
  variant_name TEXT,
  addons TEXT NOT NULL DEFAULT '[]',
  unit_price REAL NOT NULL,
  qty INTEGER NOT NULL,
  line_total REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  station TEXT NOT NULL DEFAULT 'grill',
  notes TEXT,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  rider_id INTEGER NOT NULL REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','picked_up','delivered','failed')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  picked_at TEXT,
  delivered_at TEXT,
  cash_collected REAL NOT NULL DEFAULT 0,
  commission REAL NOT NULL DEFAULT 0,
  last_lat REAL,
  last_lng REAL,
  location_at TEXT,
  note TEXT
);

-- Central ledger: every completed sale, purchase, expense and payroll payment lands here.
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('sale','refund','purchase','expense','payroll')),
  amount REAL NOT NULL,
  method TEXT,
  order_id INTEGER REFERENCES orders(id),
  ref TEXT,
  description TEXT,
  employee_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  date TEXT NOT NULL DEFAULT (date('now')),
  employee_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  hours REAL NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_emp ON attendance(employee_id, clock_in);

CREATE TABLE IF NOT EXISTS advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  amount REAL NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  note TEXT,
  payroll_id INTEGER REFERENCES payroll(id)
);

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  base_pay REAL NOT NULL DEFAULT 0,
  hours REAL NOT NULL DEFAULT 0,
  hourly_pay REAL NOT NULL DEFAULT 0,
  deliveries INTEGER NOT NULL DEFAULT 0,
  commission REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  advances REAL NOT NULL DEFAULT 0,
  net_pay REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')),
  note TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS item_choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  grp TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','flat')),
  value REAL NOT NULL,
  min_subtotal REAL NOT NULL DEFAULT 0,
  max_discount REAL,
  starts_on TEXT,
  ends_on TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  online_only INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

/* Additive migrations for databases created by earlier versions */
const columns = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!columns('deliveries').includes('settled_at')) {
  db.exec('ALTER TABLE deliveries ADD COLUMN settled_at TEXT; ALTER TABLE deliveries ADD COLUMN settled_by INTEGER REFERENCES employees(id);');
}
if (!columns('orders').includes('promo_code')) db.exec('ALTER TABLE orders ADD COLUMN promo_code TEXT;');
if (!columns('menu_items').includes('compare_at')) db.exec('ALTER TABLE menu_items ADD COLUMN compare_at REAL;');
if (!columns('orders').includes('served_at')) db.exec('ALTER TABLE orders ADD COLUMN served_at TEXT;');
if (!columns('orders').includes('bill_requested_at')) db.exec('ALTER TABLE orders ADD COLUMN bill_requested_at TEXT;');
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_open_table ON orders(type, status, table_no)");

/** Run fn inside a transaction; rolls back on throw. Supports nesting via savepoints. */
let depth = 0;
export function tx(fn) {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  }
}

/** Convert undefined to null and booleans to ints so node:sqlite accepts them. */
function clean(params) {
  if (params == null) return params;
  if (Array.isArray(params)) return params.map(norm);
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = norm(v);
  return out;
}
function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
function args(p) {
  if (p.length === 1 && p[0] && typeof p[0] === 'object' && !Array.isArray(p[0])) return [clean(p[0])];
  return clean(p);
}

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
export const q = {
  all: (sql, ...p) => stmt(sql).all(...args(p)),
  get: (sql, ...p) => stmt(sql).get(...args(p)),
  run: (sql, ...p) => stmt(sql).run(...args(p)),
};

export function getSettings() {
  const rows = q.all('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { s[r.key] = r.value; }
  }
  return s;
}
export function setSetting(key, value) {
  q.run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}

export function audit(employeeId, action, entity, entityId, details) {
  q.run('INSERT INTO audit_log(employee_id,action,entity,entity_id,details) VALUES (?,?,?,?,?)',
    employeeId ?? null, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null);
}

export const isEmpty = () => q.get('SELECT COUNT(*) AS n FROM categories').n === 0;
