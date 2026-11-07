import { db, q, tx, setSetting } from './db.js';
import { hashPassword } from './auth.js';
import { priceCart } from './services/orders.js';
import { fileURLToPath } from 'node:url';

const SIZES = ['7" Small', '11" Medium', '14" Large', '16" XL'];
const SIZE_F = [0.4, 1, 1.55, 2.1]; // relative ingredient usage per pizza size

const INGREDIENTS = [
  // name, unit, cost/unit (Rs), stock, reorder
  ['Burger Bun', 'pcs', 25, 240, 60],
  ['Chicken Fillet', 'kg', 950, 32, 10],
  ['Chicken Boneless', 'kg', 900, 40, 12],
  ['Chicken Wings', 'kg', 700, 18, 8],
  ['Chicken Pieces (bone-in)', 'kg', 650, 25, 10],
  ['Beef Kebab Mince', 'kg', 1400, 9, 4],
  ['Beef Pepperoni', 'kg', 2800, 2.5, 3],
  ['Breading Mix', 'kg', 400, 20, 6],
  ['Cooking Oil', 'L', 550, 60, 20],
  ['Mozzarella Cheese', 'kg', 1800, 22, 8],
  ['Cheese Slice', 'pcs', 30, 180, 50],
  ['Iceberg Lettuce', 'kg', 400, 4, 2],
  ['Tomato', 'kg', 150, 10, 4],
  ['Onion', 'kg', 120, 15, 5],
  ['Capsicum', 'kg', 300, 6, 3],
  ['Black Olives', 'kg', 1600, 3, 1],
  ['Pizza Dough', 'kg', 180, 30, 10],
  ['Pizza Sauce', 'kg', 500, 12, 4],
  ['Signature Sauce', 'kg', 700, 14, 5],
  ['Wing Glaze', 'kg', 900, 6, 2],
  ['Tortilla', 'pcs', 35, 150, 40],
  ['Paratha', 'pcs', 30, 30, 40],
  ['Frozen Fries', 'kg', 380, 45, 15],
  ['Chicken Nuggets', 'pcs', 18, 320, 80],
  ['Takeaway Box', 'pcs', 20, 600, 150],
  ['Pizza Box', 'pcs', 45, 260, 80],
  ['Water 500ml', 'pcs', 40, 96, 24],
  ['Cold Drink 345ml', 'pcs', 70, 120, 36],
  ['Cold Drink 500ml', 'pcs', 100, 96, 24],
  ['Cold Drink 1L', 'pcs', 130, 48, 12],
  ['Cold Drink 1.5L', 'pcs', 165, 10, 12],
];

const SUPPLIERS = [
  ['Al-Madina Poultry', '0300-1112233', 'Haji Rafiq', 'Main Bazaar'],
  ['Fresh Farms Vegetables', '0301-4445566', 'Naveed', 'Sabzi Mandi'],
  ['Metro Cash & Carry', '0302-7778899', 'Accounts Desk', 'Ring Road'],
  ['City Beverages', '0303-1212121', 'Shahid', 'Industrial Area'],
];
const SUPPLIER_OF = (name) => {
  if (/Chicken|Beef/.test(name)) return 1;
  if (/Lettuce|Tomato|Onion|Capsicum/.test(name)) return 2;
  if (/Drink|Water/.test(name)) return 4;
  return 3;
};

// Menu straight from the FEAST brochure
const DRINKS = ['Pepsi', '7Up', 'Mirinda'];

// Combo deals: contents are [item name, variant name|null, qty]; recipe = sum of the contents' recipes
const DEALS = [
  { name: 'Zinger Meal', desc: 'Zinger Master + regular fries + 345ml drink.', img: 'burger-zinger', station: 'grill', price: 549, featured: 1,
    parts: [['Zinger Master', null, 1], ['Plain Fries', 'Regular', 1], ['Cold Drink', '345ml', 1]], choices: { Drink: DRINKS } },
  { name: 'Burger Duo', desc: '2 chicken burgers + regular fries + two 345ml drinks.', img: 'burger-chicken', station: 'grill', price: 849,
    parts: [['Chicken Burger', null, 2], ['Plain Fries', 'Regular', 1], ['Cold Drink', '345ml', 2]], choices: { Drinks: DRINKS } },
  { name: 'Wrap Combo', desc: 'Afghani Wrap + regular fries + 345ml drink.', img: 'wrap-afghani', station: 'wraps', price: 579,
    parts: [['Afghani Wrap', null, 1], ['Plain Fries', 'Regular', 1], ['Cold Drink', '345ml', 1]], choices: { Drink: DRINKS } },
  { name: 'Pizza Night', desc: '14" large pizza + 3 Smoky BBQ wings + 1 litre drink.', img: 'pizza', station: 'pizza', price: 1799, featured: 1,
    parts: [['Chicken Tikka', '14" Large', 1], ['Smoky BBQ Wings', '3 pcs', 1], ['Cold Drink', '1 Litre', 1]],
    choices: { Pizza: ['Chicken Tikka', 'Chicken Fajita', 'Beef Pepperoni', 'Beef Kebab'], Drink: DRINKS } },
  { name: 'Family Bucket Deal', desc: '9-piece chicken bucket + large fries + 1.5 litre drink.', img: 'chicken', station: 'fryer', price: 2099, featured: 1,
    parts: [['Chicken Bucket', '9 pcs', 1], ['Plain Fries', 'Large', 1], ['Cold Drink', '1.5 Litre', 1]], choices: { Drink: DRINKS } },
];

