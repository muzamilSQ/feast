import { html, raw, icon, money, mount, on, $, $$, api, toast, modal, busy, confirmDialog, promptDialog, formData } from '../core.js';
import { adminShell, pageHead, loading } from '../shared.js';

export default async function menuAdmin(root) {
  const { page, cleanup } = adminShell(root, '/admin/menu');
  let data;
  let ingredients = [];
  mount(page, html`${pageHead('Menu & recipes', 'Prices, sizes, add-ons and the recipe (bill of materials) behind every item. Recipes drive automatic stock deduction and food-cost margins.',
    html`<button class="btn" data-addcat>${icon('plus', 'sm')} Category</button><button class="btn primary" data-additem>${icon('plus', 'sm')} New item</button>`)}<div data-list>${loading()}</div>`);

  const margin = (price, cost) => (price ? Math.round(((price - cost) / price) * 100) : 0);
  const marginBadge = (m) => html`<span class="badge ${m >= 65 ? 'ok' : m >= 50 ? 'warn' : 'bad'}">${m}%</span>`;

  const load = async () => {
    [data, ingredients] = await Promise.all([api('/menu'), api('/inventory/ingredients')]);
    mount($('[data-list]', page), html`${data.categories.map((c) => html`<div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3>${c.name} <span class="muted small">· ${c.items.length} items</span></h3><div class="row"><button class="btn sm ghost" data-editcat="${c.id}">${icon('edit', 'sm')} Rename</button>${c.items.length ? '' : html`<button class="btn sm ghost danger" data-delcat="${c.id}">${icon('trash', 'sm')}</button>`}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th style="width:56px"></th><th>Item</th><th>Prices · food cost · margin</th><th>Station</th><th>Recipe</th><th>On sale</th><th></th></tr></thead><tbody>
      ${c.items.map((i) => html`<tr>
        <td>${i.image ? html`<img src="${i.image}" alt="" style="width:48px;height:48px;border-radius:9px;object-fit:cover">` : ''}</td>
        <td><b>${i.name}</b> ${i.featured ? html`<span class="badge brand">Popular</span>` : ''}<div class="tiny muted" style="max-width:260px">${i.description}</div></td>
        <td class="small">${i.variants.map((v) => html`<div class="row" style="gap:6px;padding:2px 0"><span style="min-width:86px">${v.name}</span><b class="num">${money(v.price)}</b><span class="muted num">cost ${money(v.cost)}</span>${i.recipe_count ? marginBadge(margin(v.price, v.cost)) : ''}</div>`)}
          ${i.addons.length ? html`<div class="tiny muted">${new Set(i.addons.map((a) => a.name)).size} add-on(s)</div>` : ''}</td>
        <td><span class="badge">${i.station}</span></td>
        <td>${i.recipe_count ? html`<button class="btn sm" data-recipe="${i.id}">${icon('list', 'sm')} ${i.recipe_count} lines</button>` : html`<button class="btn sm danger" data-recipe="${i.id}">${icon('alert', 'sm')} Add recipe</button>`}</td>
        <td><label class="check"><input type="checkbox" data-avail="${i.id}" ${i.available ? 'checked' : ''}></label></td>
        <td class="right"><button class="btn sm ghost" data-edit="${i.id}">${icon('edit', 'sm')}</button><button class="btn sm ghost danger" data-archive="${i.id}" title="Archive">${icon('trash', 'sm')}</button></td></tr>`)}
      </tbody></table></div></div>`)}`);
  };
  await load();
  const findItem = (id) => data.categories.flatMap((c) => c.items).find((i) => i.id === id);

  /* ---------- Item editor ---------- */
  function editItem(item) {
    const it = item ? structuredClone(item) : { category_id: data.categories[0]?.id, name: '', description: '', image: '', is_veg: false, spicy: 0, station: 'grill', available: true, featured: false, sort: 0, variants: [{ name: 'Regular', price: 0 }], addons: [], choices: [], compare_at: null };
    it.choices ||= [];
    const vRow = (v) => html`<div class="row" data-vrow style="margin-bottom:6px"><input class="input sm" name="vname" value="${v.name}" placeholder="e.g. Large" required><input class="input sm" name="vprice" type="number" min="0" step="1" value="${v.price}" placeholder="Price" style="width:120px" required><button type="button" class="btn sm ghost danger" data-rm>${icon('x', 'sm')}</button></div>`;
    const aRow = (a) => html`<div class="row" data-arow style="margin-bottom:6px"><input class="input sm" name="aname" value="${a.name}" placeholder="Add-on name" required><input class="input sm" name="aprice" type="number" min="0" step="1" value="${a.price}" style="width:100px" required>
      <select class="input sm" name="avar" style="width:150px"><option value="">All sizes</option>${it.variants.map((v) => html`<option ${a.variant_name === v.name ? raw('selected') : ''}>${v.name}</option>`)}</select><button type="button" class="btn sm ghost danger" data-rm>${icon('x', 'sm')}</button></div>`;
    const cRow = (c) => html`<div class="row" data-crow style="margin-bottom:6px"><input class="input sm" name="cgroup" value="${c.group}" placeholder="e.g. Flavour" style="width:140px" required><input class="input sm" name="copts" value="${c.options.join(', ')}" placeholder="Pepsi, 7Up, Mirinda" required><button type="button" class="btn sm ghost danger" data-rm>${icon('x', 'sm')}</button></div>`;
    modal({
      title: item ? `Edit ${item.name}` : 'New menu item', wide: true,
      content: html`<form class="stack" data-f>
        <div class="grid g2">
          <label class="field"><span>Name</span><input class="input" name="name" value="${it.name}" required></label>
          <label class="field"><span>Category</span><select class="input" name="category_id" data-num>${data.categories.map((c) => html`<option value="${c.id}" ${c.id === it.category_id ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
        </div>
        <label class="field"><span>Description</span><textarea class="input" name="description" maxlength="300">${it.description}</textarea></label>
        <div class="grid g4">
          <label class="field"><span>Kitchen station</span><select class="input" name="station">${data.stations.map((s) => html`<option ${s === it.station ? raw('selected') : ''}>${s}</option>`)}</select></label>
          <label class="field"><span>Spice level</span><select class="input" name="spicy" data-num>${[0, 1, 2, 3].map((n) => html`<option value="${n}" ${n === it.spicy ? raw('selected') : ''}>${n ? '🌶'.repeat(n) : 'None'}</option>`)}</select></label>
          <label class="field"><span>Sort order</span><input class="input" type="number" name="sort" data-num value="${it.sort}"></label>
          <div class="field"><span>Flags</span><div class="row wrap"><label class="check"><input type="checkbox" name="is_veg" ${it.is_veg ? raw('checked') : ''}> Veg</label><label class="check"><input type="checkbox" name="featured" ${it.featured ? raw('checked') : ''}> Popular</label><label class="check"><input type="checkbox" name="available" ${it.available ? raw('checked') : ''}> On sale</label></div></div>
        </div>
        <div class="field"><span>Photo</span><div class="row"><img data-preview src="${it.image || '/favicon.svg'}" alt="" style="width:64px;height:64px;border-radius:10px;object-fit:cover"><input class="input" name="image" value="${it.image || ''}" placeholder="/img/menu/... or upload"><label class="btn">${icon('upload', 'sm')} Upload<input type="file" accept="image/png,image/jpeg,image/webp" data-upload hidden></label></div></div>
        <div class="grid g2">
          <div><h4 style="margin-bottom:8px">Sizes / options & prices</h4><div data-vlist>${it.variants.map(vRow)}</div><button type="button" class="btn sm" data-addv>${icon('plus', 'sm')} Option</button></div>
          <div><h4 style="margin-bottom:8px">Add-ons</h4><div data-alist>${it.addons.map(aRow)}</div><button type="button" class="btn sm" data-adda>${icon('plus', 'sm')} Add-on</button></div>
        </div>
        <div class="grid g2">
          <div><h4 style="margin-bottom:2px">Required choices</h4><p class="tiny muted" style="margin:0 0 8px">Customer must pick one from each group, e.g. drink flavour or the pizza in a deal. Separate options with commas. No price change.</p>
            <div data-clist>${it.choices.map(cRow)}</div><button type="button" class="btn sm" data-addc>${icon('plus', 'sm')} Choice group</button></div>
          <label class="field"><span>Regular value (Rs., for deals)</span><input class="input" type="number" min="0" name="compare_at" data-num value="${it.compare_at ?? ''}" placeholder="e.g. 610"><span class="tiny muted" style="font-weight:400">If higher than the price, the menu shows it crossed out with "Save Rs. X".</span></label>
        </div></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save item</button>`,
      onMount: (el, close) => {
        const f = $('[data-f]', el);
        const offs = [
          on(el, 'click', '[data-rm]', (_e, b) => b.parentElement.remove()),
          on(el, 'click', '[data-addv]', () => $('[data-vlist]', el).insertAdjacentHTML('beforeend', String(vRow({ name: '', price: '' })))),
          on(el, 'click', '[data-addc]', () => $('[data-clist]', el).insertAdjacentHTML('beforeend', String(cRow({ group: '', options: [] })))),
          on(el, 'click', '[data-adda]', () => $('[data-alist]', el).insertAdjacentHTML('beforeend', String(aRow({ name: '', price: '' })))),
          on(el, 'input', '[name=image]', (_e, i) => { $('[data-preview]', el).src = i.value || '/favicon.svg'; }),
          on(el, 'change', '[data-upload]', async (_e, input) => {
            const file = input.files[0];
            if (!file) return;
            if (file.size > 2.5e6) return toast('Image must be under 2.5 MB', 'bad');
            const dataUrl = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(file); });
            try { const { url } = await api('/menu/upload', { method: 'POST', body: { data: dataUrl } }); f.image.value = url; $('[data-preview]', el).src = url; toast('Photo uploaded', 'ok'); } catch (e) { toast(e.message, 'bad'); }
          }),
          on(el, 'click', '[data-save]', async (_e, btn) => {
            if (!f.reportValidity()) return;
            const base = formData(f);
            const body = {
              category_id: base.category_id, name: base.name, description: base.description || '', image: base.image, station: base.station, spicy: base.spicy, sort: base.sort || 0,
              is_veg: base.is_veg, featured: base.featured, available: base.available,
              variants: $$('[data-vrow]', el).map((r) => ({ name: $('[name=vname]', r).value.trim(), price: Number($('[name=vprice]', r).value) })),
              addons: $$('[data-arow]', el).map((r) => ({ name: $('[name=aname]', r).value.trim(), price: Number($('[name=aprice]', r).value), variant_name: $('[name=avar]', r).value || null })),
              choices: $$('[data-crow]', el).map((r) => ({ group: $('[name=cgroup]', r).value.trim(), options: $('[name=copts]', r).value.split(',').map((x) => x.trim()).filter(Boolean) })),
              compare_at: base.compare_at || null,
            };
            try {
              await busy(btn, () => api(item ? `/menu/items/${item.id}` : '/menu/items', { method: item ? 'PUT' : 'POST', body }));
              toast('Menu updated', 'ok'); close(); load();
            } catch { /* toasted */ }
          }),
        ];
        return () => offs.forEach((x) => x());
      },
    });
  }

  /* ---------- Recipe (BOM) editor ---------- */
  async function editRecipe(item) {
    const rows = await api(`/menu/items/${item.id}/recipe`);
    const addonNames = [...new Set(item.addons.map((a) => a.name))];
    const ingOpts = (sel) => ingredients.map((g) => html`<option value="${g.id}" ${g.id === sel ? raw('selected') : ''}>${g.name} (${g.unit})</option>`);
    const row = (r = {}) => html`<tr data-r>
      <td><select class="input sm" name="ingredient_id">${ingOpts(r.ingredient_id)}</select></td>
      <td><input class="input sm" name="qty" type="number" step="0.001" min="0.001" value="${r.qty ?? ''}" style="width:100px" required></td>
      <td><select class="input sm" name="variant_name"><option value="">All sizes</option>${item.variants.map((v) => html`<option ${r.variant_name === v.name ? raw('selected') : ''}>${v.name}</option>`)}</select></td>
      <td><select class="input sm" name="addon_name"><option value="">Base item</option>${addonNames.map((a) => html`<option ${r.addon_name === a ? raw('selected') : ''}>${a}</option>`)}</select></td>
      <td class="num small" data-cost></td><td><button class="btn sm ghost danger" data-rm>${icon('x', 'sm')}</button></td></tr>`;
    modal({
      title: `Recipe · ${item.name}`, wide: true,
      content: html`<p class="muted" style="margin-top:0">Quantities per <b>one</b> portion in the ingredient's stock unit. Rows scoped to a size only apply to that size; add-on rows only apply when the add-on is chosen.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Ingredient</th><th>Qty</th><th>Applies to size</th><th>Applies to</th><th class="num">Cost</th><th></th></tr></thead><tbody data-rows>${rows.map(row)}</tbody></table></div>
        <button class="btn sm" data-addr style="margin-top:8px">${icon('plus', 'sm')} Ingredient</button>
        <div class="card card-pad" style="margin-top:14px;box-shadow:none;background:var(--surface-2)"><h4 style="margin-bottom:8px">Food cost per portion (base item)</h4><div data-summary></div></div>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save recipe</button>`,
      onMount: (el, close) => {
        const read = () => $$('[data-r]', el).map((r) => ({ ingredient_id: Number($('[name=ingredient_id]', r).value), qty: Number($('[name=qty]', r).value), variant_name: $('[name=variant_name]', r).value || null, addon_name: $('[name=addon_name]', r).value || null, el: r }));
        const recalc = () => {
          const lines = read();
          for (const l of lines) { const g = ingredients.find((x) => x.id === l.ingredient_id); $('[data-cost]', l.el).textContent = g && l.qty ? money(g.cost_per_unit * l.qty) : '—'; }
          mount($('[data-summary]', el), html`<table class="table"><tbody>${item.variants.map((v) => {
            const cost = lines.filter((l) => !l.addon_name && (!l.variant_name || l.variant_name === v.name)).reduce((s, l) => s + (ingredients.find((g) => g.id === l.ingredient_id)?.cost_per_unit || 0) * (l.qty || 0), 0);
            const m = v.price ? Math.round(((v.price - cost) / v.price) * 100) : 0;
            return html`<tr><td>${v.name}</td><td class="num">Price ${money(v.price)}</td><td class="num">Cost <b>${money(cost)}</b></td><td class="num"><span class="badge ${m >= 65 ? 'ok' : m >= 50 ? 'warn' : 'bad'}">${m}% margin</span></td></tr>`;
          })}</tbody></table>`);
        };
        recalc();
        const offs = [
          on(el, 'click', '[data-addr]', () => { $('[data-rows]', el).insertAdjacentHTML('beforeend', String(row())); recalc(); }),
          on(el, 'click', '[data-rm]', (_e, b) => { b.closest('tr').remove(); recalc(); }),
          on(el, 'input', 'input, select', recalc),
          on(el, 'change', 'select', recalc),
          on(el, 'click', '[data-save]', async (_e, btn) => {
            const lines = read();
            if (lines.some((l) => !(l.qty > 0))) return toast('Every row needs a quantity', 'bad');
            try { await busy(btn, () => api(`/menu/items/${item.id}/recipe`, { method: 'PUT', body: lines.map(({ el: _x, ...l }) => l) })); toast('Recipe saved', 'ok'); close(); load(); } catch { /* toasted */ }
          }),
        ];
        return () => offs.forEach((x) => x());
      },
    });
  }

  const offs = [
    cleanup,
    on(page, 'click', '[data-additem]', () => editItem(null)),
    on(page, 'click', '[data-edit]', (_e, b) => editItem(findItem(Number(b.dataset.edit)))),
    on(page, 'click', '[data-recipe]', (_e, b) => editRecipe(findItem(Number(b.dataset.recipe)))),
    on(page, 'change', '[data-avail]', async (_e, cb) => {
      try { await api(`/menu/items/${cb.dataset.avail}/availability`, { method: 'PATCH', body: { available: cb.checked } }); toast(cb.checked ? 'Item on sale' : 'Item hidden from menu', 'ok'); } catch (e) { cb.checked = !cb.checked; toast(e.message, 'bad'); }
    }),
    on(page, 'click', '[data-archive]', async (_e, b) => {
      const it = findItem(Number(b.dataset.archive));
      if (!(await confirmDialog(`Archive "${it.name}"? It will be removed from the menu but kept in sales history.`, { ok: 'Archive', danger: true }))) return;
      await api(`/menu/items/${it.id}`, { method: 'DELETE' }); toast('Item archived'); load();
    }),
    on(page, 'click', '[data-addcat]', async () => {
      const name = await promptDialog({ title: 'New category', label: 'Name', ok: 'Create' });
      if (name) { try { await api('/menu/categories', { method: 'POST', body: { name, sort: data.categories.length } }); load(); } catch (e) { toast(e.message, 'bad'); } }
    }),
    on(page, 'click', '[data-editcat]', async (_e, b) => {
      const c = data.categories.find((x) => x.id === Number(b.dataset.editcat));
      const name = await promptDialog({ title: 'Rename category', label: 'Name', ok: 'Save' });
      if (name) { await api(`/menu/categories/${c.id}`, { method: 'PUT', body: { name, sort: c.sort } }); load(); }
    }),
    on(page, 'click', '[data-delcat]', async (_e, b) => {
      if (!(await confirmDialog('Delete this empty category?', { ok: 'Delete', danger: true }))) return;
      try { await api(`/menu/categories/${b.dataset.delcat}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'bad'); }
    }),
  ];
  return () => offs.forEach((x) => x());
}
