import { route, startRouter } from './core.js';

const MGMT = ['manager'];
route('/', () => import('./pages/store.js'), { title: 'Order Online' });
route('/track', () => import('./pages/track.js'), { title: 'Track Order' });
route('/track/:code', () => import('./pages/track.js'), { title: 'Track Order' });
route('/login', () => import('./pages/login.js'), { title: 'Staff Sign In' });
route('/pos', () => import('./pages/pos.js'), { title: 'Point of Sale', roles: ['manager', 'cashier', 'waiter'] });
route('/live', () => import('./pages/live.js'), { title: 'Live Orders', roles: ['manager', 'cashier', 'waiter'] });
route('/tables', () => import('./pages/tables.js'), { title: 'Tables', roles: ['manager', 'cashier', 'waiter'] });
route('/kitchen', () => import('./pages/kitchen.js'), { title: 'Kitchen Display', roles: ['manager', 'chef', 'cashier'] });
route('/rider', () => import('./pages/rider.js'), { title: 'Rider', roles: ['rider'] });
route('/admin', () => import('./admin/dashboard.js'), { title: 'Dashboard', roles: MGMT });
route('/admin/orders', () => import('./admin/orders.js'), { title: 'Orders', roles: MGMT });
route('/admin/menu', () => import('./admin/menu.js'), { title: 'Menu', roles: MGMT });
route('/admin/inventory', () => import('./admin/inventory.js'), { title: 'Inventory', roles: MGMT });
route('/admin/purchasing', () => import('./admin/purchasing.js'), { title: 'Purchasing', roles: MGMT });
route('/admin/staff', () => import('./admin/staff.js'), { title: 'Staff', roles: MGMT });
route('/admin/payroll', () => import('./admin/payroll.js'), { title: 'Payroll', roles: MGMT });
route('/admin/reports', () => import('./admin/reports.js'), { title: 'Reports', roles: MGMT });
route('/admin/finance', () => import('./admin/finance.js'), { title: 'Finance', roles: MGMT });
route('/admin/customers', () => import('./admin/customers.js'), { title: 'Customers', roles: MGMT });
route('/admin/close', () => import('./admin/close.js'), { title: 'Day close', roles: ['manager', 'cashier'] });
route('/admin/settings', () => import('./admin/settings.js'), { title: 'Settings', roles: MGMT });

startRouter();
