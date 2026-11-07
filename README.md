# FEAST Restaurant OS

A complete restaurant IT system for **FEAST — Taste That Hits Different**: online ordering, POS, kitchen display,
rider dispatch, inventory with recipe costing, purchasing, staff & payroll, and finance reporting.

**No frontend framework and no build step.** The UI is plain JavaScript (native ES modules) and CSS served as static
files, so upstream framework releases can't break it. The server has exactly two pinned dependencies (`express`, `zod`)
and uses Node's built-in SQLite (`node:sqlite`), so there are no native modules to compile.

## Run it

```bash
npm install
npm start            # http://localhost:4000  (seeds the database on first run)
npm run dev          # same, auto-restarts when server code changes
npm run seed         # reset: brochure menu + 30 days of demo history
npm run seed:clean   # reset: brochure menu, staff and inventory only — no demo orders (go-live)
```

Requires **Node 22.13+**. Data lives in `data/feast.db` (back up this file). Set `PORT` / `DATA_DIR` to change defaults.

## Screens

| URL | Who | What |
|---|---|---|
| `/` | Customers | Menu from the brochure, sizes/add-ons, cart, checkout (delivery / pickup / dine-in) |
| `/track/:code` | Customers | Live order tracker (updates instantly), rider call + location |
| `/pos` | Cashier, waiter | Fast counter ordering, phone/WhatsApp orders, discounts, receipts |
| `/live` | Cashier, manager | Kanban of every open order, rider assignment, completion & payment |
| `/tables` | Waiter, cashier, manager | Dine-in floor: table grid (free / in kitchen / food ready / eating / bill asked), dine-in queue, mark served, add rounds, move tables, print one bill, complete & free the table. Managers change the number of tables with − / + |
| `/kitchen` | Chef | KDS: tickets by urgency, station filters, per-item bump, ticket print, "86" items |
| `/rider` | Riders (mobile) | Pick up, navigate, call, mark delivered / returned, earnings, live location |
| `/admin/close` | Cashier, manager | Day close / Z-report: sales by payment, type and channel, expected cash in till vs counted, rider cash hand-in |
| `/admin` | Manager, admin | Dashboard, orders, customers, menu & recipes, inventory, purchasing, staff & shifts, payroll, reports, ledger, settings |

Demo logins: `admin/admin123`, `manager/manager123`, `cashier/cashier123`, `chef/chef123`, `rider1/rider123`, `waiter/waiter123`.
**Change these passwords (Admin → Staff) before going live**, or run `npm run seed:clean` and set new ones.

## How the order lifecycle works

```
received ──(chef: Start)──▶ preparing ──(chef: Ready)──▶ ready ──┬─(rider: Pick up)──▶ out_for_delivery ──(rider: Delivered)──▶ delivered
   │                         │                                   └─(cashier: Complete)──▶ completed           │
   └──────── cancelled ◀─────┘                                                                                  └─(Couldn't deliver)──▶ ready
```

- **Start preparing** deducts every ingredient in the item's recipe (base + chosen size + add-ons) from stock and logs it. Low-stock alerts fire live.
- **Delivered / Completed** marks the order paid and writes a `sale` entry into the central ledger, plus a delivery log
  (cash collected, rider commission). No manual entry is needed.
- Every step is broadcast over Server-Sent Events to POS, kitchen, rider and admin screens, and to the customer's tracker.
- Each transition is permission-checked on the server (state machine in `server/services/orders.js`) and recorded in the order timeline.
- Prices are always recalculated on the server; client prices are never trusted.

## Dine-in

Orders for a table (from the POS, the Tables screen, or a customer choosing Dine-in online) appear on **Tables**. The kitchen cooks them as usual; when food is ready the table pulses green and the waiter marks it **served**. Guests can order more rounds on the same table. **Complete** takes one payment for every round, posts the sales to the ledger and frees the table. Settings → *Dine-in billing* switches between *pay after eating* (default) and *pay when ordering*.

## Back office

- **Menu & recipes**: items, sizes, size-specific add-ons (e.g. pizza toppings), required choices (e.g. drink flavour Pepsi / 7Up / Mirinda, the pizza in a deal), a Deals category with crossed-out regular value and "Save Rs. X", photos, and a bill-of-materials editor that shows live food cost and margin per size.
- **Inventory**: stock, value, 7-day usage, days left, waste, physical counts, full movement log (CSV).
- **Purchasing**: suppliers and POs ("Fill from low stock"); receiving updates stock, weighted-average cost and the ledger.
- **Staff & shifts**: roles, logins, pay terms; clock in/out (staff use the clock button in the top bar); shift corrections are audited.
- **Payroll**: monthly salary (pro-rated), hourly from attendance, per-delivery commission, bonus, deductions, advances; payslip print; paying posts to the ledger.
- **Reports**: sales by day/week/month, item profitability, P&L (net sales − COGS − waste − expenses − payroll), food-cost %.
- **Day close**: end-of-day Z-report with cash reconciliation (cash in − cash out − rider cash still out = expected till), counted-cash over/short check, and one-click rider cash hand-in. Riders see their outstanding cash on their phone until it's received.
- **Customers**: profiles built from phone numbers with lifetime spend, average order, favourite items and full order history; one-tap call / WhatsApp.
- **Finance**: ledger of sales, refunds, purchases, expenses and payroll with CSV export; expense entry.
- **Settings**: name, WhatsApp, tax %, free-delivery threshold (Rs. 2,000), delivery zones (New Colony Rs. 50 / others Rs. 100), tables, online ordering on/off; **promo codes** (percent or fixed, minimum order, cap, dates, usage limit, online-only) that customers enter at checkout and cashiers at the POS; audit log (admin).

## Project layout

```
server/            Express API (no ORM)
  db.js            schema + tiny query helpers (node:sqlite)
  services/        order state machine, pricing, inventory deduction
  routes/          public, orders+rider, menu, inventory, staff+payroll, reports+settings
  seed.js          brochure menu, recipes, ingredients, staff, demo history
client/            static frontend (served as-is)
  js/core.js       safe html templating, router, API client, live events, modals, icons
  js/pages/        storefront, tracker, login, POS, live board, kitchen, rider
  js/admin/        back-office modules
public/img/menu/   food photos cropped from the brochure
```

## Production notes

- Put it behind HTTPS (e.g. Caddy or Nginx) — staff tokens and customer phone numbers travel over the network.
- Back up `data/feast.db` daily (it's a single file; SQLite WAL mode is enabled).
- Brochure photos are low resolution; upload proper photos under Admin → Menu for a sharper storefront.
- Recipe quantities and ingredient costs are realistic estimates. Replace them with your real figures so food-cost reports are accurate.
