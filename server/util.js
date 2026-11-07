import { z } from 'zod';

/** Wrap a sync route handler: return value is sent as JSON, throws go to the error middleware. */
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join('.');
    const e = new Error(field ? `${field}: ${issue.message}` : issue.message);
    e.status = 400;
    throw e;
  }
  return r.data;
}

export const id = z.coerce.number().int().positive();
export const money = z.coerce.number().min(0).max(10_000_000);
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const phone = z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, 'Enter a valid phone number');

/** Local date helpers (server timezone). */
export function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localDate(d);
}
export function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function range(req, defaultDays = 30) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today(-(defaultDays - 1));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  return { from, to };
}

export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
