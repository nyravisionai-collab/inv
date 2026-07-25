const bcrypt = require('bcryptjs');
const db = require('./database');
const migrate = require('./migrate');
const config = require('../config');
const { today } = require('../utils/helpers');

async function seed() {
  console.log('Seeding database...');
  await migrate();

  const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (existing) {
    console.log('Database already seeded. Skipping.');
    return;
  }

  const txn = db.transaction(() => {
    // Admin user
    const hash = bcrypt.hashSync('admin123', config.bcryptRounds);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, permissions)
      VALUES (?,?,?,?,?,?,?)
    `).run('admin', 'admin@inventory.local', hash, 'System Admin', '9876543210', 'admin', JSON.stringify({ all: true }));

    // Staff users
    const staffHash = bcrypt.hashSync('staff123', config.bcryptRounds);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, permissions)
      VALUES (?,?,?,?,?,?,?)
    `).run('staff', 'staff@inventory.local', staffHash, 'Store Staff', '9876543211', 'staff',
      JSON.stringify({ dashboard: true, sales: true, purchase: true, inventory: true, customers: true, suppliers: true, reports: true }));

    const cashierHash = bcrypt.hashSync('cashier123', config.bcryptRounds);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, permissions)
      VALUES (?,?,?,?,?,?,?)
    `).run('cashier', 'cashier@inventory.local', cashierHash, 'POS Cashier', '9876543212', 'cashier',
      JSON.stringify({ dashboard: true, sales: true, customers: true, pos: true }));

    // Company settings
    db.prepare(`
      UPDATE company_settings SET
        company_name = ?, legal_name = ?, address = ?, city = ?, state = ?, pincode = ?,
        phone = ?, email = ?, gstin = ?, pan = ?, invoice_terms = ?
      WHERE id = 1
    `).run(
      'Shree Traders', 'Shree Traders Pvt Ltd', '12 Market Road, Ring Road',
      'Surat', 'Gujarat', '395002', '9876543210', 'info@shreetraders.com',
      '24AAAAA0000A1Z5', 'AAAAA0000A',
      'Goods once sold will not be taken back. Payment due within 30 days.'
    );

    // Units
    const units = [
      ['Piece', 'pcs', 0], ['Kilogram', 'kg', 1], ['Gram', 'g', 1],
      ['Litre', 'ltr', 1], ['Meter', 'mtr', 1], ['Box', 'box', 0],
      ['Dozen', 'doz', 0], ['Packet', 'pkt', 0], ['Pair', 'pair', 0],
    ];
    const insertUnit = db.prepare('INSERT INTO units (name, short_name, allow_fractional) VALUES (?,?,?)');
    units.forEach(u => insertUnit.run(...u));

    // Categories
    const cats = ['Electronics', 'Groceries', 'Clothing', 'Stationery', 'Hardware', 'Personal Care', 'Beverages', 'Snacks'];
    const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    cats.forEach(c => insertCat.run(c));

    // Brands
    const brands = ['Samsung', 'Apple', 'Sony', 'Nike', 'Adidas', 'Amul', 'Nestle', 'Local', 'Generic'];
    const insertBrand = db.prepare('INSERT INTO brands (name) VALUES (?)');
    brands.forEach(b => insertBrand.run(b));

    // Warehouses
    db.prepare(`INSERT INTO warehouses (name, code, address, city, state, is_default) VALUES (?,?,?,?,?,1)`)
      .run('Main Store', 'WH-MAIN', '12 Market Road', 'Surat', 'Gujarat');
    db.prepare(`INSERT INTO warehouses (name, code, address, city, state, is_default) VALUES (?,?,?,?,?,0)`)
      .run('Godown', 'WH-GDN', '45 Industrial Area', 'Surat', 'Gujarat');

    // Bank accounts
    db.prepare(`INSERT INTO bank_accounts (account_name, account_type, opening_balance, current_balance, is_default) VALUES (?,?,?,?,1)`)
      .run('Cash in Hand', 'cash', 50000, 50000);
    db.prepare(`INSERT INTO bank_accounts (account_name, bank_name, account_number, ifsc, account_type, opening_balance, current_balance) VALUES (?,?,?,?,?,?,?)`)
      .run('HDFC Current', 'HDFC Bank', '50200012345678', 'HDFC0001234', 'bank', 100000, 100000);
    db.prepare(`INSERT INTO bank_accounts (account_name, account_type, opening_balance, current_balance) VALUES (?,?,?,?)`)
      .run('UPI / GPay', 'upi', 0, 0);

    // Tax rates
    const taxes = [
      ['GST 0%', 0, 0, 0, 0],
      ['GST 5%', 5, 2.5, 2.5, 5],
      ['GST 12%', 12, 6, 6, 12],
      ['GST 18%', 18, 9, 9, 18],
      ['GST 28%', 28, 14, 14, 28],
    ];
    const insertTax = db.prepare('INSERT INTO tax_rates (name, rate, cgst, sgst, igst) VALUES (?,?,?,?,?)');
    taxes.forEach(t => insertTax.run(...t));

    // Products
    const pcsUnit = db.prepare("SELECT id FROM units WHERE short_name='pcs'").get().id;
    const kgUnit = db.prepare("SELECT id FROM units WHERE short_name='kg'").get().id;
    const elecCat = db.prepare("SELECT id FROM categories WHERE name='Electronics'").get().id;
    const grocCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get().id;
    const clothCat = db.prepare("SELECT id FROM categories WHERE name='Clothing'").get().id;
    const statCat = db.prepare("SELECT id FROM categories WHERE name='Stationery'").get().id;
    const bevCat = db.prepare("SELECT id FROM categories WHERE name='Beverages'").get().id;
    const snackCat = db.prepare("SELECT id FROM categories WHERE name='Snacks'").get().id;
    const samsung = db.prepare("SELECT id FROM brands WHERE name='Samsung'").get().id;
    const amul = db.prepare("SELECT id FROM brands WHERE name='Amul'").get().id;
    const nestle = db.prepare("SELECT id FROM brands WHERE name='Nestle'").get().id;
    const local = db.prepare("SELECT id FROM brands WHERE name='Local'").get().id;
    const wh = db.prepare("SELECT id FROM warehouses WHERE is_default=1").get().id;

    const products = [
      ['Samsung Galaxy Buds', 'ELC-001', '8901234567890', '8518', elecCat, samsung, pcsUnit, 2500, 3999, 4499, 18, 5, 50],
      ['USB-C Cable 1m', 'ELC-002', '8901234567891', '8544', elecCat, local, pcsUnit, 80, 199, 249, 18, 10, 100],
      ['Wireless Mouse', 'ELC-003', '8901234567892', '8471', elecCat, samsung, pcsUnit, 350, 699, 799, 18, 5, 40],
      ['Amul Butter 500g', 'GRC-001', '8901234567893', '0405', grocCat, amul, pcsUnit, 240, 285, 285, 5, 20, 80],
      ['Amul Milk 1L', 'GRC-002', '8901234567894', '0401', grocCat, amul, pcsUnit, 55, 68, 68, 0, 30, 100],
      ['Toor Dal 1kg', 'GRC-003', '8901234567895', '0713', grocCat, local, kgUnit, 120, 145, 150, 0, 15, 50],
      ['Basmati Rice 5kg', 'GRC-004', '8901234567896', '1006', grocCat, local, pcsUnit, 380, 499, 550, 0, 10, 30],
      ['Cotton T-Shirt M', 'CLT-001', '8901234567897', '6109', clothCat, local, pcsUnit, 200, 499, 599, 5, 10, 40],
      ['Jeans 32', 'CLT-002', '8901234567898', '6203', clothCat, local, pcsUnit, 600, 1299, 1499, 5, 5, 25],
      ['A4 Notebook', 'STA-001', '8901234567899', '4820', statCat, local, pcsUnit, 30, 60, 75, 12, 20, 100],
      ['Ball Pen Blue', 'STA-002', '8901234567900', '9608', statCat, local, pcsUnit, 5, 10, 12, 12, 50, 200],
      ['Nestle Maggi 4-pack', 'SNK-001', '8901234567901', '1902', snackCat, nestle, pcsUnit, 48, 60, 60, 12, 25, 80],
      ['Coca Cola 750ml', 'BEV-001', '8901234567902', '2202', bevCat, local, pcsUnit, 35, 40, 40, 28, 20, 60],
      ['Mineral Water 1L', 'BEV-002', '8901234567903', '2201', bevCat, local, pcsUnit, 12, 20, 20, 18, 30, 100],
      ['Power Bank 10000mAh', 'ELC-004', '8901234567904', '8507', elecCat, samsung, pcsUnit, 800, 1499, 1799, 18, 5, 20],
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (name, sku, barcode, hsn_code, category_id, brand_id, unit_id, purchase_price, selling_price, mrp, tax_rate, min_stock, opening_stock, current_stock)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertWs = db.prepare('INSERT INTO warehouse_stock (product_id, warehouse_id, quantity) VALUES (?,?,?)');

    for (const p of products) {
      // p: name,sku,barcode,hsn,cat,brand,unit,purchase,selling,mrp,tax,min_stock,stock
      // INSERT needs opening_stock AND current_stock (both = stock)
      const r = insertProd.run(...p, p[12]);
      insertWs.run(r.lastInsertRowid, wh, p[12]);
    }

    // Customers
    const customers = [
      ['Walk-in Customer', '0000000000', null, null, 'Surat', 'Gujarat', null, 0],
      ['Rajesh Patel', '9876501234', 'rajesh@email.com', '15 Textile Market', 'Surat', 'Gujarat', null, 50000],
      ['Priya Shah', '9876501235', 'priya@email.com', '22 Ring Road', 'Surat', 'Gujarat', '24BBBBB1111B1Z5', 25000],
      ['Amit Enterprises', '9876501236', 'amit@ent.com', 'Plot 5 GIDC', 'Surat', 'Gujarat', '24CCCCC2222C1Z5', 100000],
      ['Meera Desai', '9876501237', null, '8 Citylight', 'Surat', 'Gujarat', null, 10000],
    ];
    const insertCust = db.prepare(`
      INSERT INTO customers (name, phone, email, address, city, state, gstin, credit_limit)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    customers.forEach(c => insertCust.run(...c));

    // Suppliers
    const suppliers = [
      ['Tech Distributors', '9876510001', 'tech@dist.com', 'Mumbai', 'Maharashtra', '27AAAAA1111A1Z5'],
      ['Gujarat Wholesale', '9876510002', 'gw@supply.com', 'Ahmedabad', 'Gujarat', '24BBBBB2222B1Z5'],
      ['Local Kirana Supply', '9876510003', null, 'Surat', 'Gujarat', null],
      ['Fashion Hub', '9876510004', 'fashion@hub.com', 'Surat', 'Gujarat', '24CCCCC3333C1Z5'],
    ];
    const insertSup = db.prepare(`
      INSERT INTO suppliers (name, phone, email, city, state, gstin) VALUES (?,?,?,?,?,?)
    `);
    suppliers.forEach(s => insertSup.run(...s));

    // Sample sale
    const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
    const cust2 = db.prepare("SELECT id FROM customers WHERE name='Rajesh Patel'").get().id;
    const prod1 = db.prepare("SELECT * FROM products WHERE sku='ELC-001'").get();
    const prod2 = db.prepare("SELECT * FROM products WHERE sku='ELC-002'").get();

    const saleResult = db.prepare(`
      INSERT INTO sales (invoice_number, invoice_type, customer_id, invoice_date, status, payment_status,
        subtotal, discount_amount, tax_amount, grand_total, paid_amount, balance_amount, warehouse_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('INV-00001', 'sale', cust2, today(), 'completed', 'partial',
      4198, 0, 755.64, 4953.64, 3000, 1953.64, wh, adminId);

    db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, hsn_code, quantity, unit_price, tax_rate, tax_amount, total)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(saleResult.lastInsertRowid, prod1.id, prod1.name, prod1.hsn_code, 1, 3999, 18, 719.82, 4718.82);

    db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, hsn_code, quantity, unit_price, tax_rate, tax_amount, total)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(saleResult.lastInsertRowid, prod2.id, prod2.name, prod2.hsn_code, 1, 199, 18, 35.82, 234.82);

    // Reduce stock
    db.prepare('UPDATE products SET current_stock = current_stock - 1 WHERE id = ?').run(prod1.id);
    db.prepare('UPDATE products SET current_stock = current_stock - 1 WHERE id = ?').run(prod2.id);
    db.prepare('UPDATE warehouse_stock SET quantity = quantity - 1 WHERE product_id = ? AND warehouse_id = ?').run(prod1.id, wh);
    db.prepare('UPDATE warehouse_stock SET quantity = quantity - 1 WHERE product_id = ? AND warehouse_id = ?').run(prod2.id, wh);

    // Payment
    db.prepare(`
      INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, sale_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run('RCPT-00001', 'payment_in', 'customer', cust2, today(), 3000, 'upi', saleResult.lastInsertRowid, adminId);

    db.prepare("UPDATE company_settings SET invoice_next_number = 2, payment_in_next_number = 2 WHERE id = 1").run();

    // Update customer balance
    db.prepare('UPDATE customers SET current_balance = 1953.64 WHERE id = ?').run(cust2);

    // Sample expense
    db.prepare(`
      INSERT INTO expenses (expense_number, category, expense_date, amount, payment_mode, description, created_by)
      VALUES (?,?,?,?,?,?,?)
    `).run('EXP-00001', 'Rent', today(), 15000, 'bank', 'Shop rent for current month', adminId);

    db.prepare(`
      INSERT INTO expenses (expense_number, category, expense_date, amount, payment_mode, description, created_by)
      VALUES (?,?,?,?,?,?,?)
    `).run('EXP-00002', 'Utilities', today(), 2500, 'upi', 'Electricity bill', adminId);

    // Update cash for expense
    const cashAcc = db.prepare("SELECT id FROM bank_accounts WHERE account_type='cash'").get();
    db.prepare('UPDATE bank_accounts SET current_balance = current_balance - 17500 WHERE id = ?').run(cashAcc.id);
  });

  txn();
  db.persist();
  console.log('✓ Seed data created successfully');
  console.log('');
  console.log('Default logins:');
  console.log('  Admin:   admin / admin123');
  console.log('  Staff:   staff / staff123');
  console.log('  Cashier: cashier / cashier123');
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = seed;