const MENU = [
  { cat: 'Burgers', items: [
    { name: 'Chicken Burger', desc: 'Juicy chicken patty with our signature burger sauce in a soft, fresh bun.', img: 'burger-chicken', station: 'grill', variants: [['Regular', 300]], featured: 1,
      addons: [['Cheese Slice', 45], ['Iceberg Lettuce', 45]], recipe: { 'Burger Bun': 1, 'Chicken Fillet': 0.11, 'Breading Mix': 0.03, 'Cooking Oil': 0.04, 'Iceberg Lettuce': 0.015, 'Signature Sauce': 0.02, 'Takeaway Box': 1 } },
    { name: 'Zinger Master', desc: 'Crispy & spicy Zinger chicken fillet with our signature burger sauce in a soft, fresh bun.', img: 'burger-zinger', station: 'grill', spicy: 2, variants: [['Regular', 360]], featured: 1,
      addons: [['Cheese Slice', 45], ['Iceberg Lettuce', 45]], recipe: { 'Burger Bun': 1, 'Chicken Fillet': 0.14, 'Breading Mix': 0.04, 'Cooking Oil': 0.05, 'Iceberg Lettuce': 0.015, 'Signature Sauce': 0.025, 'Takeaway Box': 1 } },
    { name: 'Hunger Buster', desc: 'The ultimate comfort chicken patty: large fillet with our signature sauce in a fresh bun.', img: 'burger-hunger', station: 'grill', spicy: 1, variants: [['Regular', 600]], featured: 1,
      addons: [['Cheese Slice', 45], ['Iceberg Lettuce', 45]], recipe: { 'Burger Bun': 1, 'Chicken Fillet': 0.26, 'Breading Mix': 0.06, 'Cooking Oil': 0.08, 'Iceberg Lettuce': 0.02, 'Cheese Slice': 1, 'Signature Sauce': 0.04, 'Takeaway Box': 1 } },
  ] },
  { cat: 'Wraps', items: [
    { name: 'Tortilla Wrap Zinger Chicken', desc: 'Crispy Zinger chicken with fresh veggies & signature sauce in a soft tortilla.', img: 'wrap', station: 'wraps', spicy: 2, variants: [['Regular', 400]],
      recipe: { Tortilla: 1, 'Chicken Fillet': 0.13, 'Breading Mix': 0.03, 'Cooking Oil': 0.04, Onion: 0.02, 'Iceberg Lettuce': 0.015, 'Signature Sauce': 0.03, 'Takeaway Box': 1 } },
    { name: 'Tortilla Wrap Fajita Chicken', desc: 'Flavorful fajita chicken with fresh veggies & signature sauce in a soft tortilla.', img: 'wrap', station: 'wraps', spicy: 1, variants: [['Regular', 340]],
      recipe: { Tortilla: 1, 'Chicken Boneless': 0.12, Onion: 0.02, Capsicum: 0.02, 'Signature Sauce': 0.03, 'Takeaway Box': 1 } },
    { name: 'Paratha Wrap Zinger Chicken', desc: 'Crispy Zinger chicken with fresh veggies & signature sauce in a flaky paratha.', img: 'wrap-paratha', station: 'wraps', spicy: 2, variants: [['Regular', 400]],
      recipe: { Paratha: 1, 'Chicken Fillet': 0.13, 'Breading Mix': 0.03, 'Cooking Oil': 0.05, Onion: 0.02, 'Signature Sauce': 0.03, 'Takeaway Box': 1 } },
    { name: 'Paratha Wrap Fajita Chicken', desc: 'Flavorful fajita chicken with fresh veggies & signature sauce in a flaky paratha.', img: 'wrap-paratha', station: 'wraps', spicy: 1, variants: [['Regular', 340]],
      recipe: { Paratha: 1, 'Chicken Boneless': 0.12, Onion: 0.02, Capsicum: 0.02, 'Signature Sauce': 0.03, 'Cooking Oil': 0.01, 'Takeaway Box': 1 } },
    { name: 'Afghani Wrap', desc: 'Afghani chicken, a fusion of fries & our signature secret sauce in a soft tortilla.', img: 'wrap-afghani', station: 'wraps', variants: [['Regular', 400]], featured: 1,
      recipe: { Tortilla: 1, 'Chicken Boneless': 0.13, 'Frozen Fries': 0.07, 'Cooking Oil': 0.02, 'Signature Sauce': 0.035, 'Takeaway Box': 1 } },
    { name: 'Afghani Wrap L', desc: 'Afghani chicken, 2 sausages, fries & our signature secret sauce in a soft tortilla.', img: 'wrap-afghani', station: 'wraps', variants: [['Large', 600]],
      recipe: { Tortilla: 1, 'Chicken Boneless': 0.22, 'Frozen Fries': 0.12, 'Cooking Oil': 0.03, 'Signature Sauce': 0.05, 'Takeaway Box': 1 } },
  ] },
  { cat: 'Pizza', pizza: true, items: [
    { name: 'Chicken Tikka', desc: 'Smoky tikka chicken, onions and mozzarella on our house sauce.', prices: [550, 1100, 1500, 2000], protein: 'Chicken Boneless', spicy: 1, featured: 1 },
    { name: 'Chicken Fajita', desc: 'Fajita chicken, capsicum, onion and mozzarella.', prices: [550, 1100, 1500, 2000], protein: 'Chicken Boneless' },
    { name: 'Beef Pepperoni', desc: 'Classic beef pepperoni with stretchy mozzarella.', prices: [550, 1100, 1500, 2000], protein: 'Beef Pepperoni' },
    { name: 'Beef Kebab', desc: 'Seekh kebab chunks, onions and mozzarella.', prices: [550, 1100, 1500, 2000], protein: 'Beef Kebab Mince', spicy: 1 },
    { name: 'Feast Supreme', desc: 'Special flavor: loaded with chicken, olives, veggies and double cheese.', prices: [600, 1200, 1650, 2200], protein: 'Chicken Boneless', featured: 1 },
    { name: 'Crown Crust', desc: 'Special flavor: kebab-stuffed crown crust with chicken and mozzarella.', prices: [600, 1200, 1650, 2200], protein: 'Chicken Boneless', featured: 1 },
  ] },
  { cat: 'Wings', items: ['Garlic Parmesan', 'Smoky BBQ', 'Crispy Krispo', 'Buffalo', 'Baked'].map((f) => ({
    name: `${f} Wings`, desc: `Juicy chicken wings tossed in ${f === 'Baked' ? 'herbs and oven baked' : f.toLowerCase() + ' flavor'}.`, img: 'wings', station: 'fryer',
    spicy: f === 'Buffalo' ? 3 : f === 'Crispy Krispo' ? 1 : 0, variants: [['3 pcs', 400], ['10 pcs', 800]], featured: f === 'Smoky BBQ' ? 1 : 0,
    recipeV: {
      '3 pcs': { 'Chicken Wings': 0.15, 'Wing Glaze': 0.03, ...(f === 'Baked' ? {} : { 'Cooking Oil': 0.04 }), 'Takeaway Box': 1 },
      '10 pcs': { 'Chicken Wings': 0.5, 'Wing Glaze': 0.08, ...(f === 'Baked' ? {} : { 'Cooking Oil': 0.1 }), 'Takeaway Box': 1 },
    },
  })) },
  { cat: 'Sides & Snacks', items: [
    { name: 'Crispy Piece', desc: 'One piece of our golden, crispy fried chicken.', img: 'chicken', station: 'fryer', variants: [['1 pc', 265]],
      recipe: { 'Chicken Pieces (bone-in)': 0.15, 'Breading Mix': 0.03, 'Cooking Oil': 0.05 } },
    { name: 'Hot Shots', desc: 'Ten spicy bite-size boneless chicken shots.', img: 'chicken', station: 'fryer', spicy: 2, variants: [['10 pcs', 525]],
      recipe: { 'Chicken Boneless': 0.2, 'Breading Mix': 0.05, 'Cooking Oil': 0.07, 'Takeaway Box': 1 } },
    { name: 'Chicken Nuggets', desc: 'Eight golden chicken nuggets.', img: 'chicken', station: 'fryer', variants: [['8 pcs', 210]],
      recipe: { 'Chicken Nuggets': 8, 'Cooking Oil': 0.04, 'Takeaway Box': 1 } },
    { name: 'Chicken Bucket', desc: 'Crispy fried chicken pieces for sharing.', img: 'chicken', station: 'fryer', variants: [['6 pcs', 1400], ['9 pcs', 1925]], featured: 1,
      recipeV: { '6 pcs': { 'Chicken Pieces (bone-in)': 0.9, 'Breading Mix': 0.15, 'Cooking Oil': 0.25, 'Takeaway Box': 1 },
        '9 pcs': { 'Chicken Pieces (bone-in)': 1.35, 'Breading Mix': 0.22, 'Cooking Oil': 0.35, 'Takeaway Box': 1 } } },
    { name: 'Plain Fries', desc: 'Golden, crispy salted fries.', img: 'fries', station: 'fryer', veg: 1, variants: [['Regular', 150], ['Large', 250]],
      recipeV: { Regular: { 'Frozen Fries': 0.18, 'Cooking Oil': 0.04 }, Large: { 'Frozen Fries': 0.3, 'Cooking Oil': 0.06 } } },
    { name: 'Spicy Fries', desc: 'Fries tossed in our spicy masala.', img: 'fries', station: 'fryer', veg: 1, spicy: 2, variants: [['Regular', 150], ['Large', 250]],
      recipeV: { Regular: { 'Frozen Fries': 0.18, 'Cooking Oil': 0.04 }, Large: { 'Frozen Fries': 0.3, 'Cooking Oil': 0.06 } } },
    { name: 'Loaded Fries', desc: 'Fries loaded with cheese sauce, chicken and our signature sauces.', img: 'fries', station: 'fryer', spicy: 1, variants: [['Regular', 400], ['Large', 800]], featured: 1,
      recipeV: { Regular: { 'Frozen Fries': 0.2, 'Mozzarella Cheese': 0.05, 'Chicken Boneless': 0.06, 'Signature Sauce': 0.03, 'Cooking Oil': 0.04, 'Takeaway Box': 1 },
        Large: { 'Frozen Fries': 0.4, 'Mozzarella Cheese': 0.1, 'Chicken Boneless': 0.12, 'Signature Sauce': 0.06, 'Cooking Oil': 0.08, 'Takeaway Box': 1 } } },
  ] },
  { cat: 'Drinks', items: [
    { name: 'Mineral Water', desc: 'Chilled 500ml bottle.', img: 'drinks', station: 'drinks', veg: 1, variants: [['500ml', 60]], recipe: { 'Water 500ml': 1 } },
    { name: 'Cold Drink', desc: 'Chilled Pepsi, 7Up or Mirinda.', img: 'drinks', station: 'drinks', veg: 1, choices: { Flavour: DRINKS },
      variants: [['345ml', 100], ['500ml', 150], ['1 Litre', 180], ['1.5 Litre', 220]],
      recipeV: { '345ml': { 'Cold Drink 345ml': 1 }, '500ml': { 'Cold Drink 500ml': 1 }, '1 Litre': { 'Cold Drink 1L': 1 }, '1.5 Litre': { 'Cold Drink 1.5L': 1 } } },
  ] },
];

