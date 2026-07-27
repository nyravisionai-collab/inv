import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Plus, Search, Eye, XCircle } from 'lucide-react';
import { purchasesAPI, suppliersAPI, productsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { calcLineTotal, calcInvoiceTotals } from '../utils/money';
import { useConfirm } from '../context/ConfirmContext';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const TYPE_MAP = {
  '/purchases': { type: 'purchase', title: 'Purchase Bills', createLabel: 'New Purchase' },
  '/purchase-orders': { type: 'purchase_order', title: 'Purchase Orders', createLabel: 'New PO' },
  '/purchase-returns': { type: 'purchase_return', title: 'Purchase Returns', createLabel: 'New Debit Note' },
};

function today() { return new Date().toISOString().slice(0, 10); }

const emptyLine = {
  product_id: '', product_name: '', quantity: 1, unit_price: 0, mrp: '', tax_rate: 0,
  tax_type: 'exclusive', discount_value: 0, discount_type: 'amount', batch_number: '', expiry_date: '',
};

function PurchaseList() {
  const location = useLocation();
  const cfg = TYPE_MAP[location.pathname] || TYPE_MAP['/purchases'];
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const { formatMoney, t } = useAuth();
  const { error, success } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const load = (page = 1) => {
    setLoading(true);
    purchasesAPI.list({ page, limit: 20, search: search || undefined, type: cfg.type })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error(t('Failed to load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [location.pathname]);
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [search]);

  const cancel = async (id) => {
    if (!(await confirm(t('Cancel this bill?')))) return;
    try { await purchasesAPI.cancel(id); success(t('Cancelled')); load(pagination.page); }
    catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{cfg.title}</h1><p className="page-subtitle">{pagination.total} records</p></div>
        <button className="btn btn-primary" onClick={() => navigate(`${location.pathname}/new`)}><Plus size={18} /> {cfg.createLabel}</button>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Search size={18} /><input placeholder={t('Search...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState title="No records" action={<button className="btn btn-primary" onClick={() => navigate(`${location.pathname}/new`)}>{cfg.createLabel}</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Supplier')}</th><th>{t('Amount')}</th><th>{t('Paid')}</th><th>{t('Balance')}</th><th>{t('Status')}</th><th>{t('Payment')}</th><th>{t('Actions')}</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate(`/purchases/${p.id}`)}>{p.bill_number}</td>
                      <td>{p.bill_date}</td>
                      <td>{p.supplier_name || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(p.grand_total)}</td>
                      <td>{formatMoney(p.paid_amount)}</td>
                      <td>{formatMoney(p.balance_amount)}</td>
                      <td><span className={`badge ${p.status === 'completed' ? 'badge-success' : p.status === 'cancelled' ? 'badge-error' : 'badge-warning'}`}>{p.status}</span></td>
                      <td><span className={`badge ${p.payment_status === 'paid' ? 'badge-success' : p.payment_status === 'partial' ? 'badge-warning' : 'badge-error'}`}>{p.payment_status}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn-icon" onClick={() => navigate(`/purchases/${p.id}`)}><Eye size={16} /></button>
                          {p.status !== 'cancelled' && <button className="btn-icon" onClick={() => cancel(p.id)}><XCircle size={16} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pagination} onChange={load} />
          </>
        )}
      </div>
    </div>
  );
}

