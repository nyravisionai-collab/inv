import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Plus, Search, Eye, FileText, MessageCircle, XCircle, Printer } from 'lucide-react';
import { salesAPI, customersAPI, productsAPI, inventoryAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { calcLineTotal, calcInvoiceTotals } from '../utils/money';
import { withRowId } from '../utils/rowId';
import { useConfirm } from '../context/ConfirmContext';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const TYPE_MAP = {
  // A POS bill is a sale, so the invoice list covers both and the counter
  // sales are no longer invisible outside the POS screen.
  '/sales': { type: 'sale,pos', createType: 'sale', title: 'Sale Invoices', createLabel: 'New Sale' },
  '/estimates': { type: 'estimate', title: 'Estimates / Quotations', createLabel: 'New Estimate' },
  '/sale-orders': { type: 'sale_order', title: 'Sale Orders', createLabel: 'New Sale Order' },
  '/sale-returns': { type: 'sale_return', title: 'Sale Returns', createLabel: 'New Credit Note' },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

const emptyLine = {
  product_id: '', product_name: '', quantity: 1, unit_price: 0, tax_rate: 0,
  tax_type: 'exclusive', discount_value: 0, discount_type: 'amount',
};

function SalesList() {
  const location = useLocation();
  const cfg = TYPE_MAP[location.pathname] || TYPE_MAP['/sales'];
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
    salesAPI.list({ page, limit: 20, search: search || undefined, type: cfg.type })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error(t('Failed to load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [location.pathname]);
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [search]);

  const cancel = async (id) => {
    if (!(await confirm(t('Cancel this document? Stock will be reversed.')))) return;
    try {
      await salesAPI.cancel(id);
      success(t('Cancelled'));
      load(pagination.page);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Cancel failed'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(cfg.title)}</h1>
          <p className="page-subtitle">{pagination.total} {t('records')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate(`${location.pathname}/new`)}>
          <Plus size={18} /> {t(cfg.createLabel)}
        </button>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Search size={18} />
            <input placeholder={t('Search invoices...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState title={t('No records')} action={<button className="btn btn-primary" onClick={() => navigate(`${location.pathname}/new`)}>{t(cfg.createLabel)}</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Source')}</th><th>{t('Customer')}</th><th>{t('Amount')}</th>
                    <th>{t('Paid')}</th><th>{t('Balance')}</th><th>{t('Status')}</th><th>{t('Payment')}</th><th>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.id}>
                      <td data-label={t('Number')} style={{ fontWeight: 600, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate(`/sales/${s.id}`)}>{s.invoice_number}</td>
                      <td data-label={t('Date')}>{s.invoice_date}</td>
                      <td data-label={t('Source')}>
                        <span className="badge badge-info">
                          {s.invoice_type === 'pos' ? t('POS') : t('Invoice')}
                        </span>
                      </td>
                      <td data-label={t('Customer')}>{s.customer_name || t('Walk-in Customer')}</td>
                      <td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(s.grand_total)}</td>
                      <td data-label={t('Paid')}>{formatMoney(s.paid_amount)}</td>
                      <td data-label={t('Balance')}>{formatMoney(s.balance_amount)}</td>
                      <td data-label={t('Status')}><span className={`badge ${s.status === 'completed' ? 'badge-success' : s.status === 'cancelled' ? 'badge-error' : 'badge-warning'}`}>{t(s.status)}</span></td>
                      <td data-label={t('Payment')}><span className={`badge ${s.payment_status === 'paid' ? 'badge-success' : s.payment_status === 'partial' ? 'badge-warning' : 'badge-error'}`}>{t(s.payment_status)}</span></td>
                      <td data-label={t('Actions')}>
                        <div className="table-actions">
                          <button className="btn-icon" onClick={() => navigate(`/sales/${s.id}`)} title="View"><Eye size={16} /></button>
                          <a className="btn-icon" href={salesAPI.pdf(s.id)} target="_blank" rel="noreferrer" title="PDF"><FileText size={16} /></a>
                          {s.status !== 'cancelled' && (
                            <button className="btn-icon" onClick={() => cancel(s.id)} title="Cancel"><XCircle size={16} /></button>
                          )}
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

function SaleForm() {
  const location = useLocation();
  const basePath = '/' + location.pathname.split('/')[1];
  const cfg = TYPE_MAP[basePath] || TYPE_MAP['/sales'];
  const navigate = useNavigate();
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_id: '', invoice_date: today(), due_date: '', warehouse_id: '',
    discount_type: 'amount', discount_value: 0, shipping_charges: 0,
    notes: '', paid_amount: 0, payment_mode: 'cash',
  });
  const [items, setItems] = useState(() => [withRowId(emptyLine)]);
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    customersAPI.list({ limit: 100 }).then((r) => setCustomers(r.data.data)).catch(() => {});
    productsAPI.list({ limit: 100 }).then((r) => setProducts(r.data.data)).catch(() => {});
    inventoryAPI.warehouses().then((r) => setWarehouses(r.data.data)).catch(() => {});
  }, []);

  const addItem = (product) => {
    setItems((prev) => {
      const exists = prev.findIndex((i) => i.product_id === product.id);
      if (exists >= 0) {
        // Copy the row instead of mutating it: mutating state in place makes
        // React skip renders and the quantity appears not to change.
        const next = [...prev];
        next[exists] = { ...next[exists], quantity: Number(next[exists].quantity || 0) + 1 };
        return next;
      }
      const emptyIdx = prev.findIndex((i) => !i.product_id && !i.product_name);
      const newItem = {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        unit_price: product.selling_price,
        tax_rate: product.tax_rate || 0,
        tax_type: product.tax_type || 'exclusive',
        discount_value: 0,
        discount_type: 'amount',
        hsn_code: product.hsn_code,
        unit_id: product.unit_id,
      };
      if (emptyIdx >= 0) {
        const next = [...prev];
        next[emptyIdx] = { ...newItem, _rid: prev[emptyIdx]._rid };
        return next;
      }
      return [...prev, withRowId(newItem)];
    });
    setProductSearch('');
  };

  const updateItem = (idx, field, val) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'product_id') {
        const p = products.find((x) => x.id === Number(val));
        if (p) {
          next[idx] = {
            ...next[idx],
            product_name: p.name,
            unit_price: p.selling_price,
            tax_rate: p.tax_rate || 0,
            tax_type: p.tax_type || 'exclusive',
            hsn_code: p.hsn_code,
            unit_id: p.unit_id,
          };
        }
      }
      return next;
    });
  };

  const addBlankItem = () => {
    setItems((prev) => [...prev, withRowId(emptyLine)]);
  };

  const removeItem = (idx) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const handleItemKeyDown = (e, idx) => {
    if (e.key === 'Enter' && idx === items.length - 1) {
      e.preventDefault();
      addBlankItem();
    }
  };

  const calcItemTotal = (item) => {
    const c = calcLineTotal(item);
    return { sub: c.gross, disc: c.discount, tax: c.tax, total: c.total };
  };

  const totals = calcInvoiceTotals(items, form);

  const filteredProducts = productSearch
    ? products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku?.includes(productSearch) || p.barcode?.includes(productSearch))
    : [];

  const save = async () => {
    if (saving) return undefined;
    // `_rid` is a client-only row key; never send it to the API.
    const validItems = items
      .filter((i) => i.product_name && Number(i.quantity) > 0)
      .map(({ _rid, ...rest }) => rest);
    if (!validItems.length) return error(t('Add at least one item'));
    setSaving(true);
    try {
      const res = await salesAPI.create({
        ...form,
        invoice_type: cfg.createType || cfg.type,
        customer_id: form.customer_id || null,
        warehouse_id: form.warehouse_id || null,
        items: validItems,
        paid_amount: Number(form.paid_amount) || 0,
        discount_value: Number(form.discount_value) || 0,
        shipping_charges: Number(form.shipping_charges) || 0,
        status: 'completed',
      });
      success(`${cfg.title.split(' ')[0]} created: ${res.data.data.invoice_number}`);
      navigate(basePath);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Failed to create'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(cfg.createLabel)}</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate(basePath)}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('Customer')}</label>
              <select className="form-control" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">{t('Walk-in Customer')}</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Date')}</label>
              <input className="form-control" type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Due Date')}</label>
              <input className="form-control" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Warehouse')}</label>
              <select className="form-control" value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                <option value="">{t('Default')}</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{t('Items')}</div>
          <div style={{ position: 'relative', width: 280 }}>
            <input className="form-control" placeholder={t('Search & add product...')} value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)} style={{ height: 34 }} />
            {filteredProducts.length > 0 && (
              <div className="search-dropdown">
                {filteredProducts.slice(0, 8).map((p) => (
                  <div key={p.id} className="search-result-item" onClick={() => addItem(p)}>
                    <span>{p.name}</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{formatMoney(p.selling_price)} | Stock: {p.current_stock}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>{t('Product')}</th>
                <th style={{ width: 80 }}>{t('Qty')}</th>
                <th style={{ width: 100 }}>{t('Price')}</th>
                <th style={{ width: 80 }}>{t('Tax %')}</th>
                <th style={{ width: 90 }}>{t('Discount')}</th>
                <th style={{ width: 100 }}>{t('Total')}</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const c = calcItemTotal(item);
                return (
                  <tr key={item._rid} onKeyDown={(e) => handleItemKeyDown(e, idx)}>
                    <td data-label={t('Product')}>
                      <select className="form-control" value={item.product_id} onChange={(e) => updateItem(idx, 'product_id', e.target.value)} style={{ height: 34 }}>
                        <option value="">{t('Select product')}</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td data-label={t('Qty')}><input className="form-control" type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} /></td>
                    <td data-label={t('Price')}><input className="form-control" type="number" min="0" step="any" value={item.unit_price} onChange={(e) => updateItem(idx, 'unit_price', e.target.value)} /></td>
                    <td data-label={t('Tax %')}><input className="form-control" type="number" min="0" value={item.tax_rate} onChange={(e) => updateItem(idx, 'tax_rate', e.target.value)} /></td>
                    <td data-label={t('Discount')}><input className="form-control" type="number" min="0" value={item.discount_value} onChange={(e) => updateItem(idx, 'discount_value', e.target.value)} /></td>
                    <td data-label={t('Total')} style={{ fontWeight: 600 }}>{formatMoney(c.total)}</td>
                    <td data-label={t('Actions')}><button className="btn-icon" onClick={() => removeItem(idx)}><XCircle size={16} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12 }}>
          <button className="btn btn-sm btn-secondary" onClick={addBlankItem}>
            + {t('Add Row')}
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">{t('Notes')}</label>
              <textarea className="form-control" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
            {cfg.type === 'sale' && (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{t('Paid Amount')}</label>
                  <input className="form-control" type="number" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Payment Mode')}</label>
                  <select className="form-control" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
                    <option value="cash">{t('Cash')}</option>
                    <option value="upi">{t('UPI')}</option>
                    <option value="bank">{t('Bank')}</option>
                    <option value="card">{t('Card')}</option>
                    <option value="cheque">{t('Cheque')}</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>{t('Subtotal')}</span><strong>{formatMoney(totals.subtotal)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
              <span>{t('Discount')}</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select className="form-control" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} style={{ width: 70, height: 32 }}>
                  <option value="amount">₹</option>
                  <option value="percent">%</option>
                </select>
                <input className="form-control" type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} style={{ width: 80, height: 32 }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>{t('Tax')}</span><strong>{formatMoney(totals.taxAmount)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
              <span>{t('Shipping')}</span>
              <input className="form-control" type="number" value={form.shipping_charges} onChange={(e) => setForm({ ...form, shipping_charges: e.target.value })} style={{ width: 100, height: 32 }} />
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18 }}>
              <strong>{t('Grand Total')}</strong><strong style={{ color: 'var(--primary)' }}>{formatMoney(totals.grand)}</strong>
            </div>
            {form.paid_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: 'var(--text-secondary)' }}>
                <span>{t('Balance')}</span><span>{formatMoney(totals.grand - (Number(form.paid_amount) || 0))}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SaleDetail() {
  const { id } = useParams();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    salesAPI.get(id).then((r) => setSale(r.data.data)).catch(() => error(t('Not found'))).finally(() => setLoading(false));
  }, [id]);

  const sendWhatsApp = async () => {
    try {
      const r = await salesAPI.whatsapp(id);
      window.open(r.data.data.link, '_blank');
    } catch {
      error(t('Failed to generate WhatsApp link'));
    }
  };

  if (loading) return <div className="spinner" />;
  if (!sale) return <div className="empty-state"><h3>{t('Sale not found')}</h3></div>;

  return (
    <div className="print-area">
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">{sale.invoice_number}</h1>
          <p className="page-subtitle">{sale.invoice_type} · {sale.invoice_date}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>{t('Back')}</button>
          <a className="btn btn-secondary" href={salesAPI.pdf(id)} target="_blank" rel="noreferrer"><Printer size={18} /> PDF</a>
          <button className="btn btn-success" onClick={sendWhatsApp}><MessageCircle size={18} /> WhatsApp</button>
          <button className="btn btn-primary" onClick={() => window.print()}><Printer size={18} /> {t('Print')}</button>
        </div>
      </div>
      <div className="page-header print-only">
        <div>
          <h1 className="page-title">{sale.invoice_number}</h1>
          <p className="page-subtitle">{sale.invoice_type} · {sale.invoice_date}</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-body">
            <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-secondary)' }}>{t('BILL TO')}</h3>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{sale.customer_name || 'Walk-in Customer'}</div>
            {sale.customer_phone && <div>{sale.customer_phone}</div>}
            {sale.customer_address && <div style={{ color: 'var(--text-secondary)' }}>{sale.customer_address}</div>}
            {sale.customer_gstin && <div>GSTIN: {sale.customer_gstin}</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Status')}</span><div><span className={`badge ${sale.status === 'completed' ? 'badge-success' : 'badge-error'}`}>{sale.status}</span></div></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Payment')}</span><div><span className={`badge ${sale.payment_status === 'paid' ? 'badge-success' : sale.payment_status === 'partial' ? 'badge-warning' : 'badge-error'}`}>{sale.payment_status}</span></div></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Total')}</span><div style={{ fontWeight: 700, fontSize: 18 }}>{formatMoney(sale.grand_total)}</div></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Balance')}</span><div style={{ fontWeight: 700, fontSize: 18, color: sale.balance_amount > 0 ? 'var(--error)' : 'var(--success)' }}>{formatMoney(sale.balance_amount)}</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>{t('Item')}</th><th>{t('HSN')}</th><th>{t('Qty')}</th><th>{t('Price')}</th><th>{t('Tax')}</th><th>{t('Total')}</th></tr>
            </thead>
            <tbody>
              {(sale.items || []).map((item, i) => (
                <tr key={item.id}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label={t('Item')} style={{ fontWeight: 500 }}>{item.product_name}</td>
                  <td data-label={t('HSN')}>{item.hsn_code || '—'}</td>
                  <td data-label={t('Qty')}>{item.quantity}</td>
                  <td data-label={t('Price')}>{formatMoney(item.unit_price)}</td>
                  <td data-label={t('Tax')}>{formatMoney(item.tax_amount)} ({item.tax_rate}%)</td>
                  <td data-label={t('Total')} style={{ fontWeight: 600 }}>{formatMoney(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>{t('Subtotal')}</span><span>{formatMoney(sale.subtotal)}</span></div>
            {sale.discount_amount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>{t('Discount')}</span><span>-{formatMoney(sale.discount_amount)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>{t('Tax')}</span><span>{formatMoney(sale.tax_amount)}</span></div>
            {sale.shipping_charges > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>{t('Shipping')}</span><span>{formatMoney(sale.shipping_charges)}</span></div>}
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}><span>{t('Total')}</span><span>{formatMoney(sale.grand_total)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}><span>{t('Paid')}</span><span>{formatMoney(sale.paid_amount)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}><span>{t('Balance')}</span><span style={{ fontWeight: 600 }}>{formatMoney(sale.balance_amount)}</span></div>
          </div>
        </div>
      </div>

      {sale.payments?.length > 0 && (
        <div className="card">
          <div className="card-header"><div className="card-title">{t('Payments')}</div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Mode')}</th><th>{t('Amount')}</th></tr></thead>
              <tbody>
                {sale.payments.map((p) => (
                  <tr key={p.id}>
                    <td data-label={t('Number')}>{p.payment_number}</td>
                    <td data-label={t('Date')}>{p.payment_date}</td>
                    <td data-label={t('Mode')}>{t(p.payment_mode)}</td>
                    <td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sales() {
  const params = useParams();
  const location = useLocation();
  if (location.pathname.endsWith('/new')) return <SaleForm />;
  if (params.id) return <SaleDetail />;
  return <SalesList />;
}
