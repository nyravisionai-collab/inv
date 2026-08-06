import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit, TriangleAlert, ArrowLeftRight, SlidersHorizontal, Tag, Download } from 'lucide-react';
import { inventoryAPI, productsAPI, settingsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { useConfirm } from '../context/ConfirmContext';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { withRowId } from '../utils/rowId';

const emptyTransferLine = { product_id: '', quantity: 1 };
const emptyAdjustmentLine = { product_id: '', new_qty: 0 };

export function Categories() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const confirm = useConfirm();
  const { t } = useAuth();

  const load = () => {
    setLoading(true);
    inventoryAPI.categories().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    // Without this guard a second click while the first request is in flight
    // creates the same category twice.
    if (saving) return undefined;
    if (!name.trim()) return error(t('Name required'));
    setSaving(true);
    try {
      if (editId) await inventoryAPI.updateCategory(editId, { name: name.trim() });
      else await inventoryAPI.createCategory({ name: name.trim() });
      success(editId ? t('Updated') : t('Created'));
      setModal(false); setName(''); setEditId(null); load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!(await confirm(t('Delete category?')))) return;
    try { await inventoryAPI.deleteCategory(id); success(t('Deleted')); load(); }
    catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Categories')}</h1><p className="page-subtitle">{items.length} categories</p></div>
        <button className="btn btn-primary" onClick={() => { setName(''); setEditId(null); setModal(true); }}><Plus size={18} /> Add Category</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No categories" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Name')}</th><th>{t('Products')}</th><th>{t('Parent')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td data-label={t('Name')} style={{ fontWeight: 500 }}>{c.name}</td>
                    <td data-label={t('Products')}>{c.product_count}</td>
                    <td data-label={t('Parent')}>{c.parent_name || '—'}</td>
                    <td data-label={t('Actions')}>
                      <div className="table-actions">
                        <button className="btn-icon" onClick={() => { setName(c.name); setEditId(c.id); setModal(true); }}><Edit size={16} /></button>
                        <button className="btn-icon" onClick={() => remove(c.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Category' : 'Add Category'}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button></>}
      >
        <div className="form-group">
          <label className="form-label">{t('Name')}</label>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
      </Modal>
    </div>
  );
}

export function Brands() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const confirm = useConfirm();
  const { t } = useAuth();

  const load = () => {
    setLoading(true);
    inventoryAPI.brands().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (saving) return undefined;
    if (!form.name.trim()) return error(t('Name required'));
    setSaving(true);
    try {
      if (editId) await inventoryAPI.updateBrand(editId, form);
      else await inventoryAPI.createBrand(form);
      success(editId ? t('Updated') : t('Created'));
      setModal(false); setForm({ name: '', description: '' }); setEditId(null); load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!(await confirm(t('Delete brand?')))) return;
    try { await inventoryAPI.deleteBrand(id); success(t('Deleted')); load(); }
    catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Brands')}</h1><p className="page-subtitle">{items.length} {t('brands')}</p></div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', description: '' }); setEditId(null); setModal(true); }}><Plus size={18} /> {t('Add Brand')}</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState icon={Tag} title="No brands" message="Add a brand so products can be grouped by maker" action={<button className="btn btn-primary" onClick={() => { setForm({ name: '', description: '' }); setEditId(null); setModal(true); }}>{t('Add Brand')}</button>} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Name')}</th><th>{t('Description')}</th><th>{t('Products')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td data-label={t('Name')} style={{ fontWeight: 500 }}>{b.name}</td>
                    <td data-label={t('Description')}>{b.description || '\u2014'}</td>
                    <td data-label={t('Products')}>{b.product_count}</td>
                    <td data-label={t('Actions')}>
                      <div className="table-actions">
                        <button className="btn-icon" onClick={() => { setForm({ name: b.name, description: b.description || '' }); setEditId(b.id); setModal(true); }}><Edit size={16} /></button>
                        <button className="btn-icon" onClick={() => remove(b.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Brand' : 'Add Brand'}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button></>}
      >
        <div className="form-group">
          <label className="form-label">{t('Name')}<span className="required">*</span></label>
          <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Description')}</label>
          <input className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

export function Warehouses() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', address: '', city: '', is_default: false });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const { t } = useAuth();

  const load = () => {
    setLoading(true);
    inventoryAPI.warehouses().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (saving) return undefined;
    if (!form.name.trim()) return error(t('Name required'));
    setSaving(true);
    try {
      if (editId) await inventoryAPI.updateWarehouse(editId, form);
      else await inventoryAPI.createWarehouse(form);
      success(t('Saved'));
      setModal(false);
      setForm({ name: '', code: '', address: '', city: '', is_default: false });
      setEditId(null);
      load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Warehouses')}</h1></div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', code: '', address: '', city: '', is_default: false }); setEditId(null); setModal(true); }}><Plus size={18} /> Add Warehouse</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Name')}</th><th>{t('Code')}</th><th>{t('City')}</th><th>{t('Default')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id}>
                    <td data-label={t('Name')} style={{ fontWeight: 500 }}>{w.name}</td>
                    <td data-label={t('Code')}>{w.code || '—'}</td>
                    <td data-label={t('City')}>{w.city || '—'}</td>
                    <td data-label={t('Default')}>{w.is_default ? <span className="badge badge-success">{t('Default')}</span> : '—'}</td>
                    <td data-label={t('Actions')}>
                      <button className="btn-icon" onClick={() => { setForm({ name: w.name, code: w.code || '', address: w.address || '', city: w.city || '', is_default: !!w.is_default }); setEditId(w.id); setModal(true); }}><Edit size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Warehouse' : 'Add Warehouse'}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button></>}
      >
        <div className="form-group"><label className="form-label">{t('Name')}</label><input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">{t('Code')}</label><input className="form-control" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('City')}</label><input className="form-control" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">{t('Address')}</label><input className="form-control" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Set as default
        </label>
      </Modal>
    </div>
  );
}