function PurchaseForm() {
  const location = useLocation();
  const basePath = '/' + location.pathname.split('/')[1];
  const cfg = TYPE_MAP[basePath] || TYPE_MAP['/purchases'];
  const navigate = useNavigate();
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '', bill_date: today(), due_date: '', supplier_invoice: '',
    discount_type: 'amount', discount_value: 0, notes: '', paid_amount: 0, payment_mode: 'cash',
  });
  const [items, setItems] = useState([{ ...emptyLine }]);

  useEffect(() => {
    suppliersAPI.list({ limit: 100 }).then((r) => setSuppliers(r.data.data)).catch(() => {});
    productsAPI.list({ limit: 100 }).then((r) => setProducts(r.data.data)).catch(() => {});
  }, []);

  /** Copy master data onto a line once it is linked to a known product. */
  const fillFromProduct = (line, p) => {
    line.product_id = p.id;
    line.product_name = p.name;
    line.unit_price = p.purchase_price;
    line.tax_rate = p.tax_rate || 0;
    line.tax_type = p.tax_type || 'exclusive';
    line.mrp = p.mrp || '';
    line.hsn_code = p.hsn_code;
    line.unit_id = p.unit_id;
  };

  const updateItem = (idx, field, val) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: val };
    if (field === 'product_id') {
      const p = products.find((x) => x.id === Number(val));
      if (p) fillFromProduct(next[idx], p);
    }
    if (field === 'product_name') {
      // The name box is free text: a match links the line to the existing
      // product, anything else is treated as a new item and is created by the
      // server when the bill is saved.
      const match = products.find(
        (x) => x.name.trim().toLowerCase() === String(val).trim().toLowerCase()
      );
      if (match) fillFromProduct(next[idx], match);
      else next[idx].product_id = '';
    }
    setItems(next);
  };

  const isNewProduct = (item) => {
    const name = String(item.product_name || '').trim();
    return !!name && !item.product_id;
  };

  const calcItemTotal = (item) => calcLineTotal(item).total;

  const grand = calcInvoiceTotals(items, form).grand;

  const save = async () => {
    const validItems = items.filter((i) => i.product_name && i.quantity > 0);
    if (!validItems.length) return error(t('Add at least one item'));
    setSaving(true);
    try {
      const res = await purchasesAPI.create({
        ...form, bill_type: cfg.type, supplier_id: form.supplier_id || null,
        items: validItems.map((i) => ({ ...i, mrp: Number(i.mrp) || 0 })),
        paid_amount: Number(form.paid_amount) || 0,
        discount_value: Number(form.discount_value) || 0, status: 'completed',
      });
      success(`Created: ${res.data.data.bill_number}`);
      navigate(basePath);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Failed'));
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{cfg.createLabel}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => navigate(basePath)}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('Supplier')}</label>
              <select className="form-control" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">{t('Select supplier')}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Date')}</label>
              <input className="form-control" type="date" value={form.bill_date} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Supplier Invoice #</label>
              <input className="form-control" value={form.supplier_invoice} onChange={(e) => setForm({ ...form, supplier_invoice: e.target.value })} />
            </div>
          </div>
        </div>
      </div>
      <datalist id="purchase-product-options">
        {products.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">{t('Items')}</div></div>
        <div className="table-wrap">
          <table className="items-table">
            <thead><tr><th>{t('Product')}</th><th>{t('Qty')}</th><th>{t('Price')}</th><th>{t('MRP')}</th><th>{t('Tax %')}</th><th>{t('Batch')}</th><th>{t('Total')}</th><th></th></tr></thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      className="form-control"
                      list="purchase-product-options"
                      style={{ height: 34, minWidth: 180 }}
                      placeholder={t('Type or select product')}
                      value={item.product_name}
                      onChange={(e) => updateItem(idx, 'product_name', e.target.value)}
                    />
                    {isNewProduct(item) && (
                      <div className="form-hint" style={{ color: 'var(--primary)' }}>{t('New product — will be added automatically')}</div>
                    )}
                  </td>
                  <td><input className="form-control" type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} /></td>
                  <td><input className="form-control" type="number" value={item.unit_price} onChange={(e) => updateItem(idx, 'unit_price', e.target.value)} /></td>
                  <td><input className="form-control" type="number" value={item.mrp} onChange={(e) => updateItem(idx, 'mrp', e.target.value)} placeholder={t('MRP')} /></td>
                  <td><input className="form-control" type="number" value={item.tax_rate} onChange={(e) => updateItem(idx, 'tax_rate', e.target.value)} /></td>
                  <td><input className="form-control" value={item.batch_number} onChange={(e) => updateItem(idx, 'batch_number', e.target.value)} placeholder={t('Batch#')} /></td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(calcItemTotal(item))}</td>
                  <td><button className="btn-icon" onClick={() => items.length > 1 && setItems(items.filter((_, i) => i !== idx))}><XCircle size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => setItems([...items, { ...emptyLine }])}>+ Add Row</button>
        </div>
      </div>
      <div className="card">
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('Paid Amount')}</label>
              <input className="form-control" type="number" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Payment Mode')}</label>
              <select className="form-control" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
                <option value="cash">{t('Cash')}</option><option value="upi">{t('UPI')}</option><option value="bank">{t('Bank')}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Grand Total')}</label>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)', lineHeight: '40px' }}>{formatMoney(grand)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PurchaseDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { formatMoney, t } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    purchasesAPI.get(id).then((r) => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="spinner" />;
  if (!data) return <div className="empty-state"><h3>{t('Not found')}</h3></div>;

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{data.bill_number}</h1><p className="page-subtitle">{data.bill_date} · {data.supplier_name}</p></div>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>{t('Back')}</button>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card"><div><div className="stat-label">{t('Total')}</div><div className="stat-value">{formatMoney(data.grand_total)}</div></div></div>
        <div className="stat-card"><div><div className="stat-label">{t('Paid')}</div><div className="stat-value">{formatMoney(data.paid_amount)}</div></div></div>
        <div className="stat-card"><div><div className="stat-label">{t('Balance')}</div><div className="stat-value">{formatMoney(data.balance_amount)}</div></div></div>
        <div className="stat-card"><div><div className="stat-label">{t('Status')}</div><div className="stat-value" style={{ fontSize: 16 }}><span className={`badge ${data.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{data.payment_status}</span></div></div></div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>{t('Item')}</th><th>{t('Qty')}</th><th>{t('Price')}</th><th>{t('Tax')}</th><th>{t('Total')}</th></tr></thead>
            <tbody>
              {(data.items || []).map((item, i) => (
                <tr key={item.id}>
                  <td>{i + 1}</td><td>{item.product_name}</td><td>{item.quantity}</td>
                  <td>{formatMoney(item.unit_price)}</td><td>{formatMoney(item.tax_amount)}</td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Purchases() {
  const params = useParams();
  const location = useLocation();
  if (location.pathname.endsWith('/new')) return <PurchaseForm />;
  if (params.id) return <PurchaseDetail />;
  return <PurchaseList />;
}
