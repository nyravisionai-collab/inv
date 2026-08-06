import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, FileText, Package, Users, Truck, Receipt, Download, MessageCircle, SlidersHorizontal, RotateCcw, TriangleAlert } from 'lucide-react';
import { reportsAPI, partiesAPI, inventoryAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';

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
  { id: 'parties', label: 'Party Report', icon: Users, color: 'blue' },
  { id: 'outstanding', label: 'Outstanding & Payable', icon: Receipt, color: 'red' },
  { id: 'product-profit', label: 'Product Profit', icon: TrendingUp, color: 'green' },
  { id: 'party-profit', label: 'Party Profit', icon: Users, color: 'blue' },
  { id: 'expiry', label: 'Expiry & Batch Report', icon: Package, color: 'red' },
  { id: 'warehouse-stock', label: 'Warehouse Stock Report', icon: Package, color: 'teal' },
];

export default function Reports() {
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { formatMoney, t } = useAuth();
  const [exportMessage, setExportMessage] = useState('');

  const [selectedParties, setSelectedParties] = useState({});
  const [expiryDays, setExpiryDays] = useState(90);
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [warehousesList, setWarehousesList] = useState([]);
  const [adjustBatchModal, setAdjustBatchModal] = useState(null);
  const [adjustReason, setAdjustReason] = useState('Expired stock write-off');
  const { success, error } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    inventoryAPI.warehouses().then((r) => setWarehousesList(r.data.data)).catch(() => {});
  }, []);

  const exportPdf = async () => {
    if (!active) return;
    try {
      const params = active === 'balance-sheet' ? { as_of: to } : { from_date: from, to_date: to };
      const result = await reportsAPI.pdf(active, params);
      setExportMessage(`${t('PDF saved')}: ${result.data?.data?.fileName || ''}`);
    } catch { setExportMessage(t('PDF export failed')); }
  };

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
        case 'parties': res = await reportsAPI.parties(); break;
        case 'outstanding': res = await reportsAPI.outstanding(); break;
        case 'product-profit': res = await reportsAPI.productProfit(params); break;
        case 'party-profit': res = await reportsAPI.partyProfit(params); break;
        case 'expiry': res = await reportsAPI.expiry({ days: expiryDays }); break;
        case 'warehouse-stock': res = await reportsAPI.warehouseStock(); break;
        default: break;
      }
      setData(res?.data?.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (active) load(active);
  }, [from, to]);

  useEffect(() => {
    if (active === 'expiry') load('expiry');
  }, [expiryDays]);

  const handlePartyRemind = async (id) => {
    try {
      const r = await partiesAPI.remind(id);
      if (r.data?.data?.link) {
        window.open(r.data.data.link, '_blank');
      }
      load(active);
    } catch {
      error(t('Failed to send reminder'));
    }
  };

  const handleBulkRemindParties = () => {
    const ids = Object.entries(selectedParties).filter(([_, v]) => v).map(([id]) => id);
    if (!ids.length) return error(t('Select at least one party'));
    ids.forEach((id, idx) => {
      setTimeout(() => handlePartyRemind(id), idx * 800);
    });
  };

  const getExpiryBadge = (dateStr) => {
    const now = new Date();
    const exp = new Date(dateStr);
    const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: 'Expired', clazz: 'badge-error' };
    if (diffDays <= 7) return { label: `${diffDays} days left`, clazz: 'badge-error' };
    if (diffDays <= 30) return { label: `${diffDays} days left`, clazz: 'badge-warning' };
    if (diffDays <= 90) return { label: `${diffDays} days left`, clazz: 'badge-info' };
    return { label: `${diffDays} days left`, clazz: 'badge-success' };
  };

  const handleAdjustExpiredStock = async () => {
    if (!adjustBatchModal) return;
    try {
      await inventoryAPI.createAdjustment({
        warehouse_id: '',
        reason: adjustReason,
        notes: `Expired batch write-off: ${adjustBatchModal.batch_number}`,
        items: [{
          product_id: adjustBatchModal.product_id,
          batch_id: adjustBatchModal.id,
          new_qty: 0,
        }],
      });
      success(t('Stock adjusted to 0'));
      setAdjustBatchModal(null);
      load('expiry');
    } catch {
      error(t('Failed to adjust stock'));
    }
  };

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
                      <tr key={i}><td data-label={t('Category')}>{e.category}</td><td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(e.total)}</td></tr>
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
                      <td data-label={t('Invoice')}>{r.invoice_number}</td><td data-label={t('Date')}>{r.invoice_date}</td><td data-label={t('Party')}>{r.party || '—'}</td>
                      <td data-label={t('Taxable')}>{formatMoney(r.subtotal)}</td><td data-label={t('Tax')}>{formatMoney(r.tax_amount)}</td><td data-label={t('Total')} style={{ fontWeight: 600 }}>{formatMoney(r.grand_total)}</td>
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
                      <td data-label={t('Date')}>{r.date}</td><td data-label={t('Invoices')}>{r.invoices}</td>
                      <td data-label={t('Total')} style={{ fontWeight: 600 }}>{formatMoney(r.total)}</td>
                      <td data-label={t('Tax')}>{formatMoney(r.tax)}</td><td data-label={t('Paid')}>{formatMoney(r.paid)}</td>
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
                <thead><tr><th>{t('Date')}</th><th>{t('Bill')}</th><th>{t('Party')}</th><th>{t('Total')}</th><th>{t('Paid')}</th><th>{t('Status')}</th></tr></thead>
                <tbody>
                  {(data.rows || []).map((r, i) => (
                    <tr key={i}>
                      <td data-label={t('Date')}>{r.date}</td><td data-label={t('Bill')}>{r.bill_number}</td><td data-label={t('Party')}>{r.party || '—'}</td>
                      <td data-label={t('Total')} style={{ fontWeight: 600 }}>{formatMoney(r.total)}</td>
                      <td data-label={t('Paid')}>{formatMoney(r.paid)}</td>
                      <td data-label={t('Status')}><span className={`badge ${r.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{t(r.payment_status)}</span></td>
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
                      <tr key={i}><td data-label={t('Category')}>{e.category}</td><td data-label={t('Count')}>{e.count}</td><td data-label={t('Total')} style={{ fontWeight: 600 }}>{formatMoney(e.total)}</td></tr>
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
                      <tr key={e.id}><td data-label={t('Date')}>{e.expense_date}</td><td data-label={t('Category')}>{e.category}</td><td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(e.amount)}</td></tr>
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
                    <td data-label={t('Product')} style={{ fontWeight: 500 }}>{p.name}</td>
                    <td data-label={t('SKU')}>{p.sku || '—'}</td>
                    <td data-label={t('Category')}>{p.category_name || '—'}</td>
                    <td data-label={t('Qty')}><span className={`badge ${p.quantity <= p.min_stock && p.min_stock > 0 ? 'badge-error' : 'badge-success'}`}>{p.quantity}</span></td>
                    <td data-label={t('Purchase')}>{formatMoney(p.purchase_price)}</td>
                    <td data-label={t('Selling')}>{formatMoney(p.selling_price)}</td>
                    <td data-label={t('Value')} style={{ fontWeight: 600 }}>{formatMoney(p.stock_value || p.quantity * p.purchase_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (active === 'parties') {
      const rows = Array.isArray(data) ? data : [];
      return (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Name')}</th><th>{t('Phone')}</th>
                  <th>{t('Sales')}</th>
                  <th>{t('Invoices')}</th><th>{t('Balance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t('Name')} style={{ fontWeight: 500 }}>{r.name}</td>
                    <td data-label={t('Phone')}>{r.phone || '—'}</td>
                    <td data-label={t('Sales')} style={{ fontWeight: 600 }}>{formatMoney(r.total_sales || r.total_purchases)}</td>
                    <td data-label={t('Invoices')}>{r.total_invoices || r.total_bills || 0}</td>
                    <td data-label={t('Balance')} style={{ fontWeight: 600, color: r.current_balance > 0 ? 'var(--error)' : 'inherit' }}>{formatMoney(r.current_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (active === 'outstanding') {
      const custTotal = data.customerOutstanding || 0;
      const suppTotal = data.supplierPayable || 0;
      const netTotal = custTotal - suppTotal;

      return (
        <div>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
            <div className="stat-card">
              <div>
                <div className="stat-label">{t('Total Receivable (Parties)')}</div>
                <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatMoney(custTotal)}</div>
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">{t('Total Payable (Parties)')}</div>
                <div className="stat-value" style={{ fontSize: 20, color: 'var(--error)' }}>{formatMoney(suppTotal)}</div>
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">{t('Net Balance')}</div>
                <div className="stat-value" style={{ fontSize: 20, color: netTotal >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(netTotal)}</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div className="card-title">{t('Party Outstanding')}</div>
              <button className="btn btn-sm btn-primary" onClick={handleBulkRemindParties}>
                <MessageCircle size={16} /> {t('Remind Selected Overdue Parties')}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}><input type="checkbox" onChange={(e) => {
                      const all = {};
                      if (e.target.checked) (data.receivables || []).forEach((c) => { all[c.id] = true; });
                      setSelectedParties(all);
                    }} /></th>
                    <th>{t('Party')}</th>
                    <th>{t('Phone')}</th>
                    <th>{t('Pending Invoices')}</th>
                    <th>{t('Outstanding')}</th>
                    <th>{t('Last Reminded')}</th>
                    <th>{t('Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.receivables || []).length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No party dues')}</td></tr>
                  )}
                  {(data.receivables || []).map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={!!selectedParties[c.id]} onChange={(e) => setSelectedParties({ ...selectedParties, [c.id]: e.target.checked })} /></td>
                      <td style={{ fontWeight: 500 }}>{c.name}</td>
                      <td>{c.phone || '—'}</td>
                      <td>
                        {(c.pending_invoices || []).length > 0 ? (
                          <div style={{ fontSize: 12 }}>
                            {c.pending_invoices.slice(0, 2).map((inv, idx) => (
                              <div key={idx}>{inv.invoice_number} ({inv.invoice_date}): {formatMoney(inv.balance_amount)}</div>
                            ))}
                            {c.pending_invoices.length > 2 && <div style={{ color: 'var(--text-secondary)' }}>+{c.pending_invoices.length - 2} more</div>}
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--error)' }}>{formatMoney(c.outstanding)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.last_reminder_at ? new Date(c.last_reminder_at).toLocaleString() : t('Never')}</td>
                      <td>
                        <button className="btn btn-sm btn-success" onClick={() => handlePartyRemind(c.id)} style={{ gap: 4 }}>
                          <MessageCircle size={14} /> WhatsApp
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">{t('Party Payable')}</div>
              <button className="btn btn-sm btn-primary" onClick={handleBulkRemindParties}>
                <MessageCircle size={16} /> {t('Remind Selected Payable Parties')}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}><input type="checkbox" onChange={(e) => {
                      const all = {};
                      if (e.target.checked) (data.payables || []).forEach((s) => { all[s.id] = true; });
                      setSelectedParties(all);
                    }} /></th>
                    <th>{t('Party')}</th>
                    <th>{t('Phone')}</th>
                    <th>{t('Pending Bills')}</th>
                    <th>{t('Payable')}</th>
                    <th>{t('Last Reminded')}</th>
                    <th>{t('Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.payables || []).length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No party dues')}</td></tr>
                  )}
                  {(data.payables || []).map((s) => (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={!!selectedParties[s.id]} onChange={(e) => setSelectedParties({ ...selectedParties, [s.id]: e.target.checked })} /></td>
                      <td style={{ fontWeight: 500 }}>{s.name}</td>
                      <td>{s.phone || '—'}</td>
                      <td>
                        {(s.pending_bills || []).length > 0 ? (
                          <div style={{ fontSize: 12 }}>
                            {s.pending_bills.slice(0, 2).map((b, idx) => (
                              <div key={idx}>{b.bill_number} ({b.bill_date}): {formatMoney(b.balance_amount)}</div>
                            ))}
                            {s.pending_bills.length > 2 && <div style={{ color: 'var(--text-secondary)' }}>+{s.pending_bills.length - 2} more</div>}
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--error)' }}>{formatMoney(s.payable || s.outstanding)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.last_reminder_at ? new Date(s.last_reminder_at).toLocaleString() : t('Never')}</td>
                      <td>
                        <button className="btn btn-sm btn-success" onClick={() => handlePartyRemind(s.id)} style={{ gap: 4 }}>
                          <MessageCircle size={14} /> WhatsApp
                        </button>
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

    if (active === 'product-profit') {
      const rows = data.rows || [];
      const totalSales = rows.reduce((s, r) => s + Number(r.sales || 0), 0);
      const totalCost = rows.reduce((s, r) => s + Number(r.cost || 0), 0);
      const totalProfit = rows.reduce((s, r) => s + Number(r.profit || 0), 0);
      const avgMargin = totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(1) : '0.0';

      return (
        <div>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            <div className="stat-card"><div><div className="stat-label">{t('Total Sales')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(totalSales)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total Cost')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(totalCost)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total Profit')}</div><div className="stat-value" style={{ fontSize: 18, color: totalProfit >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(totalProfit)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Profit Margin')}</div><div className="stat-value" style={{ fontSize: 18 }}>{avgMargin}%</div></div></div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Product')}</th><th>{t('Qty Sold')}</th><th>{t('Sales')}</th><th>{t('Cost')}</th><th>{t('Profit')}</th><th>{t('Margin %')}</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No sales data')}</td></tr>
                  )}
                  {rows.map((r, i) => {
                    const margin = Number(r.sales) > 0 ? ((Number(r.profit) / Number(r.sales)) * 100).toFixed(1) : '0.0';
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                        <td>{r.quantity}</td>
                        <td>{formatMoney(r.sales)}</td>
                        <td>{formatMoney(r.cost)}</td>
                        <td style={{ fontWeight: 700, color: Number(r.profit) >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(r.profit)}</td>
                        <td>{margin}%</td>
                      </tr>
                    );
                  })}
                  {rows.length > 0 && (
                    <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                      <td>{t('Total')}</td>
                      <td>{rows.reduce((s, r) => s + Number(r.quantity || 0), 0)}</td>
                      <td>{formatMoney(totalSales)}</td>
                      <td>{formatMoney(totalCost)}</td>
                      <td style={{ color: totalProfit >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(totalProfit)}</td>
                      <td>{avgMargin}%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'party-profit') {
      const rows = data.rows || [];
      const totalInvoices = rows.reduce((s, r) => s + Number(r.invoices || 0), 0);
      const totalSales = rows.reduce((s, r) => s + Number(r.sales || 0), 0);
      const totalCost = rows.reduce((s, r) => s + Number(r.cost || 0), 0);
      const totalProfit = rows.reduce((s, r) => s + Number(r.profit || 0), 0);
      const avgMargin = totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(1) : '0.0';

      return (
        <div>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            <div className="stat-card"><div><div className="stat-label">{t('Parties')}</div><div className="stat-value">{rows.length}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total Sales')}</div><div className="stat-value" style={{ fontSize: 18 }}>{formatMoney(totalSales)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total Profit')}</div><div className="stat-value" style={{ fontSize: 18, color: totalProfit >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(totalProfit)}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Profit Margin')}</div><div className="stat-value" style={{ fontSize: 18 }}>{avgMargin}%</div></div></div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Party')}</th><th>{t('Invoices')}</th><th>{t('Sales')}</th><th>{t('Cost')}</th><th>{t('Profit')}</th><th>{t('Margin %')}</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No sales data')}</td></tr>
                  )}
                  {rows.map((r, i) => {
                    const margin = Number(r.sales) > 0 ? ((Number(r.profit) / Number(r.sales)) * 100).toFixed(1) : '0.0';
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{r.party_name}</td>
                        <td>{r.invoices}</td>
                        <td>{formatMoney(r.sales)}</td>
                        <td>{formatMoney(r.cost)}</td>
                        <td style={{ fontWeight: 700, color: Number(r.profit) >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(r.profit)}</td>
                        <td>{margin}%</td>
                      </tr>
                    );
                  })}
                  {rows.length > 0 && (
                    <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                      <td>{t('Total')}</td>
                      <td>{totalInvoices}</td>
                      <td>{formatMoney(totalSales)}</td>
                      <td>{formatMoney(totalCost)}</td>
                      <td style={{ color: totalProfit >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(totalProfit)}</td>
                      <td>{avgMargin}%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (active === 'expiry') {
      const allRows = data.rows || [];
      const rows = expiredOnly
        ? allRows.filter((r) => new Date(r.expiry_date) < new Date())
        : allRows;
      const expiredCount = allRows.filter((r) => new Date(r.expiry_date) < new Date()).length;
      const days7Count = allRows.filter((r) => { const d = new Date(r.expiry_date) - new Date(); return d >= 0 && d <= 7 * 86400000; }).length;
      const days30Count = allRows.filter((r) => { const d = new Date(r.expiry_date) - new Date(); return d > 7 * 86400000 && d <= 30 * 86400000; }).length;

      return (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{t('Expiry Range')}:</span>
            {[7, 30, 60, 90].map((d) => (
              <button
                key={d}
                type="button"
                className={`btn btn-sm ${expiryDays === d ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setExpiryDays(d)}
              >
                {d} {t('days')}
              </button>
            ))}
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer', marginBottom: 0 }}>
              <input type="checkbox" checked={expiredOnly} onChange={(e) => setExpiredOnly(e.target.checked)} style={{ marginRight: 6 }} />
              {t('Expired Stock Only')}
            </label>
          </div>

          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            <div className="stat-card"><div><div className="stat-label">{t('Total Batches')}</div><div className="stat-value">{allRows.length}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Expired')}</div><div className="stat-value" style={{ color: 'var(--error)' }}>{expiredCount}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('<= 7 Days')}</div><div className="stat-value" style={{ color: 'var(--error)' }}>{days7Count}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('<= 30 Days')}</div><div className="stat-value" style={{ color: 'var(--warning)' }}>{days30Count}</div></div></div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Product')}</th><th>{t('SKU')}</th><th>{t('Warehouse')}</th><th>{t('Batch')}</th><th>{t('Expiry Date')}</th><th>{t('Quantity')}</th><th>{t('Price')}</th><th>{t('Status')}</th><th>{t('Actions')}</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No expiring batches found')}</td></tr>
                  )}
                  {rows.map((r) => {
                    const badge = getExpiryBadge(r.expiry_date);
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                        <td>{r.sku || '—'}</td>
                        <td>{r.warehouse_name || '—'}</td>
                        <td>{r.batch_number}</td>
                        <td>{r.expiry_date}</td>
                        <td style={{ fontWeight: 600 }}>{r.quantity}</td>
                        <td>{formatMoney(r.purchase_price)}</td>
                        <td><span className={`badge ${badge.clazz}`}>{badge.label}</span></td>
                        <td>
                          <div className="table-actions">
                            <button className="btn-icon" title={t('Adjust Stock (Write-off)')} onClick={() => setAdjustBatchModal(r)}>
                              <SlidersHorizontal size={16} />
                            </button>
                            <button className="btn-icon" title={t('Purchase Return')} onClick={() => navigate('/purchase-returns/new')}>
                              <RotateCcw size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Modal open={!!adjustBatchModal} onClose={() => setAdjustBatchModal(null)} title={t('Write-off Expired Batch')} size="md"
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => setAdjustBatchModal(null)}>{t('Cancel')}</button>
                <button className="btn btn-primary" onClick={handleAdjustExpiredStock}>{t('Confirm Write-off to 0')}</button>
              </>
            }
          >
            {adjustBatchModal && (
              <div>
                <p><strong>{t('Product')}:</strong> {adjustBatchModal.product_name}</p>
                <p><strong>{t('Batch')}:</strong> {adjustBatchModal.batch_number}</p>
                <p><strong>{t('Current Quantity')}:</strong> {adjustBatchModal.quantity}</p>
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label">{t('Reason')}</label>
                  <input className="form-control" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
                </div>
              </div>
            )}
          </Modal>
        </div>
      );
    }

    if (active === 'warehouse-stock') {
      const allRows = data.rows || [];
      const rows = warehouseFilter
        ? allRows.filter((r) => String(r.warehouse_name) === String(warehouseFilter) || String(r.warehouse_id) === String(warehouseFilter))
        : allRows;
      const totalQty = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
      const totalVal = rows.reduce((s, r) => s + Number(r.stock_value || 0), 0);

      const whNames = [...new Set(allRows.map((r) => r.warehouse_name).filter(Boolean))];

      return (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{t('Warehouse Filter')}:</span>
            <select className="form-control" style={{ width: 220 }} value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
              <option value="">{t('All Warehouses')}</option>
              {whNames.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>

          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
            <div className="stat-card"><div><div className="stat-label">{t('Total Stock Quantity')}</div><div className="stat-value">{totalQty}</div></div></div>
            <div className="stat-card"><div><div className="stat-label">{t('Total Stock Valuation')}</div><div className="stat-value" style={{ fontSize: 20, color: 'var(--primary)' }}>{formatMoney(totalVal)}</div></div></div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Warehouse')}</th><th>{t('SKU')}</th><th>{t('Product')}</th><th>{t('Quantity')}</th><th>{t('Purchase Price')}</th><th>{t('Stock Value')}</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No stock records')}</td></tr>
                  )}
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.warehouse_name}</td>
                      <td>{r.sku || '—'}</td>
                      <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                      <td><span className="badge badge-success">{r.quantity}</span></td>
                      <td>{formatMoney(r.purchase_price)}</td>
                      <td style={{ fontWeight: 700 }}>{formatMoney(r.stock_value)}</td>
                    </tr>
                  ))}
                  {rows.length > 0 && (
                    <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                      <td colSpan={3}>{t('Total')}</td>
                      <td>{totalQty}</td>
                      <td>—</td>
                      <td>{formatMoney(totalVal)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    const rows = data.rows || data.parties || [];
    return <div className="card"><div className="card-body"><pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{JSON.stringify(data.rows ? rows : data, null, 2)}</pre></div></div>;
  };

  return (
    <div>
      <div className="page-header">
        {active && <button className="btn btn-secondary" onClick={exportPdf}><Download size={18} /> {t('Export PDF')}</button>}
        <div>
          <h1 className="page-title">{t('Reports')}</h1>
          <p className="page-subtitle">{t('Business analytics and financial reports')}</p>
        </div>
        {active && !['stock', 'parties', 'balance-sheet'].includes(active) && (
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
                <div className="stat-value" style={{ fontSize: 16 }}>{t(r.label)}</div>
                <div className="stat-sub">{t('Click to view')}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <button className="btn btn-secondary btn-sm" onClick={() => { setActive(null); setData(null); }} style={{ marginBottom: 16 }}>
            ← {t('All Reports')}
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            {t(REPORTS.find((r) => r.id === active)?.label || '')}
          </h2>
          {exportMessage && <div className="alert alert-success">{exportMessage}</div>}
      {renderReport()}
        </div>
      )}
    </div>
  );
}