export function LowStock() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();

  useEffect(() => {
    productsAPI.lowStock().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const totalReorderQty = items.reduce((s, p) => s + Math.max(Number(p.reorder_level || p.min_stock * 2) - Number(p.current_stock), 0), 0);
  const totalReorderCost = items.reduce((s, p) => s + Math.max(Number(p.reorder_level || p.min_stock * 2) - Number(p.current_stock), 0) * Number(p.purchase_price || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Low Stock Alerts')}</h1>
          <p className="page-subtitle">{items.length} products below minimum</p>
        </div>
        <button className="btn btn-secondary" onClick={async () => {
          try {
            const r = await settingsAPI.exportPdf('stock', { low_stock: 1 });
            success(`${t('PDF saved')}: ${r.data.data.fileName}`);
          } catch { error(t('Export failed')); }
        }}>
          <Download size={18} /> {t('Export PDF')}
        </button>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat-card">
          <div>
            <div className="stat-label">{t('Low Stock Products')}</div>
            <div className="stat-value">{items.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <div className="stat-label">{t('Suggested Reorder Qty')}</div>
            <div className="stat-value">{totalReorderQty}</div>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <div className="stat-label">{t('Estimated Reorder Cost')}</div>
            <div className="stat-value" style={{ fontSize: 18, color: 'var(--primary)' }}>{formatMoney(totalReorderCost)}</div>
          </div>
        </div>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState icon={TriangleAlert} title="All stocks healthy" message="No products below minimum stock level" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th>{t('Current Stock')}</th>
                  <th>{t('Min Stock')}</th>
                  <th>{t('Suggested Reorder Qty')}</th>
                  <th>{t('Purchase Price')}</th>
                  <th>{t('Estimated Cost')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const suggQty = Math.max(Number(p.reorder_level || p.min_stock * 2) - Number(p.current_stock), 0);
                  const suggCost = suggQty * Number(p.purchase_price || 0);
                  return (
                    <tr key={p.id}>
                      <td data-label={t('Product')} style={{ fontWeight: 500 }}>{p.name}</td>
                      <td data-label={t('Current Stock')}><span className="badge badge-error">{p.current_stock}</span></td>
                      <td data-label={t('Min Stock')}>{p.min_stock}</td>
                      <td data-label={t('Suggested Reorder Qty')} style={{ fontWeight: 600, color: 'var(--primary)' }}>{suggQty}</td>
                      <td data-label={t('Purchase Price')}>{formatMoney(p.purchase_price)}</td>
                      <td data-label={t('Estimated Cost')} style={{ fontWeight: 600 }}>{formatMoney(suggCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function StockTransfer() {
  const [transfers, setTransfers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ from_warehouse_id: '', to_warehouse_id: '', notes: '' });
  const [items, setItems] = useState(() => [withRowId(emptyTransferLine)]);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const { t } = useAuth();

  const load = () => {
    setLoading(true);
    inventoryAPI.transfers().then((r) => setTransfers(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    inventoryAPI.warehouses().then((r) => setWarehouses(r.data.data)).catch(() => {});
    productsAPI.list({ limit: 100 }).then((r) => setProducts(r.data.data)).catch(() => {});
  }, []);

  const updateItem = (idx, patch) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const save = async () => {
    if (saving) return undefined;
    if (!form.from_warehouse_id || !form.to_warehouse_id) return error(t('Select warehouses'));
    if (String(form.from_warehouse_id) === String(form.to_warehouse_id)) return error(t('Warehouses must be different'));
    const valid = items.filter((i) => i.product_id && Number(i.quantity) > 0).map(({ _rid, ...rest }) => rest);
    if (!valid.length) return error(t('Add items'));
    setSaving(true);
    try {
      await inventoryAPI.createTransfer({ ...form, items: valid });
      success(t('Stock transferred'));
      setModal(false);
      // Clear the draft so the next transfer does not silently repeat this one.
      setForm({ from_warehouse_id: '', to_warehouse_id: '', notes: '' });
      setItems([withRowId(emptyTransferLine)]);
      load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Stock Transfer')}</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> New Transfer</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : transfers.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="No transfers yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('From')}</th><th>{t('To')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>
                {transfers.map((trn) => (
                  <tr key={trn.id}>
                    <td data-label={t('Number')} style={{ fontWeight: 600 }}>{trn.transfer_number}</td>
                    <td data-label={t('Date')}>{trn.transfer_date}</td>
                    <td data-label={t('From')}>{trn.from_warehouse}</td>
                    <td data-label={t('To')}>{trn.to_warehouse}</td>
                    <td data-label={t('Status')}><span className="badge badge-success">{t(trn.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Stock Transfer" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Transfer'}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('From Warehouse')}</label>
            <select className="form-control" value={form.from_warehouse_id} onChange={(e) => setForm({ ...form, from_warehouse_id: e.target.value })}>
              <option value="">{t('Select')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('To Warehouse')}</label>
            <select className="form-control" value={form.to_warehouse_id} onChange={(e) => setForm({ ...form, to_warehouse_id: e.target.value })}>
              <option value="">{t('Select')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        {items.map((item, idx) => (
          <div className="form-row" key={item._rid}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">{t('Product')}</label>
              <select className="form-control" value={item.product_id} onChange={(e) => updateItem(idx, { product_id: e.target.value })}>
                <option value="">{t('Select')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Qty')}</label>
              <input className="form-control" type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} />
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setItems((prev) => [...prev, withRowId(emptyTransferLine)])}>+ Add Item</button>
      </Modal>
    </div>
  );
}

export function StockAdjustment() {
  const [adjustments, setAdjustments] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ warehouse_id: '', reason: '', notes: '' });
  const [items, setItems] = useState(() => [withRowId(emptyAdjustmentLine)]);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const { t } = useAuth();

  const load = () => {
    setLoading(true);
    inventoryAPI.adjustments().then((r) => setAdjustments(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    productsAPI.list({ limit: 100 }).then((r) => setProducts(r.data.data)).catch(() => {});
    inventoryAPI.warehouses().then((r) => setWarehouses(r.data.data)).catch(() => {});
  }, []);

  const updateItem = (idx, patch) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const save = async () => {
    if (saving) return undefined;
    const valid = items.filter((i) => i.product_id);
    if (!valid.length) return error(t('Add items'));
    if (valid.some((i) => !(Number(i.new_qty) >= 0))) return error(t('Enter valid quantity'));
    setSaving(true);
    try {
      await inventoryAPI.createAdjustment({
        ...form,
        items: valid.map(({ _rid, ...i }) => ({ ...i, new_qty: Number(i.new_qty) })),
      });
      success(t('Stock adjusted'));
      setModal(false);
      setForm({ warehouse_id: '', reason: '', notes: '' });
      setItems([withRowId(emptyAdjustmentLine)]);
      load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Stock Adjustment')}</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> New Adjustment</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : adjustments.length === 0 ? (
          <EmptyState icon={SlidersHorizontal} title="No adjustments yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Warehouse')}</th><th>{t('Reason')}</th></tr></thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id}>
                    <td data-label={t('Number')} style={{ fontWeight: 600 }}>{a.adjustment_number}</td>
                    <td data-label={t('Date')}>{a.adjustment_date}</td>
                    <td data-label={t('Warehouse')}>{a.warehouse_name || '—'}</td>
                    <td data-label={t('Reason')}>{a.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Stock Adjustment" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Adjust'}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Warehouse')}</label>
            <select className="form-control" value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">{t('Default')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Reason')}</label>
            <input className="form-control" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t('Damage, count correction...')} />
          </div>
        </div>
        {items.map((item, idx) => (
          <div className="form-row" key={item._rid}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">{t('Product')}</label>
              <select className="form-control" value={item.product_id} onChange={(e) => {
                const p = products.find((x) => x.id === Number(e.target.value));
                updateItem(idx, p
                  ? { product_id: e.target.value, new_qty: p.current_stock }
                  : { product_id: e.target.value });
              }}>
                <option value="">{t('Select')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} (Stock: {p.current_stock})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('New Qty')}</label>
              <input className="form-control" type="number" min="0" step="any" value={item.new_qty} onChange={(e) => updateItem(idx, { new_qty: e.target.value })} />
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setItems((prev) => [...prev, withRowId(emptyAdjustmentLine)])}>+ Add Item</button>
      </Modal>
    </div>
  );
}
