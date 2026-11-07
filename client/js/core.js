// FEAST core: templating, routing, API, realtime, UI primitives. Zero dependencies.

/* ---------------- Safe HTML templating ---------------- */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
/** Tagged template: interpolations are escaped unless they are html``/raw() values. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const raw = (s) => new Safe(String(s ?? ''));
export function mount(el, tpl) { el.innerHTML = String(tpl); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Event delegation: on(root, 'click', '[data-act=save]', (e, el) => ...) */
export function on(root, type, selector, fn) {
  const handler = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, handler);
  return () => root.removeEventListener(type, handler);
}

/* ---------------- Icons (inline SVG, stroke-based) ---------------- */
const P = {
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5L20 7"/>', chevron: '<path d="m9 18 6-6-6-6"/>', back: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h3l-3.5 11.5M5.5 17.5 9 10h7M12 6h-2"/>',
  chef: '<path d="M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9V21H6Z"/><path d="M6 17h12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  map: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  store: '<path d="M3 9 4.5 4h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>', home: '<path d="m3 11 9-8 9 8v10H3Z"/><path d="M9 21v-7h6v7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>',
  wallet: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20M16 15h2"/>', chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>', alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7L16 1l-3 2-3-2-3 2Z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>', truck: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.4 1.4 1.4 2.8 2.5 2.8Z"/>',
  whatsapp: '<path d="M3 21l1.7-5.1A8.5 8.5 0 1 1 8 19.6Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .7a3.5 3.5 0 0 1-1.7-1.7l.7-1-1-2Z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>', cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>', table: '<path d="M3 7h18M5 7v13M19 7v13M3 4h18"/>', bag: '<path d="M6 7h12l1 14H5Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  utensils: '<path d="M3 2v7a3 3 0 0 0 3 3v10M6 2v7M9 2v7a3 3 0 0 1-3 3M18 22V2a5 5 0 0 0-3 5v6h3"/>', star: '<path d="m12 2 3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>', refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`);

/* ---------------- Formatting ---------------- */
export const money = (n, cur = 'Rs.') => `${cur} ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
export const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: d, minimumFractionDigits: 0 });
/** Server stores UTC "YYYY-MM-DD HH:MM:SS" */
export const parseDate = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z') : null);
export const fmtTime = (s) => (s ? parseDate(s).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDate = (s) => (s ? parseDate(s).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (s) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');
export const minutesSince = (s) => (s ? (Date.now() - parseDate(s).getTime()) / 60000 : 0);
export function ago(s) {
  const m = Math.floor(minutesSince(s));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m ago`;
  return fmtDate(s);
}
export const clockStr = (mins) => { const t = Math.max(0, Math.floor(mins * 60)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
export const initials = (name = '') => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export const STATUS_LABEL = {
  received: 'New', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
};
export const TYPE_LABEL = { delivery: 'Delivery', takeaway: 'Takeaway', dine_in: 'Dine-in' };
export const TYPE_ICON = { delivery: 'bike', takeaway: 'bag', dine_in: 'utensils' };
export const statusBadge = (s) => html`<span class="badge dot st-${s}">${STATUS_LABEL[s] || s}</span>`;
export const typeBadge = (t) => html`<span class="badge">${icon(TYPE_ICON[t], 'sm')} ${TYPE_LABEL[t]}</span>`;
export const ACTION_LABEL = {
  preparing: 'Start preparing', ready: 'Mark ready', out_for_delivery: 'Dispatch', delivered: 'Mark delivered',
  completed: 'Complete', cancelled: 'Cancel', served: 'Mark served',
};

/* ---------------- Storage ---------------- */
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/* ---------------- Auth & API ---------------- */
export const auth = {
  get token() { return store.get('feast-token'); },
  get user() { return store.get('feast-user'); },
  set(token, user) { store.set('feast-token', token); store.set('feast-user', user); },
  clear() { store.del('feast-token'); store.del('feast-user'); },
  is(...roles) { const u = this.user; return !!u && (u.role === 'admin' || roles.includes(u.role)); },
};
export const ROLE_HOME = { admin: '/admin', manager: '/admin', cashier: '/pos', waiter: '/tables', chef: '/kitchen', rider: '/rider' };

export async function api(path, { method = 'GET', body, raw: rawRes } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Network error. Check your connection.');
  }
  if (rawRes) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth.token && !path.startsWith('/auth/login')) {
    auth.clear();
    toast('Your session expired. Please sign in again.', 'bad');
    navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
export async function download(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) return toast('Export failed', 'bad');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- Realtime (SSE) ---------------- */
const listeners = new Map();
const statusListeners = new Set();
let es = null;
export let liveConnected = false;
function connect() {
  if (es || !auth.token) return;
  es = new EventSource(`/api/events?token=${encodeURIComponent(auth.token)}`);
  const setStatus = (v) => { liveConnected = v; statusListeners.forEach((f) => f(v)); };
  es.onopen = () => setStatus(true);
  es.onerror = () => {
    setStatus(false);
    if (es.readyState === EventSource.CLOSED) { es = null; setTimeout(connect, 4000); }
  };
  for (const type of ['order:new', 'order:updated', 'order:closed', 'stock:low', 'inventory:changed', 'menu:changed', 'rider:location']) {
    es.addEventListener(type, (e) => {
      const data = JSON.parse(e.data);
      (listeners.get(type) || []).forEach((f) => f(data));
      (listeners.get('*') || []).forEach((f) => f(type, data));
    });
  }
}
export function disconnectLive() { es?.close(); es = null; }
/** Subscribe to a staff event; returns an unsubscribe function. */
export function live(type, fn) {
  connect();
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
export function onLiveStatus(fn) { statusListeners.add(fn); fn(liveConnected); return () => statusListeners.delete(fn); }

/** Short "ding" for new orders using WebAudio (no asset needed). */
let audioCtx;
export function ding() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.15); g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.15 + 0.35);
      o.connect(g).connect(audioCtx.destination); o.start(t + i * 0.15); o.stop(t + i * 0.15 + 0.4);
    });
  } catch { /* audio unavailable */ }
}