const EMPLOYEES = [
  // name, role, username, password, pay_type, salary, hourly, commission, phone
  ['Mudassir Ahmad', 'admin', 'admin', 'admin123', 'monthly', 0, 0, 0, '0304-7263382'],
  ['Usman Tariq', 'manager', 'manager', 'manager123', 'monthly', 65000, 0, 0, '0321-5550101'],
  ['Ayesha Khan', 'cashier', 'cashier', 'cashier123', 'monthly', 38000, 0, 0, '0333-5550102'],
  ['Bilal Hussain', 'chef', 'chef', 'chef123', 'monthly', 55000, 0, 0, '0345-5550103'],
  ['Hamza Ali', 'chef', 'chef2', 'chef123', 'hourly', 0, 220, 0, '0345-5550104'],
  ['Ali Raza', 'waiter', 'waiter', 'waiter123', 'hourly', 0, 170, 0, '0300-5550105'],
  ['Imran Shah', 'rider', 'rider1', 'rider123', 'monthly', 25000, 0, 60, '0312-5550106'],
  ['Kashif Mehmood', 'rider', 'rider2', 'rider123', 'monthly', 25000, 0, 60, '0313-5550107'],
  ['Zeeshan Akhtar', 'rider', 'rider3', 'rider123', 'hourly', 0, 160, 70, '0314-5550108'],
];

