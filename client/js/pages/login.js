import { html, icon, mount, $, api, auth, navigate, query, ROLE_HOME } from '../core.js';

export default async function login(root) {
  if (auth.user) return navigate(query().next || ROLE_HOME[auth.user.role], { replace: true });
  mount(root, html`<div class="login">
    <div class="art"></div>
    <div class="form-side"><form class="stack" data-f>
      <a class="logo" href="/" style="margin-bottom:8px"><span class="mark display" style="color:var(--ink);font-size:44px">FE<b style="color:var(--brand)">A</b>ST</span></a>
      <div><h1 style="font-size:24px">Staff sign in</h1><p class="muted" style="margin:4px 0 0">POS, kitchen, delivery and back-office.</p></div>
      <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" required autofocus autocapitalize="none"></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="error-text" data-err role="alert"></div>
      <button class="btn primary lg block" data-btn>${icon('shield')} Sign in</button>
      <details class="small muted"><summary>Demo accounts</summary>
        <div style="margin-top:8px;line-height:1.8">admin / admin123 · manager / manager123<br>cashier / cashier123 · chef / chef123<br>rider1 / rider123 · waiter / waiter123</div></details>
      <a href="/" class="small muted">← Back to online menu</a>
    </form></div></div>`);
  $('[data-f]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('[data-btn]', root);
    btn.disabled = true;
    $('[data-err]', root).textContent = '';
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      auth.set(r.token, r.user);
      const next = query().next;
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : r.home, { replace: true });
    } catch (err) {
      $('[data-err]', root).textContent = err.message;
      btn.disabled = false;
    }
  });
}
