import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import ErrorBoundary from './components/ErrorBoundary';
import ConnectionGate from './components/ConnectionGate';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';

/**
 * Heavy or rarely-used screens are code-split so the initial bundle stays
 * small on low-end Android devices. Dashboard is eagerly loaded because it is
 * the landing route.
 */
const Products = lazy(() => import('./pages/Products'));
const Sales = lazy(() => import('./pages/Sales'));
const Purchases = lazy(() => import('./pages/Purchases'));
const POS = lazy(() => import('./pages/POS'));
const Payments = lazy(() => import('./pages/Payments'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));

const Customers = lazy(() => import('./pages/Parties').then((m) => ({ default: m.Customers })));
const Suppliers = lazy(() => import('./pages/Parties').then((m) => ({ default: m.Suppliers })));

const Categories = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Categories })));
const Brands = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Brands })));
const Warehouses = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Warehouses })));
const LowStock = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.LowStock })));
const StockTransfer = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.StockTransfer })));
const StockAdjustment = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.StockAdjustment })));

const Expenses = lazy(() => import('./pages/Accounting').then((m) => ({ default: m.Expenses })));
const Incomes = lazy(() => import('./pages/Accounting').then((m) => ({ default: m.Incomes })));
const Banks = lazy(() => import('./pages/Accounting').then((m) => ({ default: m.Banks })));
const CashBook = lazy(() => import('./pages/Accounting').then((m) => ({ default: m.CashBook })));
const Journals = lazy(() => import('./pages/Accounting').then((m) => ({ default: m.Journals })));

function PageFallback() {
  return (
    <div className="loading-page">
      <div className="spinner" />
    </div>
  );
}

function AppRoutes() {
  const { loading } = useAuth();
  if (loading) return <PageFallback />;

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pos" element={<POS />} />

          <Route path="sales" element={<Sales />} />
          <Route path="sales/new" element={<Sales />} />
          <Route path="sales/:id" element={<Sales />} />
          <Route path="estimates" element={<Sales />} />
          <Route path="estimates/new" element={<Sales />} />
          <Route path="sale-orders" element={<Sales />} />
          <Route path="sale-orders/new" element={<Sales />} />
          <Route path="delivery-challans" element={<Sales />} />
          <Route path="delivery-challans/new" element={<Sales />} />
          <Route path="sale-returns" element={<Sales />} />
          <Route path="sale-returns/new" element={<Sales />} />
          <Route path="payments-in" element={<Payments />} />

          <Route path="purchases" element={<Purchases />} />
          <Route path="purchases/new" element={<Purchases />} />
          <Route path="purchases/:id" element={<Purchases />} />
          <Route path="purchase-orders" element={<Purchases />} />
          <Route path="purchase-orders/new" element={<Purchases />} />
          <Route path="purchase-returns" element={<Purchases />} />
          <Route path="purchase-returns/new" element={<Purchases />} />
          <Route path="payments-out" element={<Payments />} />

          <Route path="products" element={<Products />} />
          <Route path="categories" element={<Categories />} />
          <Route path="brands" element={<Brands />} />
          <Route path="warehouses" element={<Warehouses />} />
          <Route path="stock-transfer" element={<StockTransfer />} />
          <Route path="stock-adjustment" element={<StockAdjustment />} />
          <Route path="low-stock" element={<LowStock />} />

          <Route path="customers" element={<Customers />} />
          <Route path="suppliers" element={<Suppliers />} />

          <Route path="expenses" element={<Expenses />} />
          <Route path="incomes" element={<Incomes />} />
          <Route path="banks" element={<Banks />} />
          <Route path="cash-book" element={<CashBook />} />
          <Route path="journals" element={<Journals />} />

          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="users" element={<Users />} />
        </Route>
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/** Error boundary that can use translations from AuthContext. */
function TranslatedErrorBoundary({ children }) {
  const { t } = useAuth();
  return <ErrorBoundary t={t}>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ConnectionGate>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <TranslatedErrorBoundary>
                <AppRoutes />
              </TranslatedErrorBoundary>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </ConnectionGate>
    </BrowserRouter>
  );
}
