import crypto from 'node:crypto';
import { q } from './db.js';

const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

export function createSession(employeeId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run(`INSERT INTO sessions(token, employee_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`, token, employeeId);
  q.run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
  return token;
}

export function destroySession(token) {
  q.run('DELETE FROM sessions WHERE token = ?', token);
}

export function userFromToken(token) {
  if (!token) return null;
  return q.get(`
    SELECT e.id, e.name, e.role, e.username, e.phone FROM sessions s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND e.active = 1`, token) || null;
}

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.token || null;
}

/** Attaches req.user when a valid token is present. */
export function authenticate(req, _res, next) {
  req.user = userFromToken(tokenFrom(req));
  next();
}

/** Role guard. Admin is always allowed. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in' });
    if (req.user.role === 'admin' || roles.length === 0 || roles.includes(req.user.role)) return next();
    res.status(403).json({ error: 'You do not have access to this area' });
  };
}

export const ROLE_HOME = {
  admin: '/admin', manager: '/admin', cashier: '/pos', waiter: '/tables', chef: '/kitchen', rider: '/rider',
};