/* ---------------- Toast / modal / dialogs ---------------- */
export function toast(msg, type = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = String(html`${icon(type === 'bad' ? 'alert' : 'check')}<span>${msg}</span>`);
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, type === 'bad' ? 4500 : 2600);
}

/**
 * Open a modal. `content` is an html`` template or a function (close) => template.
 * Returns { el, close }. `onMount(el, close)` wires behaviour; returning a function registers cleanup.
 */
export function modal({ title, content, foot, wide = false, drawer = false, onMount, onClose }) {
  const ov = document.createElement('div');
  ov.className = `overlay${drawer ? ' drawer' : ''}`;
  let cleanup;
  const close = () => {
    if (!ov.isConnected) return;
    cleanup?.(); onClose?.(); ov.remove(); document.removeEventListener('keydown', key);
    if (!$('.overlay')) document.body.style.overflow = '';
  };
  const key = (e) => { if (e.key === 'Escape' && ov === $$('.overlay').at(-1)) close(); };
  ov.innerHTML = String(html`
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon-only" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${content}</div>
      ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
    </div>`);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  on(ov, 'click', '[data-close]', close);
  document.addEventListener('keydown', key);
  document.body.append(ov);
  document.body.style.overflow = 'hidden';
  const el = $('.modal', ov);
  cleanup = onMount?.(el, close);
  setTimeout(() => $('[autofocus], .modal-body input:not([type=hidden]), .modal-body select', el)?.focus(), 30);
  return { el, close };
}
export function setModalBody(el, tpl) { mount($('.modal-body', el), tpl); }

export function confirmDialog(message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, content: html`<p style="margin:0">${message}</p>`,
      foot: html`<button class="btn" data-close>Go back</button><button class="btn ${danger ? 'primary' : 'ok'}" data-ok>${ok}</button>`,
      onMount: (el, close) => { on(el, 'click', '[data-ok]', () => { done = true; resolve(true); close(); }); },
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function promptDialog({ title, label, placeholder = '', ok = 'Save', required = true, options }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      content: html`<form data-f class="stack"><label class="field"><span>${label}</span>
        ${options ? html`<select class="input" name="v">${options.map((o) => html`<option>${o}</option>`)}</select>`
          : html`<input class="input" name="v" placeholder="${placeholder}" ${required ? raw('required') : ''} autofocus>`}
        </label><button hidden></button></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${ok}</button>`,
      onMount: (el, close) => {
        const submit = (e) => {
          e?.preventDefault();
          const f = $('[data-f]', el);
          if (!f.reportValidity()) return;
          done = true; resolve(f.v.value.trim()); close();
        };
        $('[data-f]', el).addEventListener('submit', submit);
        on(el, 'click', '[data-ok]', submit);
      },
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/** Read a form into an object. Inputs with data-num become numbers; checkboxes become booleans. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.dataset.num !== undefined ? Number(el.value) : el.value; }
    else if (el.dataset.num !== undefined) out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return out;
}

/** Disable a button while an async action runs; toasts errors. */
export async function busy(btn, fn) {
  const prev = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;margin:0;border-width:2px"></span>'; }
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); throw e; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = prev; } }
}
export const quiet = (p) => p.catch(() => {});

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------------- Theme ---------------- */
export function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('feast-theme', next);
}
export const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

/* ---------------- Router ---------------- */
const routes = [];
let current = null;
export function route(pattern, loader, opts = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })}/?$`);
  routes.push({ re, keys, loader, ...opts });
}
export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  resolve();
}
export const query = () => Object.fromEntries(new URLSearchParams(location.search));
export async function resolve() {
  const path = location.pathname;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.roles) {
      const u = auth.user;
      if (!u) return navigate(`/login?next=${encodeURIComponent(path + location.search)}`, { replace: true });
      if (u.role !== 'admin' && !r.roles.includes(u.role)) return navigate(ROLE_HOME[u.role] || '/', { replace: true });
    }
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const mod = await r.loader();
    const root = $('#app');
    if (current?.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    $$('.overlay').forEach((o) => o.remove());
    document.body.style.overflow = '';
    current = { route: r, cleanup: null };
    const token = current;
    try {
      const cleanup = await mod.default(root, params);
      if (token === current) token.cleanup = cleanup; else cleanup?.();
    } catch (e) {
      console.error(e);
      mount(root, html`<div class="empty" style="padding:80px 20px">${icon('alert')}<h2>Something went wrong</h2><p>${e.message}</p><a class="btn" href="/">Go home</a></div>`);
    }
    if (r.title) document.title = `${r.title} · FEAST`;
    return;
  }
  mount($('#app'), html`<div class="empty" style="padding:100px 20px"><h1 class="display" style="font-size:64px">404</h1><p>Page not found.</p><a class="btn primary" href="/">Back to menu</a></div>`);
}
export function startRouter() {
  window.addEventListener('popstate', resolve);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
    e.preventDefault();
    if (href !== location.pathname + location.search) navigate(href);
    window.scrollTo(0, 0);
  });
  resolve();
}

/** Print an html template in a hidden area (used for receipts / KOTs). */
export function printHTML(tpl) {
  let area = $('#print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.append(area); }
  mount(area, tpl);
  setTimeout(() => window.print(), 50);
}

/** Simple interval helper bound to a page lifecycle. */
export function every(ms, fn) { const t = setInterval(fn, ms); return () => clearInterval(t); }