function wipe() {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    const tables = q.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    for (const t of tables) db.exec(`DELETE FROM "${t.name}"`);
    db.exec("DELETE FROM sqlite_sequence");
    db.exec('COMMIT');
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Deterministic PRNG so demo data is the same every reset
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const utc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const addMin = (d, m) => new Date(d.getTime() + m * 60000);

export function seed({ demo = true } = {}) {
  wipe(); // must run outside a transaction: SQLite ignores PRAGMA foreign_keys inside one
  tx(() => {
    const settings = {
      restaurant_name: 'FEAST', tagline: 'Taste that hits different!', phone: '0304-7263382', whatsapp: '923047263382',
      address: 'New Colony', tax_rate: 0, free_delivery_threshold: 2000, min_delivery_order: 0, tables: 12,
      accepting_orders: true, opening_hours: '12:00 PM - 2:00 AM', currency: 'Rs.',
    };
    for (const [k, v] of Object.entries(settings)) setSetting(k, v);
    q.run("INSERT INTO delivery_zones(name, fee) VALUES ('New Colony', 50)");
    q.run("INSERT INTO delivery_zones(name, fee) VALUES ('All Other Colonies', 100)");

    for (const sp of SUPPLIERS) q.run('INSERT INTO suppliers(name, phone, contact_person, address) VALUES (?,?,?,?)', ...sp);
    const ing = {};
    for (const [name, unit, cost, stock, reorder] of INGREDIENTS) {
      const id = Number(q.run('INSERT INTO ingredients(name, unit, cost_per_unit, stock, reorder_level, supplier_id) VALUES (?,?,?,?,?,?)',
        name, unit, cost, stock, reorder, SUPPLIER_OF(name)).lastInsertRowid);
      ing[name] = id;
      q.run(`INSERT INTO inventory_logs(ingredient_id, change, balance, type, unit_cost, note, created_at)
             VALUES (?,?,?,'adjust',?,'Opening stock', datetime('now','-31 days'))`, id, stock, stock, cost);
    }
    const addRecipe = (itemId, map, variant = null, addon = null) => {
      for (const [n, qty] of Object.entries(map)) {
        if (!ing[n]) throw new Error(`Unknown ingredient ${n}`);
        q.run('INSERT INTO recipes(item_id, variant_name, addon_name, ingredient_id, qty) VALUES (?,?,?,?,?)', itemId, variant, addon, ing[n], qty);
      }
    };

    MENU.forEach((group, ci) => {
      const catId = Number(q.run('INSERT INTO categories(name, slug, sort) VALUES (?,?,?)', group.cat,
        group.cat.toLowerCase().replace(/[^a-z]+/g, '-'), ci).lastInsertRowid);
      group.items.forEach((it, ii) => {
        const station = group.pizza ? 'pizza' : it.station;
        const img = `/img/menu/${group.pizza ? 'pizza' : it.img}.jpg`;
        const itemId = Number(q.run(`INSERT INTO menu_items(category_id, name, description, image, is_veg, spicy, station, featured, sort)
          VALUES (?,?,?,?,?,?,?,?,?)`, catId, it.name, it.desc, img, it.veg || 0, it.spicy || 0, station, it.featured || 0, ii).lastInsertRowid);
        if (group.pizza) {
          SIZES.forEach((sz, i) => {
            const f = SIZE_F[i];
            q.run('INSERT INTO item_variants(item_id, name, price, sort) VALUES (?,?,?,?)', itemId, sz, it.prices[i], i);
            addRecipe(itemId, {
              'Pizza Dough': 0.35 * f, 'Pizza Sauce': 0.08 * f, 'Mozzarella Cheese': (it.name === 'Feast Supreme' ? 0.2 : 0.15) * f,
              [it.protein]: (it.protein === 'Beef Pepperoni' ? 0.08 : 0.13) * f, Onion: 0.03 * f, Capsicum: 0.02 * f,
              ...(it.name === 'Feast Supreme' ? { 'Black Olives': 0.02 * f } : {}),
              ...(it.name === 'Crown Crust' ? { 'Beef Kebab Mince': 0.06 * f } : {}),
              'Pizza Box': 1,
            }, sz);
            const tops = [['Veggies', [50, 75, 100, 125][i], { Capsicum: 0.03 * f, Onion: 0.03 * f, Tomato: 0.03 * f }],
              ['Extra Cheese', [50, 100, 150, 200][i], { 'Mozzarella Cheese': 0.06 * f }],
              ['Extra Chicken', [50, 100, 150, 200][i], { 'Chicken Boneless': 0.06 * f }],
              ['Beef Kebab Crust', [100, 200, 300, 400][i], { 'Beef Kebab Mince': 0.07 * f }]];
            for (const [an, ap, rec] of tops) {
              if (an === 'Beef Kebab Crust' && it.name === 'Crown Crust') continue;
              q.run('INSERT INTO item_addons(item_id, name, variant_name, price) VALUES (?,?,?,?)', itemId, an, sz, ap);
              addRecipe(itemId, rec, sz, an);
            }
          });
        } else {
          it.variants.forEach(([vn, vp], i) => q.run('INSERT INTO item_variants(item_id, name, price, sort) VALUES (?,?,?,?)', itemId, vn, vp, i));
          for (const [an, ap] of it.addons || []) {
            q.run('INSERT INTO item_addons(item_id, name, price) VALUES (?,?,?)', itemId, an, ap);
            addRecipe(itemId, an === 'Cheese Slice' ? { 'Cheese Slice': 1 } : { 'Iceberg Lettuce': 0.03 }, null, an);
          }
          for (const [g, opts] of Object.entries(it.choices || {})) opts.forEach((o, k) => q.run('INSERT INTO item_choices(item_id, grp, name, sort) VALUES (?,?,?,?)', itemId, g, o, k));
          if (it.recipe) addRecipe(itemId, it.recipe);
          if (it.recipeV) for (const [vn, map] of Object.entries(it.recipeV)) addRecipe(itemId, map, vn);
        }
      });
    });

    // Deals category, listed first
    const dealCat = Number(q.run("INSERT INTO categories(name, slug, sort) VALUES ('Deals', 'deals', -1)").lastInsertRowid);
    DEALS.forEach((d, di) => {
      let value = 0;
      const sum = new Map();
      for (const [pn, pv, pq] of d.parts) {
        const pid = q.get('SELECT id FROM menu_items WHERE name = ?', pn).id;
        const pvar = pv ? q.get('SELECT price FROM item_variants WHERE item_id = ? AND name = ?', pid, pv) : q.get('SELECT price FROM item_variants WHERE item_id = ? ORDER BY sort LIMIT 1', pid);
        value += pvar.price * pq;
        const rows = q.all('SELECT ingredient_id, qty FROM recipes WHERE item_id = ? AND addon_name IS NULL AND (variant_name IS NULL OR variant_name = ?)', pid, pv ?? '');
        for (const r of rows) sum.set(r.ingredient_id, (sum.get(r.ingredient_id) || 0) + r.qty * pq);
      }
      const did = Number(q.run(`INSERT INTO menu_items(category_id, name, description, image, station, featured, sort, compare_at) VALUES (?,?,?,?,?,?,?,?)`,
        dealCat, d.name, d.desc, `/img/menu/${d.img}.jpg`, d.station, d.featured || 0, di, value).lastInsertRowid);
      q.run("INSERT INTO item_variants(item_id, name, price, sort) VALUES (?, 'Deal', ?, 0)", did, d.price);
      for (const [ingId, qty] of sum) q.run('INSERT INTO recipes(item_id, variant_name, addon_name, ingredient_id, qty) VALUES (?,?,?,?,?)', did, null, null, ingId, Math.round(qty * 1000) / 1000);
      let k = 0;
      for (const [g, opts] of Object.entries(d.choices)) for (const o of opts) q.run('INSERT INTO item_choices(item_id, grp, name, sort) VALUES (?,?,?,?)', did, g, o, k++);
    });

    const emp = {};
    for (const [name, role, username, pw, payType, salary, hourly, comm, phone] of EMPLOYEES) {
      emp[username] = Number(q.run(`INSERT INTO employees(name, role, username, password_hash, pay_type, base_salary, hourly_rate, commission_per_delivery, phone, joined_at)
        VALUES (?,?,?,?,?,?,?,?,?, date('now','-120 days'))`, name, role, username, hashPassword(pw), payType, salary, hourly, comm, phone).lastInsertRowid);
    }

    if (demo) seedHistory(emp);
  });
}

function seedHistory(emp) {
  const items = q.all('SELECT m.id, m.name, c.name AS cat FROM menu_items m JOIN categories c ON c.id = m.category_id');
  const variants = q.all('SELECT * FROM item_variants');
  const addons = q.all('SELECT * FROM item_addons');
  const weight = { Deals: 4, Burgers: 5, Wraps: 4, Pizza: 4, Wings: 3, 'Sides & Snacks': 4, Drinks: 3 };
  const pool = items.flatMap((i) => Array(weight[i.cat]).fill(i));
  const riders = [emp.rider1, emp.rider2, emp.rider3];
  const names = ['Ahmed', 'Sara', 'Hassan', 'Fatima', 'Omar', 'Zainab', 'Bilal', 'Hira', 'Faisal', 'Maryam', 'Saad', 'Areeba', 'Talha', 'Noor', 'Junaid', 'Iqra'];
  const streets = ['House 12, Street 4, New Colony', 'Flat 3B, Gulshan Block', 'House 88, Model Town', 'Shop 5, Main Boulevard', 'House 21, Canal View', 'House 7, Officers Colony'];
  const surnames = ['Khan', 'Ali', 'Raza', 'Malik', 'Butt', 'Sheikh', 'Iqbal', 'Hussain', 'Qureshi', 'Chaudhry', 'Mirza', 'Siddiqui'];
  const people = Array.from({ length: 220 }, () => ({
    name: `${pick(names)} ${pick(surnames)}`,
    phone: `03${Math.floor(rand() * 5)}${Math.floor(rand() * 10)}-${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`,
    address: pick(streets),
  })).filter((c, i, a) => a.findIndex((x) => x.phone === c.phone) === i);
  const zones = q.all('SELECT * FROM delivery_zones');
  const commission = Object.fromEntries(q.all("SELECT id, commission_per_delivery c FROM employees WHERE role='rider'").map((r) => [r.id, r.c]));

  const choiceRows = q.all('SELECT item_id, grp, name FROM item_choices');
  const optionsFor = (itemId) => {
    const out = {};
    for (const c of choiceRows.filter((r) => r.item_id === itemId)) if (!out[c.grp] || rand() < 0.4) out[c.grp] = c.name;
    return out;
  };
  const makeCart = () => {
    const n = 1 + Math.floor(rand() * 3.5);
    const cart = [];
    for (let k = 0; k < n; k++) {
      const it = pick(pool);
      const vs = variants.filter((v) => v.item_id === it.id);
      const v = pick(vs);
      const ads = addons.filter((a) => a.item_id === it.id && (!a.variant_name || a.variant_name === v.name));
      cart.push({ item_id: it.id, variant_id: v.id, addons: ads.length && rand() < 0.25 ? [pick(ads).name] : [], qty: rand() < 0.8 ? 1 : 2, options: optionsFor(it.id) });
    }
    if (rand() < 0.45) {
      const drink = items.find((i) => i.name === 'Cold Drink');
      cart.push({ item_id: drink.id, variant_id: pick(variants.filter((v) => v.item_id === drink.id)).id, addons: [], qty: 1, options: optionsFor(drink.id) });
    }
    return cart;
  };

  const insertOrder = (created, status, opts = {}) => {
    const r = rand();
    const type = opts.type || (r < 0.55 ? 'delivery' : r < 0.85 ? 'takeaway' : 'dine_in');
    const zone = pick(zones);
    const p = priceCart(makeCart(), { type, zoneId: zone.id });
    // Skewed pick from a fixed customer pool so regulars appear many times
    const person = people[Math.floor(rand() ** 1.8 * people.length)];
    const { name, phone } = person;
    let cust = q.get('SELECT id FROM customers WHERE phone = ?', phone)?.id;
    if (!cust) cust = Number(q.run('INSERT INTO customers(name, phone, address, created_at) VALUES (?,?,?,?)', name, phone, person.address, utc(created)).lastInsertRowid);
    const prep = addMin(created, 2 + rand() * 4);
    const ready = addMin(prep, 9 + rand() * 12);
    const picked = addMin(ready, 2 + rand() * 6);
    const closed = type === 'delivery' ? addMin(picked, 10 + rand() * 20) : addMin(ready, 3 + rand() * 10);
    const reached = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'];
    const idx = status === 'cancelled' ? 0 : reached.indexOf(status);
    const finalStatus = status === 'done' ? (type === 'delivery' ? 'delivered' : 'completed') : status;
    const done = ['delivered', 'completed'].includes(finalStatus);
    const rider = type === 'delivery' && (done || finalStatus === 'out_for_delivery') ? (opts.rider || pick(riders)) : null;
    const method = rand() < 0.78 ? 'cash' : rand() < 0.5 ? 'card' : 'wallet';
    const source = rand() < 0.5 ? 'online' : rand() < 0.6 ? 'pos' : rand() < 0.5 ? 'phone' : 'whatsapp';
    const cogs = p.lines.reduce((x, l) => x + l.unit_cost * l.qty, 0);
    const oid = Number(q.run(`INSERT INTO orders(code, type, status, source, customer_id, customer_name, phone, address, zone_id, table_no, subtotal, tax, delivery_fee,
      discount, total, cogs, payment_method, payment_status, rider_id, created_at, updated_at, preparing_at, ready_at, picked_at, closed_at, cancel_reason, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      Math.random().toString(36).slice(2, 8).toUpperCase(), type, finalStatus, source, cust, name, phone,
      type === 'delivery' ? person.address : null, type === 'delivery' ? zone.id : null, type === 'dine_in' ? String(1 + Math.floor(rand() * 12)) : null,
      p.subtotal, p.tax, p.delivery_fee, 0, p.total, Math.round(cogs * 100) / 100, method, done ? 'paid' : 'unpaid', rider,
      utc(created), utc(done ? closed : created),
      idx >= 1 || done ? utc(prep) : null, idx >= 2 || done ? utc(ready) : null,
      rider ? utc(picked) : null, done || finalStatus === 'cancelled' ? utc(closed) : null,
      finalStatus === 'cancelled' ? pick(['Customer not reachable', 'Customer cancelled', 'Duplicate order']) : null,
      source === 'online' ? null : emp.cashier).lastInsertRowid);
    for (const l of p.lines) {
      q.run(`INSERT INTO order_items(order_id, item_id, name, variant_name, addons, unit_price, qty, line_total, unit_cost, station, done)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, oid, l.item_id, l.name, l.variant_name, JSON.stringify(l.addons), l.unit_price, l.qty, l.line_total, l.unit_cost, l.station, done ? 1 : 0);
    }
    const ev = (from, to, at, by) => q.run('INSERT INTO order_events(order_id, from_status, to_status, employee_id, created_at) VALUES (?,?,?,?,?)', oid, from, to, by, utc(at));
    ev(null, 'received', created, source === 'online' ? null : emp.cashier);
    if (finalStatus === 'cancelled') ev('received', 'cancelled', closed, emp.manager);
    if (idx >= 1 || done) ev('received', 'preparing', prep, emp.chef);
    if (idx >= 2 || done) ev('preparing', 'ready', ready, emp.chef);
    if (rider) {
      ev('ready', 'out_for_delivery', picked, rider);
      q.run(`INSERT INTO deliveries(order_id, rider_id, status, assigned_at, picked_at, delivered_at, cash_collected, commission) VALUES (?,?,?,?,?,?,?,?)`,
        oid, rider, done ? 'delivered' : 'picked_up', utc(ready), utc(picked), done ? utc(closed) : null, done && method === 'cash' ? p.total : 0, done ? commission[rider] : 0);
    }
    if (done) {
      ev(type === 'delivery' ? 'out_for_delivery' : 'ready', finalStatus, closed, rider || emp.cashier);
      q.run(`INSERT INTO transactions(type, amount, method, order_id, ref, description, employee_id, created_at) VALUES ('sale',?,?,?,?,?,?,?)`,
        p.total, method, oid, `#${oid}`, `${type === 'delivery' ? 'Delivery' : type === 'dine_in' ? 'Dine-in' : 'Takeaway'} order #${oid}`, rider || emp.cashier, utc(closed));
    }
    return oid;
  };

  const now = new Date();
  for (let day = 30; day >= 1; day--) {
    const base = new Date(now);
    base.setDate(base.getDate() - day);
    const weekend = [5, 6, 0].includes(base.getDay());
    const count = Math.round((weekend ? 38 : 26) + rand() * 14 + (30 - day) * 0.3);
    for (let i = 0; i < count; i++) {
      // Lunch and dinner peaks
      const hour = rand() < 0.3 ? 13 + rand() * 3 : 19 + rand() * 5;
      const d = new Date(base);
      d.setHours(Math.floor(hour), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      insertOrder(d, rand() < 0.03 ? 'cancelled' : 'done');
    }
    // Attendance: everyone works ~12:00 to ~midnight
    for (const [u, id] of Object.entries(emp)) {
      if (u === 'admin' || rand() < 0.12) continue;
      const ci = new Date(base); ci.setHours(11, 30 + Math.floor(rand() * 40), 0, 0);
      const hours = 9 + rand() * 3;
      const co = addMin(ci, hours * 60);
      q.run('INSERT INTO attendance(employee_id, clock_in, clock_out, hours) VALUES (?,?,?,?)', id, utc(ci), utc(co), Math.round(hours * 100) / 100);
    }
    // Daily waste
    if (rand() < 0.5) {
      const ingr = q.get('SELECT * FROM ingredients WHERE name IN (\'Iceberg Lettuce\',\'Tomato\',\'Frozen Fries\',\'Burger Bun\') ORDER BY RANDOM() LIMIT 1');
      const amt = ingr.unit === 'pcs' ? 4 : 0.5;
      const at = new Date(base); at.setHours(23, 30);
      q.run(`INSERT INTO inventory_logs(ingredient_id, change, balance, type, unit_cost, note, employee_id, created_at) VALUES (?,?,?,'waste',?,?,?,?)`,
        ingr.id, -amt, ingr.stock, ingr.cost_per_unit, 'End of day spoilage', emp.chef, utc(at));
    }
  }

  // Expenses for the period
  const exp = (daysAgo, cat, amount, note) => {
    const d = new Date(now); d.setDate(d.getDate() - daysAgo);
    const ds = d.toISOString().slice(0, 10);
    const eid = Number(q.run('INSERT INTO expenses(category, amount, note, date, employee_id) VALUES (?,?,?,?,?)', cat, amount, note, ds, emp.manager).lastInsertRowid);
    q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id, created_at) VALUES ('expense', ?, 'cash', ?, ?, ?, ?)`,
      -amount, `EXP-${eid}`, `${cat}: ${note}`, emp.manager, `${ds} 12:00:00`);
  };
  exp(28, 'Rent', 150000, 'Monthly shop rent');
  exp(20, 'Electricity', 48000, 'LESCO bill');
  exp(18, 'Gas', 14500, 'SNGPL bill');
  exp(15, 'Internet', 3500, 'Fiber connection');
  exp(12, 'Packaging', 18000, 'Printed boxes & bags');
  exp(9, 'Marketing', 12000, 'Facebook/Instagram ads');
  exp(5, 'Maintenance', 6500, 'Fryer servicing');
  exp(2, 'Fuel', 9000, 'Rider bikes fuel');

  // Two received purchase orders
  for (const [daysAgo, sup, lines] of [[10, 1, [['Chicken Fillet', 25, 950], ['Chicken Boneless', 30, 900]]], [4, 3, [['Cooking Oil', 40, 550], ['Mozzarella Cheese', 15, 1800]]]]) {
    const total = lines.reduce((t, l) => t + l[1] * l[2], 0);
    const d = new Date(now); d.setDate(d.getDate() - daysAgo);
    const pid = Number(q.run("INSERT INTO purchase_orders(supplier_id, status, total, created_by, created_at, received_at) VALUES (?, 'received', ?, ?, ?, ?)", sup, total, emp.manager, utc(d), utc(addMin(d, 300))).lastInsertRowid);
    for (const [n, qty, cost] of lines) {
      const ingId = q.get('SELECT id FROM ingredients WHERE name = ?', n).id;
      q.run('INSERT INTO purchase_order_items(po_id, ingredient_id, qty, unit_cost) VALUES (?,?,?,?)', pid, ingId, qty, cost);
    }
    q.run(`INSERT INTO transactions(type, amount, method, ref, description, employee_id, created_at) VALUES ('purchase', ?, 'cash', ?, ?, ?, ?)`,
      -total, `PO-${pid}`, `Purchase order PO-${pid}`, emp.manager, utc(addMin(d, 300)));
  }
  q.run("INSERT INTO purchase_orders(supplier_id, status, total, created_by) VALUES (4, 'pending', 3300, ?)", emp.manager);
  q.run("INSERT INTO purchase_order_items(po_id, ingredient_id, qty, unit_cost) VALUES (3, (SELECT id FROM ingredients WHERE name='Cold Drink 1.5L'), 20, 165)");
  q.run("INSERT INTO advances(employee_id, amount, note, date) VALUES (?, 5000, 'Family emergency', date('now','-6 days'))", emp.rider2);

  // Today: completed orders this morning plus a live pipeline for the boards
  const t0 = new Date(now); t0.setMinutes(t0.getMinutes() - 240);
  for (let i = 0; i < 9; i++) insertOrder(addMin(t0, i * 18), 'done');
  const live = [['received', 'delivery'], ['received', 'takeaway'], ['preparing', 'delivery'], ['preparing', 'dine_in'], ['ready', 'delivery'], ['ready', 'takeaway'], ['out_for_delivery', 'delivery'], ['ready', 'dine_in'], ['ready', 'dine_in'], ['received', 'dine_in']];
  live.forEach(([st, type], i) => insertOrder(addMin(now, -(44 - i * 4)), st, { type, rider: emp.rider2 }));

  // One seated table has already been served and is eating
  q.run("UPDATE orders SET served_at = ready_at WHERE id = (SELECT MIN(id) FROM orders WHERE type = 'dine_in' AND status = 'ready')");

  // Past rider cash has been handed in; today's is still with the riders
  q.run("UPDATE deliveries SET settled_at = delivered_at, settled_by = ? WHERE status = 'delivered' AND date(delivered_at,'localtime') < date('now','localtime')", emp.manager);

  // Sample promo codes
  q.run(`INSERT INTO promos(code, description, kind, value, min_subtotal, max_discount, online_only) VALUES
    ('FEAST10', '10% off online orders', 'percent', 10, 1000, 300, 1),
    ('WELCOME150', 'Rs. 150 off your first big order', 'flat', 150, 1500, NULL, 0)`);

  // Staff currently on shift
  for (const u of ['manager', 'cashier', 'chef', 'chef2', 'waiter', 'rider1', 'rider2']) {
    q.run("INSERT INTO attendance(employee_id, clock_in) VALUES (?, datetime('now','-5 hours'))", emp[u]);
  }
}

// CLI: npm run seed  (with --demo for sample history)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo');
  seed({ demo });
  const c = q.get('SELECT (SELECT COUNT(*) FROM menu_items) items, (SELECT COUNT(*) FROM orders) orders, (SELECT COUNT(*) FROM ingredients) ingredients');
  console.log(`Seeded ${c.items} menu items, ${c.ingredients} ingredients, ${c.orders} orders${demo ? ' (with demo history)' : ''}.`);
  console.log('Logins: admin/admin123, manager/manager123, cashier/cashier123, chef/chef123, rider1/rider123');
}
