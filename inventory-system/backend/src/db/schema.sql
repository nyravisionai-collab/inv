-- Inventory Management System Schema
-- Production-ready SQLite schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff','cashier','manager')),
  permissions TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  avatar TEXT,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  company_name TEXT DEFAULT 'My Business',
  legal_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  country TEXT DEFAULT 'India',
  phone TEXT,
  email TEXT,
  website TEXT,
  gstin TEXT,
  pan TEXT,
  logo_path TEXT,
  currency TEXT DEFAULT 'INR',
  currency_symbol TEXT DEFAULT '₹',
  fiscal_year_start TEXT DEFAULT '04-01',
  invoice_prefix TEXT DEFAULT 'INV',
  invoice_next_number INTEGER DEFAULT 1,
  purchase_prefix TEXT DEFAULT 'PUR',
  purchase_next_number INTEGER DEFAULT 1,
  estimate_prefix TEXT DEFAULT 'EST',
  estimate_next_number INTEGER DEFAULT 1,
  sale_order_prefix TEXT DEFAULT 'SO',
  sale_order_next_number INTEGER DEFAULT 1,
  challan_prefix TEXT DEFAULT 'DC',
  challan_next_number INTEGER DEFAULT 1,
  payment_in_prefix TEXT DEFAULT 'RCPT',
  payment_in_next_number INTEGER DEFAULT 1,
  payment_out_prefix TEXT DEFAULT 'PYMT',
  payment_out_next_number INTEGER DEFAULT 1,
  tax_enabled INTEGER DEFAULT 1,
  default_tax_rate REAL DEFAULT 18,
  invoice_template TEXT DEFAULT 'standard',
  invoice_terms TEXT,
  invoice_notes TEXT,
  theme TEXT DEFAULT 'light',
  language TEXT DEFAULT 'en',
  timezone TEXT DEFAULT 'Asia/Kolkata',
  low_stock_alert INTEGER DEFAULT 1,
  backup_auto INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  image TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  logo TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  short_name TEXT NOT NULL,
  allow_fractional INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  address TEXT,
  city TEXT,
  state TEXT,
  phone TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  barcode TEXT UNIQUE,
  hsn_code TEXT,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  purchase_price REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  mrp REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_type TEXT DEFAULT 'exclusive' CHECK(tax_type IN ('inclusive','exclusive','none')),
  min_stock REAL DEFAULT 0,
  max_stock REAL DEFAULT 0,
  reorder_level REAL DEFAULT 0,
  opening_stock REAL DEFAULT 0,
  current_stock REAL DEFAULT 0,
  image TEXT,
  has_batch INTEGER DEFAULT 0,
  has_expiry INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_service INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS product_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  batch_number TEXT NOT NULL,
  expiry_date TEXT,
  manufacture_date TEXT,
  quantity REAL DEFAULT 0,
  purchase_price REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_id, batch_number)
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_number TEXT UNIQUE,
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  transfer_date TEXT NOT NULL,
  status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES product_batches(id),
  quantity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_number TEXT UNIQUE,
  warehouse_id INTEGER REFERENCES warehouses(id),
  adjustment_date TEXT NOT NULL,
  reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES product_batches(id),
  previous_qty REAL DEFAULT 0,
  new_qty REAL DEFAULT 0,
  difference REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gstin TEXT,
  pan TEXT,
  credit_limit REAL DEFAULT 0,
  opening_balance REAL DEFAULT 0,
  balance_type TEXT DEFAULT 'debit' CHECK(balance_type IN ('debit','credit')),
  current_balance REAL DEFAULT 0,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gstin TEXT,
  pan TEXT,
  opening_balance REAL DEFAULT 0,
  balance_type TEXT DEFAULT 'credit' CHECK(balance_type IN ('debit','credit')),
  current_balance REAL DEFAULT 0,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  ifsc TEXT,
  branch TEXT,
  account_type TEXT DEFAULT 'bank' CHECK(account_type IN ('bank','cash','upi','other')),
  opening_balance REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,
  invoice_type TEXT DEFAULT 'sale' CHECK(invoice_type IN ('sale','estimate','sale_order','delivery_challan','sale_return','pos')),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  reference_number TEXT,
  status TEXT DEFAULT 'completed' CHECK(status IN ('draft','pending','completed','cancelled','converted')),
  payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','partial','paid')),
  subtotal REAL DEFAULT 0,
  discount_type TEXT DEFAULT 'amount' CHECK(discount_type IN ('amount','percent')),
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  shipping_charges REAL DEFAULT 0,
  other_charges REAL DEFAULT 0,
  round_off REAL DEFAULT 0,
  grand_total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  balance_amount REAL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  converted_from INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  hsn_code TEXT,
  batch_id INTEGER REFERENCES product_batches(id),
  quantity REAL NOT NULL DEFAULT 1,
  unit_id INTEGER REFERENCES units(id),
  unit_price REAL NOT NULL DEFAULT 0,
  discount_type TEXT DEFAULT 'amount',
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_number TEXT UNIQUE NOT NULL,
  bill_type TEXT DEFAULT 'purchase' CHECK(bill_type IN ('purchase','purchase_order','purchase_return')),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  bill_date TEXT NOT NULL,
  due_date TEXT,
  reference_number TEXT,
  supplier_invoice TEXT,
  status TEXT DEFAULT 'completed' CHECK(status IN ('draft','pending','completed','cancelled','converted')),
  payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','partial','paid')),
  subtotal REAL DEFAULT 0,
  discount_type TEXT DEFAULT 'amount' CHECK(discount_type IN ('amount','percent')),
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  shipping_charges REAL DEFAULT 0,
  other_charges REAL DEFAULT 0,
  round_off REAL DEFAULT 0,
  grand_total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  balance_amount REAL DEFAULT 0,
  notes TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  converted_from INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  hsn_code TEXT,
  batch_number TEXT,
  expiry_date TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_id INTEGER REFERENCES units(id),
  unit_price REAL NOT NULL DEFAULT 0,
  discount_type TEXT DEFAULT 'amount',
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_number TEXT UNIQUE NOT NULL,
  payment_type TEXT NOT NULL CHECK(payment_type IN ('payment_in','payment_out')),
  party_type TEXT CHECK(party_type IN ('customer','supplier')),
  party_id INTEGER,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash','bank','upi','cheque','card','other')),
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  reference_number TEXT,
  cheque_number TEXT,
  cheque_date TEXT,
  notes TEXT,
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_number TEXT UNIQUE,
  category TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT DEFAULT 'cash',
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  description TEXT,
  reference_number TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  income_number TEXT UNIQUE,
  category TEXT NOT NULL,
  income_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT DEFAULT 'cash',
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  description TEXT,
  reference_number TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_number TEXT UNIQUE NOT NULL,
  entry_date TEXT NOT NULL,
  entry_type TEXT DEFAULT 'journal' CHECK(entry_type IN ('journal','contra','payment','receipt')),
  narration TEXT,
  total_debit REAL DEFAULT 0,
  total_credit REAL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS cash_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,
  particular TEXT NOT NULL,
  voucher_type TEXT,
  voucher_id INTEGER,
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  old_values TEXT,
  new_values TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rate REAL NOT NULL,
  cgst REAL DEFAULT 0,
  sgst REAL DEFAULT 0,
  igst REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_type ON sales(invoice_type);
CREATE INDEX IF NOT EXISTS idx_sales_number ON sales(invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(bill_date);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product ON warehouse_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
