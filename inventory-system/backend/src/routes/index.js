const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const upload = require('../middleware/upload');

const dashboard = require('../controllers/dashboardController');
const products = require('../controllers/productController');
const sales = require('../controllers/salesController');
const purchases = require('../controllers/purchaseController');
const payments = require('../controllers/paymentController');
const customers = require('../controllers/customerController');
const suppliers = require('../controllers/supplierController');
const inventory = require('../controllers/inventoryController');
const accounting = require('../controllers/accountingController');
const reports = require('../controllers/reportController');
const settings = require('../controllers/settingsController');
const users = require('../controllers/userController');
const search = require('../controllers/searchController');
const notifications = require('../controllers/notificationController');

// Open access — attach local system user only (no login)
router.use(authenticate);

// Dashboard
router.get('/dashboard', dashboard.getDashboard);

// Products
router.get('/products', products.list);
router.get('/products/low-stock', products.lowStock);
router.get('/products/barcodes/all', products.generateAllBarcodes);
router.get('/products/barcode/:barcode', products.getByBarcode);
router.get('/products/:id', products.getById);
router.get('/products/:id/barcode', products.generateBarcode);
router.post('/products', upload.single('image'), auditLog('create', 'product'), products.create);
router.put('/products/:id', upload.single('image'), auditLog('update', 'product'), products.update);
router.delete('/products/:id', auditLog('delete', 'product'), products.remove);

// Sales
router.get('/sales', sales.list);
router.get('/sales/:id', sales.getById);
router.get('/sales/:id/pdf', sales.pdfInvoice);
router.get('/sales/:id/whatsapp', sales.whatsappLink);
router.post('/sales', auditLog('create', 'sale'), sales.create);
router.put('/sales/:id', sales.update);
router.post('/sales/:id/cancel', auditLog('cancel', 'sale'), sales.cancel);
router.post('/sales/:id/convert', sales.convert);

router.get('/estimates', (req, res) => { req.query.type = 'estimate'; sales.list(req, res); });
router.get('/sale-orders', (req, res) => { req.query.type = 'sale_order'; sales.list(req, res); });
router.get('/delivery-challans', (req, res) => { req.query.type = 'delivery_challan'; sales.list(req, res); });
router.get('/sale-returns', (req, res) => { req.query.type = 'sale_return'; sales.list(req, res); });
router.get('/pos', (req, res) => { req.query.type = 'pos'; sales.list(req, res); });

// Purchases
router.get('/purchases', purchases.list);
router.get('/purchases/:id', purchases.getById);
router.post('/purchases', auditLog('create', 'purchase'), purchases.create);
router.post('/purchases/:id/cancel', auditLog('cancel', 'purchase'), purchases.cancel);
router.get('/purchase-orders', (req, res) => { req.query.type = 'purchase_order'; purchases.list(req, res); });
router.get('/purchase-returns', (req, res) => { req.query.type = 'purchase_return'; purchases.list(req, res); });

// Payments
router.get('/payments', payments.list);
router.get('/payments/:id', payments.getById);
router.post('/payments', auditLog('create', 'payment'), payments.create);
router.delete('/payments/:id', payments.remove);

// Customers
router.get('/customers', customers.list);
router.get('/customers/outstanding', customers.outstanding);
router.get('/customers/:id', customers.getById);
router.get('/customers/:id/ledger', customers.ledger);
router.post('/customers', auditLog('create', 'customer'), customers.create);
router.put('/customers/:id', customers.update);
router.delete('/customers/:id', customers.remove);

// Suppliers
router.get('/suppliers', suppliers.list);
router.get('/suppliers/outstanding', suppliers.outstanding);
router.get('/suppliers/:id', suppliers.getById);
router.get('/suppliers/:id/ledger', suppliers.ledger);
router.post('/suppliers', auditLog('create', 'supplier'), suppliers.create);
router.put('/suppliers/:id', suppliers.update);
router.delete('/suppliers/:id', suppliers.remove);

// Inventory masters
router.get('/categories', inventory.listCategories);
router.post('/categories', inventory.createCategory);
router.put('/categories/:id', inventory.updateCategory);
router.delete('/categories/:id', inventory.deleteCategory);

router.get('/brands', inventory.listBrands);
router.post('/brands', inventory.createBrand);
router.put('/brands/:id', inventory.updateBrand);
router.delete('/brands/:id', inventory.deleteBrand);

router.get('/units', inventory.listUnits);
router.post('/units', inventory.createUnit);
router.delete('/units/:id', inventory.deleteUnit);

router.get('/warehouses', inventory.listWarehouses);
router.post('/warehouses', inventory.createWarehouse);
router.put('/warehouses/:id', inventory.updateWarehouse);
router.delete('/warehouses/:id', inventory.deleteWarehouse);

router.get('/stock/transfers', inventory.listTransfers);
router.post('/stock/transfers', inventory.createTransfer);
router.get('/stock/adjustments', inventory.listAdjustments);
router.post('/stock/adjustments', inventory.createAdjustment);
router.get('/stock/report', inventory.stockReport);

// Accounting
router.get('/banks', accounting.listBanks);
router.post('/banks', accounting.createBank);
router.put('/banks/:id', accounting.updateBank);
router.get('/expenses', accounting.listExpenses);
router.post('/expenses', accounting.createExpense);
router.delete('/expenses/:id', accounting.deleteExpense);
router.get('/incomes', accounting.listIncomes);
router.post('/incomes', accounting.createIncome);
router.get('/journals', accounting.listJournals);
router.get('/journals/:id', accounting.getJournal);
router.post('/journals', accounting.createJournal);
router.get('/cash-book', accounting.cashBook);

// Reports
router.get('/reports/profit-loss', reports.profitLoss);
router.get('/reports/balance-sheet', reports.balanceSheet);
router.get('/reports/gst', reports.gstReport);
router.get('/reports/sales', reports.salesReport);
router.get('/reports/purchases', reports.purchaseReport);
router.get('/reports/expenses', reports.expenseReport);
router.get('/reports/tax', reports.taxReport);
router.get('/reports/customers', reports.customerReport);
router.get('/reports/suppliers', reports.supplierReport);
router.get('/reports/stock', inventory.stockReport);

// Settings
router.get('/settings', settings.getSettings);
router.put('/settings', settings.updateSettings);
router.post('/settings/logo', upload.single('logo'), settings.uploadLogo);
router.get('/tax-rates', settings.listTaxRates);
router.post('/tax-rates', settings.createTaxRate);
router.delete('/tax-rates/:id', settings.deleteTaxRate);
router.post('/backup', settings.backup);
router.get('/backups', settings.listBackups);
router.post('/restore', settings.restore);
router.get('/export', settings.exportData);
router.post('/import', upload.single('file'), settings.importData);

// Users (local multi-user records — no login)
router.get('/users', users.list);
router.get('/users/permissions', users.getPermissions);
router.get('/users/:id', users.getById);
router.post('/users', auditLog('create', 'user'), users.create);
router.put('/users/:id', auditLog('update', 'user'), users.update);
router.delete('/users/:id', users.remove);
router.get('/audit-logs', users.auditLogs);

// Search & notifications
router.get('/search', search.globalSearch);
router.get('/notifications', notifications.list);
router.post('/notifications/check', notifications.checkAlerts);
router.put('/notifications/:id/read', notifications.markRead);

// Health (also open without needing DB user)
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API is healthy', timestamp: new Date().toISOString() });
});

module.exports = router;
