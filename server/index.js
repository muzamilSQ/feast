import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { q, isEmpty, audit } from './db.js';
import { authenticate, requireRole, verifyPassword, createSession, destroySession, ROLE_HOME } from './auth.js';
import { subscribeStaff } from './realtime.js';
import { h, parse } from './util.js';
import publicRoutes from './routes/public.js';
import orderRoutes, { rider } from './routes/orders.js';
import menuRoutes from './routes/menu.js';
import inventoryRoutes from './routes/inventory.js';
import staffRoutes from './routes/staff.js';
import reportRoutes, { settings } from './routes/reports.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);

if (isEmpty()) {
  console.log('Empty database - seeding FEAST menu, inventory and demo staff...');
  seed({ demo: true });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(authenticate);

// Basic in-memory rate limit for login and public order placement
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
    next();
  };
}

app.post('/api/auth/login', limit(10, 60_000), h((req, res) => {
  const b = parse(z.object({ username: z.string().trim().toLowerCase().min(1), password: z.string().min(1) }), req.body);
  const emp = q.get('SELECT * FROM employees WHERE username = ? AND active = 1', b.username);
  if (!emp || !verifyPassword(b.password, emp.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  const token = createSession(emp.id);
  audit(emp.id, 'auth.login', 'employee', emp.id);
  return { token, user: { id: emp.id, name: emp.name, role: emp.role, username: emp.username }, home: ROLE_HOME[emp.role] };
}));
app.post('/api/auth/logout', h((req) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (t) destroySession(t);
  return { ok: true };
}));
app.get('/api/auth/me', requireRole(), h((req) => ({ user: req.user, home: ROLE_HOME[req.user.role] })));

app.get('/api/events', requireRole(), (req, res) => subscribeStaff(req, res));

app.post('/api/public/orders', limit(8, 60_000));
app.use('/api/public', publicRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/rider', rider);
app.use('/api/menu', menuRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settings);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Static assets: menu images, uploads, favicon (public/) and the frontend app (client/)
const prod = process.env.NODE_ENV === 'production';
const staticOpts = (maxAge) => ({ maxAge: prod ? maxAge : 0, index: false });
app.use(express.static(path.join(__dirname, '..', 'public'), staticOpts('7d')));
app.use(express.static(path.join(__dirname, '..', 'client'), staticOpts('1h')));
// SPA fallback: every non-API route renders the app shell
const shell = path.join(__dirname, '..', 'client', 'index.html');
app.get('*', (req, res, next) => (path.extname(req.path) ? next() : res.sendFile(shell)));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
});

app.listen(PORT, () => {
  console.log(`FEAST Restaurant OS API listening on http://localhost:${PORT}`);
});
