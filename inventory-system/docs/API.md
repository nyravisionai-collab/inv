# API Documentation

Base URL: `http://localhost:3000/api`

All authenticated endpoints require header:
```
Authorization: Bearer <token>
```

## Authentication

### Login
```
POST /auth/login
Body: { "username": "admin", "password": "admin123" }
Response: { success, data: { token, user } }
```

### Me
```
GET /auth/me
Response: { success, data: user }
```

### Change Password
```
POST /auth/change-password
Body: { "current_password": "...", "new_password": "..." }
```

### Logout
```
POST /auth/logout
```

## Dashboard

```
GET /dashboard
Response: {
  todaySales, todayPurchases, cashInHand, bankBalance, profit,
  lowStock, recentTransactions, salesChart, purchaseChart,
  topProducts, monthlySales, totalCustomers, totalProducts,
  stockValue, receivables, payables
}
```

## Products

```
GET    /products?page=1&limit=20&search=&category_id=&low_stock=1
GET    /products/:id
GET    /products/barcode/:barcode
GET    /products/:id/barcode          # QR code data URL
GET    /products/low-stock
POST   /products                     # Create
PUT    /products/:id                 # Update
DELETE /products/:id                 # Soft delete
```

**Create body:**
```json
{
  "name": "Product Name",
  "sku": "SKU-001",
  "barcode": "8901234567890",
  "hsn_code": "8518",
  "category_id": 1,
  "brand_id": 1,
  "unit_id": 1,
  "purchase_price": 100,
  "selling_price": 150,
  "mrp": 199,
  "tax_rate": 18,
  "min_stock": 5,
  "opening_stock": 50
}
```

## Sales

```
GET    /sales?type=sale&page=1&search=&from_date=&to_date=
GET    /sales/:id
POST   /sales
PUT    /sales/:id
POST   /sales/:id/cancel
POST   /sales/:id/convert            # { to_type: "sale" }
GET    /sales/:id/pdf                # PDF stream
GET    /sales/:id/whatsapp           # WhatsApp link

# Typed lists
GET    /estimates
GET    /sale-orders
GET    /delivery-challans
GET    /sale-returns
GET    /pos
```

**Create body:**
```json
{
  "invoice_type": "sale",
  "customer_id": 1,
  "invoice_date": "2026-07-20",
  "items": [
    {
      "product_id": 1,
      "product_name": "Item",
      "quantity": 2,
      "unit_price": 100,
      "tax_rate": 18,
      "discount_value": 0,
      "discount_type": "amount"
    }
  ],
  "discount_type": "amount",
  "discount_value": 0,
  "shipping_charges": 0,
  "paid_amount": 200,
  "payment_mode": "cash",
  "status": "completed"
}
```

`invoice_type`: `sale` | `estimate` | `sale_order` | `delivery_challan` | `sale_return` | `pos`

## Purchases

```
GET    /purchases?type=purchase&page=1
GET    /purchases/:id
POST   /purchases
POST   /purchases/:id/cancel
GET    /purchase-orders
GET    /purchase-returns
```

## Payments

```
GET    /payments?type=payment_in&party_type=customer
GET    /payments/:id
POST   /payments
DELETE /payments/:id
```

```json
{
  "payment_type": "payment_in",
  "party_type": "customer",
  "party_id": 1,
  "amount": 1000,
  "payment_mode": "upi",
  "sale_id": 5
}
```

## Customers / Suppliers

```
GET    /customers?page=1&search=
GET    /customers/:id
GET    /customers/:id/ledger
GET    /customers/outstanding
POST   /customers
PUT    /customers/:id
DELETE /customers/:id

GET    /suppliers ...
GET    /suppliers/:id/ledger
GET    /suppliers/outstanding
POST   /suppliers
PUT    /suppliers/:id
DELETE /suppliers/:id
```

## Inventory Master Data

```
GET/POST/PUT/DELETE  /categories
GET/POST/PUT/DELETE  /brands
GET/POST/DELETE      /units
GET/POST/PUT/DELETE  /warehouses

GET  /stock/transfers
POST /stock/transfers
GET  /stock/adjustments
POST /stock/adjustments
GET  /stock/report?warehouse_id=&low_stock=1
```

## Accounting

```
GET/POST/PUT  /banks
GET/POST      /expenses
DELETE        /expenses/:id
GET/POST      /incomes
GET/POST      /journals
GET           /journals/:id
GET           /cash-book?from_date=&to_date=&bank_account_id=
```

## Reports

```
GET /reports/profit-loss?from_date=&to_date=
GET /reports/balance-sheet?as_of=
GET /reports/gst?from_date=&to_date=
GET /reports/sales?from_date=&to_date=&group_by=date|customer|product
GET /reports/purchases?from_date=&to_date=
GET /reports/expenses?from_date=&to_date=
GET /reports/tax
GET /reports/customers
GET /reports/suppliers
GET /reports/stock
```

## Settings & System

```
GET/PUT  /settings
POST     /settings/logo          # multipart
GET/POST /tax-rates
DELETE   /tax-rates/:id
POST     /backup
GET      /backups
POST     /restore                # { filename }
GET      /export?type=products&format=csv|xlsx|json
POST     /import                 # multipart file + type

GET/POST/PUT/DELETE  /users      # admin only
GET      /users/permissions
GET      /audit-logs

GET      /search?q=query
GET      /notifications
POST     /notifications/check
PUT      /notifications/:id/read
GET      /health
```

## Response Format

Success:
```json
{ "success": true, "message": "Success", "data": {} }
```

Paginated:
```json
{
  "success": true,
  "data": [],
  "pagination": { "total": 100, "page": 1, "limit": 20, "pages": 5 }
}
```

Error:
```json
{ "success": false, "message": "Error description" }
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 422 | Validation error |
| 429 | Rate limited |
| 500 | Server error |
