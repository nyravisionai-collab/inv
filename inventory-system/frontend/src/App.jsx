import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Sales from './pages/Sales';
import Purchases from './pages/Purchases';
import POS from './pages/POS';
import { Customers, Suppliers } from './pages/Parties';
import Payments from './pages/Payments';
import { Categories, Warehouses, LowStock, StockTransfer, StockAdjustment } from './pages/Inventory';
import { Expenses, Incomes, Banks, CashBook, Journals } from './pages/Accounting';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Users from './pages/Users';

function AppRoutes() {
  const { loading } = useAuth();
  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
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
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
