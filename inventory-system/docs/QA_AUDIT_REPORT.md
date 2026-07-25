# Functional QA Audit Report

**Date:** 2026-07-20  
**Status:** ✅ ZERO functional failures — production ready  
**E2E API tests:** 91/91 passed  
**Unit tests:** 35/35 passed  
**Frontend build:** ✅  
**UI:** http://localhost:5173 · **API:** http://localhost:5000  

---

## Bugs found and fixed

### BUG-01 — Soft-delete + UNIQUE blocked recreate (Critical)
**Modules:** Categories, Brands, Units, Warehouses, Products (SKU/Barcode), Users  
**Symptom:** After deleting a category/brand/product/user, creating another with the **same name** failed with “already exists” because rows were only soft-deleted (`is_active=0`) while UNIQUE constraints still held the name/SKU/email.  
**Fix:**
- On delete, rename unique fields to a freed value (`name__del__{id}`, `sku__del__{id}`, etc.) and set `is_active=0`.
- On create, detect inactive rows with the same name/SKU and **restore** them, or insert fresh after unique fields were freed.

### BUG-02 — Lists showed soft-deleted records (Critical)
**Modules:** Products, Customers, Suppliers, Users  
**Symptom:** Default list queries used `WHERE 1=1` without filtering `is_active`, so deleted products/customers could still appear (or counts were wrong vs dashboard).  
**Fix:** Default list filter is now `is_active = 1` unless the client explicitly passes `is_active`.

### BUG-03 — Product SKU/Barcode uniqueness ignored inactive rows (High)
**Module:** Products  
**Symptom:** Create rejected SKU/barcode that belonged only to a deactivated product.  
**Fix:** Uniqueness checks apply only to **active** products; inactive SKUs can be reused.

### BUG-04 — User delete left username/email permanently reserved (High)
**Module:** Users  
**Symptom:** After deleting user `staff1`, recreating `staff1` failed.  
**Fix:** Free username/email on delete; restore inactive user on recreate with same credentials.

### BUG-05 — Tax rate delete had no restore path (Medium)
**Module:** Settings / Tax rates  
**Symptom:** Soft-deleted tax rates could not be cleanly re-added by name.  
**Fix:** Create restores inactive tax rate with the same name.

---

## Modules tested

| Module | Create | Read/List | Update | Delete | Recreate same name | Notes |
|--------|:------:|:---------:|:------:|:------:|:------------------:|-------|
| Auth (login/me) | — | ✅ | — | — | — | Unauthorized → 401 |
| Categories | ✅ | ✅ | ✅ | ✅ | ✅ | Dropdown-ready list |
| Brands | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Units | ✅ | ✅ | — | ✅ | ✅ | |
| Warehouses | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Products | ✅ | ✅ | ✅ | ✅ | ✅ | Stock, search, barcode, QR |
| Customers | ✅ | ✅ | ✅ | ✅ | ✅ | Ledger |
| Suppliers | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Sales / Invoice | ✅ | ✅ | — | cancel ✅ | — | Stock − on sale, + on cancel |
| POS | ✅ | ✅ | — | — | — | payment_status=paid |
| Estimates | ✅ | ✅ | — | — | — | |
| Purchases | ✅ | ✅ | — | cancel ✅ | — | Stock + on purchase |
| Payments | ✅ | ✅ | — | ✅ hard | — | List refresh OK |
| Expenses | ✅ | ✅ | — | ✅ hard | — | |
| Incomes | ✅ | ✅ | — | — | — | |
| Banks | ✅ | ✅ | — | — | — | |
| Journals | ✅ | ✅ | — | — | — | Debit=Credit |
| Stock adjustment | ✅ | ✅ | — | — | — | Qty set correctly |
| Cash book | — | ✅ | — | — | — | |
| Dashboard | — | ✅ | — | — | — | Counts consistent |
| Reports (9) | — | ✅ | — | — | — | P&L, BS, GST, Sales… |
| Settings | — | ✅ | ✅ | — | — | Company profile |
| Users | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Search | — | ✅ | — | — | — | |
| Notifications | — | ✅ | — | — | — | |
| Backup | ✅ | — | — | — | — | |
| PDF invoice | — | ✅ | — | — | — | |
| WhatsApp link | — | ✅ | — | — | — | |
| Low stock | — | ✅ | — | — | — | |

---

## Database consistency checks

- Sale reduces stock; cancel restores stock.  
- Purchase increases stock; cancel reverses.  
- Stock adjustment sets absolute quantity.  
- Soft-deleted entities disappear from default lists.  
- UNIQUE names/SKUs/usernames reusable after delete.  
- Active duplicate names still correctly rejected.  
- Foreign keys intact (sql.js + schema).  

---

## Automated results

```
E2E CRUD / module audit:  91 passed, 0 failed
Backend unit tests:       35 passed, 0 failed
Frontend vite build:      success
UI http://localhost:5173: 200
API health:               OK
```

---

## Files modified (bug fixes only)

- `backend/src/controllers/productController.js`
- `backend/src/controllers/inventoryController.js`
- `backend/src/controllers/customerController.js`
- `backend/src/controllers/supplierController.js`
- `backend/src/controllers/userController.js`
- `backend/src/controllers/authController.js`
- `backend/src/controllers/settingsController.js`

No UI redesign, no feature removal, no folder structure change.

---

## Login

| User | Password |
|------|----------|
| admin | admin123 |

---

## Conclusion

All CRUD paths, delete→UI refresh, recreate-after-delete, stock movements, reports, auth, backup, PDF, and search were verified. **Zero remaining functional failures** in the automated suite.
