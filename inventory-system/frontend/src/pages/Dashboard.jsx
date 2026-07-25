import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, ShoppingBag, Wallet, DollarSign, AlertTriangle,
  Users, Package, Truck, ArrowUpRight, Receipt,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { dashboardAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';

const COLORS = ['#1976d2', '#2e7d32', '#ed6c02', '#9c27b0', '#d32f2f', '#00796b', '#c2185b', '#512da8'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { formatMoney, settings, t } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    dashboardAPI.get()
      .then((r) => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="spinner" />;
  if (!data) return <div className="empty-state"><h3>Failed to load dashboard</h3></div>;

  const stats = [
    { label: "Today's Sales", value: formatMoney(data.todaySales), sub: `${data.todaySalesCount} invoices`, icon: TrendingUp, color: 'blue', path: '/sales' },
    { label: "Today's Purchases", value: formatMoney(data.todayPurchases), sub: `${data.todayPurchasesCount} bills`, icon: ShoppingBag, color: 'orange', path: '/purchases' },
    { label: 'Cash in Hand', value: formatMoney(data.cashInHand), sub: `Bank: ${formatMoney(data.bankBalance)}`, icon: Wallet, color: 'green', path: '/banks' },
    { label: "Today's Profit", value: formatMoney(data.profit), sub: 'After COGS & expenses', icon: DollarSign, color: data.profit >= 0 ? 'teal' : 'red', path: '/reports' },
    { label: 'Receivables', value: formatMoney(data.receivables), sub: 'Customer dues', icon: Users, color: 'purple', path: '/customers' },
    { label: 'Payables', value: formatMoney(data.payables), sub: 'Supplier dues', icon: Truck, color: 'red', path: '/suppliers' },
    { label: 'Products', value: data.totalProducts, sub: `Stock value: ${formatMoney(data.stockValue)}`, icon: Package, color: 'blue', path: '/products' },
    { label: 'Low Stock', value: data.lowStockCount, sub: 'Items need reorder', icon: AlertTriangle, color: 'orange', path: '/low-stock' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Dashboard')}</h1>
          <p className="page-subtitle">{t('Welcome to')} {settings?.company_name || 'your business'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate('/pos')}>
            <Receipt size={18} /> <span className="hide-mobile">{t('Open POS')}</span>
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/sales/new')}>
            + {t('New Sale')}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card" onClick={() => navigate(s.path)} style={{ cursor: 'pointer' }}>
            <div className={`stat-icon ${s.color}`}><s.icon size={24} /></div>
            <div>
              <div className="stat-label">{t(s.label)}</div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">{t('Sales (Last 7 Days)')}</div></div>
          <div className="card-body">
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.salesChart || []}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1976d2" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#1976d2" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatMoney(v)} />
                  <Area type="monotone" dataKey="total" stroke="#1976d2" fill="url(#salesGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">{t('Purchases (Last 7 Days)')}</div></div>
          <div className="card-body">
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.purchaseChart || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatMoney(v)} />
                  <Bar dataKey="total" fill="#ed6c02" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t('Top Selling Products')}</div>
            <button className="btn btn-sm btn-secondary" onClick={() => navigate('/products')}>{t('View All')}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t('Product')}</th><th>{t('Qty Sold')}</th><th>{t('Revenue')}</th></tr>
              </thead>
              <tbody>
                {(data.topProducts || []).length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No sales data yet</td></tr>
                )}
                {(data.topProducts || []).map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 6, background: COLORS[i % COLORS.length],
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700,
                        }}>{i + 1}</div>
                        {p.name}
                      </div>
                    </td>
                    <td>{p.qty_sold}</td>
                    <td>{formatMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">{t('Low Stock Alerts')}</div>
            <button className="btn btn-sm btn-secondary" onClick={() => navigate('/low-stock')}>{t('View All')}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t('Product')}</th><th>{t('Stock')}</th><th>{t('Min')}</th></tr>
              </thead>
              <tbody>
                {(data.lowStock || []).length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>All stocks healthy</td></tr>
                )}
                {(data.lowStock || []).slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><span className="badge badge-error">{p.current_stock}</span></td>
                    <td>{p.min_stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{t('Recent Transactions')}</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('Type')}</th><th>{t('Number')}</th><th>{t('Party')}</th><th>{t('Date')}</th><th>{t('Amount')}</th><th>{t('Status')}</th></tr>
            </thead>
            <tbody>
              {(data.recentTransactions || []).length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No transactions yet</td></tr>
              )}
              {(data.recentTransactions || []).map((t, i) => (
                <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(t.type === 'sale' ? `/sales/${t.id}` : `/purchases/${t.id}`)}>
                  <td>
                    <span className={`badge ${t.type === 'sale' ? 'badge-success' : 'badge-warning'}`}>
                      {t.type}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{t.number}</td>
                  <td>{t.party || '—'}</td>
                  <td>{t.date}</td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(t.amount)}</td>
                  <td>
                    <span className={`badge ${t.status === 'paid' ? 'badge-success' : t.status === 'partial' ? 'badge-warning' : 'badge-error'}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
