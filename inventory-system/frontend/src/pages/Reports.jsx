import { useEffect, useState } from 'react';
import { TrendingUp, FileText, Package, Users, Truck, Receipt } from 'lucide-react';
import { reportsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';

function today() { return new Date().toISOString().slice(0, 10); }
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const REPORTS = [
  { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp, color: 'blue' },
  { id: 'balance-sheet', label: 'Balance Sheet', icon: FileText, color: 'purple' },
  { id: 'gst', label: 'GST Report', icon: Receipt, color: 'orange' },
  { id: 'sales', label: 'Sales Report', icon: TrendingUp, color: 'green' },
  { id: 'purchases', label: 'Purchase Report', icon: Package, color: 'orange' },
  { id: 'expenses', label: 'Expense Report', icon: Receipt, color: 'red' },
  { id: 'stock', label: 'Stock Report', icon: Package, color: 'teal' },
  { id: 'customers', label: 'Customer Report', icon: Users, color: 'blue' },
  { id: 'suppliers', label: 'Supplier Report', icon: Truck, color: 'purple' },
];

export default function Reports() {
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { formatMoney, t } = useAuth();

  const load = async (id) => {
    setActive(id);
    setLoading(true);
    setData(null);
    try {
      const params = { from_date: from, to_date: to };
      let res;
      switch (id) {
        case 'profit-loss': res = await reportsAPI.profitLoss(params); break;
        case 'balance-sheet': res = await reportsAPI.balanceSheet({ as_of: to }); break;
        case 'gst': res = await reportsAPI.gst(params); break;
        case 'sales': res = await reportsAPI.sales(params); break;
        case 'purchases': res = await reportsAPI.purchases(params); break;
        case 'expenses': res = await reportsAPI.expenses(params); break;
        case 'stock': res = await reportsAPI.stock(); break;
        case 'customers': res = await reportsAPI.customers(); break;
        case 'suppliers': res = await reportsAPI.suppliers(); break;
        default: break;
      }
      setData(res?.data?.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (active) load(active);
  }, [from, to]);

  const renderReport = () => {
    if (loading) return <div className="spinner" />;
    if (!data) return <div className="empty-state"><h3>{t('Select a report')}</h3></div>;

    if (active === 'profit-loss') {
      return (
        <div>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div className="stat-card"><div><div className="stat-label">{t('Net Sales')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.netSales)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('COGS')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.cogs)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Gross Profit')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.grossProfit)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Expenses')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.totalExpenses)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Net Profit')}</div><div className="stat-value" style={{ fontSize: 18, color: data.netProfit >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(data.netProfit)}</div></div></div>
          </div>
          {data.expenses?.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header"><div className="card-title">{t('Expense Breakdown')}</div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Category')}</th><th>{t('Amount')}</th></tr></thead>
                  <tbody>
                    {data.expenses.map((e, i) => (
                      <tr key={i}><td>{e.category}</td><td style={{ fontWeight: 600 }}>{formatMoney(e.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (active === 'balance-sheet') {
      return (
        <div className="grid-2">
          <div className="card">
            <div className="card-header"><div className="card-title">{t('Assets')}</div></div>
            <div className="card-body">
              {(data.assets?.cashAndBank || []).map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>{a.account_name}</span><strong>{formatMoney(a.current_balance)}</strong>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>{t('Stock Value')}</span><strong>{formatMoney(data.assets?.stockValue)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>{t('Receivables')}</span><strong>{formatMoney(data.assets?.receivables)}</strong>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                <span>{t('Total Assets')}</span><span>{formatMoney(data.assets?.total)}</span>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><div className="card-title">{t('Liabilities & Equity')}</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>{t('Payables')}</span><strong>{formatMoney(data.liabilities?.payables)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>{t('Retained Earnings')}</span><strong>{formatMoney(data.equity?.retainedEarnings)}</strong>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                <span>{t('Total')}</span><span>{formatMoney((data.liabilities?.total || 0) + (data.equity?.total || 0))}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'gst') {
      return (
        <div>
          <div className="stats-grid">
            <div className="stat-card"><div><div className="stat-label">{t('Output Tax')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.outputTax)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Input Tax')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.inputTax)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Net Tax Liability')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.netTax)}</div></div></div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><div className="card-title">{t('Outward Supply')}</div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Invoice')}</th><th>{t('Date')}</th><th>{t('Party')}</th><th>{t('Taxable')}</th><th>{t('Tax')}</th><th>{t('Total')}</th></tr></thead>
                <tbody>
                  {(data.outwardSupply || []).map((r, i) => (
                    <tr key={i}>
                      <td>{r.invoice_number}</td><td>{r.invoice_date}</td><td>{r.party || '—'}</td>
                      <td>{formatMoney(r.subtotal)}</td><td>{formatMoney(r.tax_amount)}</td><td style={{ fontWeight: 600 }}>{formatMoney(r.grand_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'sales') {
      return (
        <div>
          <div className="stats-grid">
            <div className="stat-card"><div><div className="stat-label">{t('Invoices')}</div><div className="stat-value">{data.summary?.count || 0}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total Sales')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.summary?.total)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Tax')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.summary?.tax)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Collected')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.summary?.paid)}</div></div></div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Date')}</th><th>{t('Invoices')}</th><th>{t('Total')}</th><th>{t('Tax')}</th><th>{t('Paid')}</th></tr></thead>
                <tbody>
                  {(data.rows || []).map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td><td>{r.invoices}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(r.total)}</td>
                      <td>{formatMoney(r.tax)}</td><td>{formatMoney(r.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'purchases') {
      return (
        <div>
          <div className="stats-grid">
            <div className="stat-card"><div><div className="stat-label">{t('Bills')}</div><div className="stat-value">{data.summary?.count || 0}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.summary?.total)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Paid')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.summary?.paid)}</div></div></div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Date')}</th><th>{t('Bill')}</th><th>{t('Supplier')}</th><th>{t('Total')}</th><th>{t('Paid')}</th><th>{t('Status')}</th></tr></thead>
                <tbody>
                  {(data.rows || []).map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td><td>{r.bill_number}</td><td>{r.supplier || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(r.total)}</td>
                      <td>{formatMoney(r.paid)}</td>
                      <td><span className={`badge ${r.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{r.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'expenses') {
      return (
        <div>
          <div className="stats-grid">
            <div className="stat-card"><div><div className="stat-label">{t('Total Expenses')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(data.total)}</div></div></div>
          </div>
          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-header"><div className="card-title">{t('By Category')}</div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Category')}</th><th>{t('Count')}</th><th>{t('Total')}</th></tr></thead>
                  <tbody>
                    {(data.byCategory || []).map((e, i) => (
                      <tr key={i}><td>{e.category}</td><td>{e.count}</td><td style={{ fontWeight: 600 }}>{formatMoney(e.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title">{t('Details')}</div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Date')}</th><th>{t('Category')}</th><th>{t('Amount')}</th></tr></thead>
                  <tbody>
                    {(data.rows || []).map((e) => (
                      <tr key={e.id}><td>{e.expense_date}</td><td>{e.category}</td><td style={{ fontWeight: 600 }}>{formatMoney(e.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'stock') {
      const rows = Array.isArray(data) ? data : [];
      return (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Product')}</th><th>{t('SKU')}</th><th>{t('Category')}</th><th>{t('Qty')}</th><th>{t('Purchase')}</th><th>{t('Selling')}</th><th>{t('Value')}</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td>{p.sku || '—'}</td>
                    <td>{p.category_name || '—'}</td>
                    <td><span className={`badge ${p.quantity <= p.min_stock && p.min_stock > 0 ? 'badge-error' : 'badge-success'}`}>{p.quantity}</span></td>
                    <td>{formatMoney(p.purchase_price)}</td>
                    <td>{formatMoney(p.selling_price)}</td>
                    <td style={{ fontWeight: 600 }}>{formatMoney(p.stock_value || p.quantity * p.purchase_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (active === 'customers' || active === 'suppliers') {
      const rows = Array.isArray(data) ? data : [];
      return (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Name')}</th><th>{t('Phone')}</th>
                  <th>{active === 'customers' ? 'Sales' : 'Purchases'}</th>
                  <th>{t('Invoices')}</th><th>{t('Balance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td>{r.phone || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{formatMoney(r.total_sales || r.total_purchases)}</td>
                    <td>{r.total_invoices || r.total_bills || 0}</td>
                    <td style={{ fontWeight: 600, color: r.current_balance > 0 ? 'var(--error)' : 'inherit' }}>{formatMoney(r.current_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Reports')}</h1>
          <p className="page-subtitle">{t('Business analytics and financial reports')}</p>
        </div>
        {active && !['stock', 'customers', 'suppliers', 'balance-sheet'].includes(active) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="form-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <span>to</span>
            <input className="form-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </div>
        )}
      </div>

      {!active ? (
        <div className="stats-grid">
          {REPORTS.map((r) => (
            <div key={r.id} className="stat-card" style={{ cursor: 'pointer' }} onClick={() => load(r.id)}>
              <div className={`stat-icon ${r.color}`}><r.icon size={24} /></div>
              <div>
                <div className="stat-value" style={{ fontSize: 16 }}>{r.label}</div>
                <div className="stat-sub">{t('Click to view')}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <button className="btn btn-secondary btn-sm" onClick={() => { setActive(null); setData(null); }} style={{ marginBottom: 16 }}>
            ← All Reports
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            {REPORTS.find((r) => r.id === active)?.label}
          </h2>
          {renderReport()}
        </div>
      )}
    </div>
  );
}
