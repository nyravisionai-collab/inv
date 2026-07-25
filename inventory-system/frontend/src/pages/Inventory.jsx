import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit, AlertTriangle, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { inventoryAPI, productsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';

export function Categories() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState(null);
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    inventoryAPI.categories().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!name.trim()) return error('Name required');
    try {
      if (editId) await inventoryAPI.updateCategory(editId, { name });
      else await inventoryAPI.createCategory({ name });
      success(editId ? 'Updated' : 'Created');
      setModal(false); setName(''); setEditId(null); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  const remove = async (id) => {
    if (!confirm('Delete category?')) return;
    try { await inventoryAPI.deleteCategory(id); success('Deleted'); load(); }
    catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Categories</h1><p className="page-subtitle">{items.length} categories</p></div>
        <button className="btn btn-primary" onClick={() => { setName(''); setEditId(null); setModal(true); }}><Plus size={18} /> Add Category</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No categories" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Products</th><th>Parent</th><th>Actions</th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>{c.product_count}</td>
                    <td>{c.parent_name || '—'}</td>
                    <td>
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
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}
      >
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    inventoryAPI.warehouses().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) return error('Name required');
    try {
      if (editId) await inventoryAPI.updateWarehouse(editId, form);
      else await inventoryAPI.createWarehouse(form);
      success('Saved'); setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Warehouses</h1></div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', code: '', address: '', city: '', is_default: false }); setEditId(null); setModal(true); }}><Plus size={18} /> Add Warehouse</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Code</th><th>City</th><th>Default</th><th>Actions</th></tr></thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 500 }}>{w.name}</td>
                    <td>{w.code || '—'}</td>
                    <td>{w.city || '—'}</td>
                    <td>{w.is_default ? <span className="badge badge-success">Default</span> : '—'}</td>
                    <td>
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
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}
      >
        <div className="form-group"><label className="form-label">Name</label><input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Code</label><input className="form-control" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">City</label><input className="form-control" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">Address</label><input className="form-control" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
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
  const { formatMoney } = useAuth();

  useEffect(() => {
    productsAPI.lowStock().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Low Stock Alerts</h1><p className="page-subtitle">{items.length} products below minimum</p></div>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="All stocks healthy" message="No products below minimum stock level" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Current Stock</th><th>Min Stock</th><th>Reorder Level</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td><span className="badge badge-error">{p.current_stock}</span></td>
                    <td>{p.min_stock}</td>
                    <td>{p.reorder_level || p.min_stock}</td>
                  </tr>
                ))}
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
  const [items, setItems] = useState([{ product_id: '', quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    inventoryAPI.transfers().then((r) => setTransfers(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    inventoryAPI.warehouses().then((r) => setWarehouses(r.data.data)).catch(() => {});
    productsAPI.list({ limit: 100 }).then((r) => setProducts(r.data.data)).catch(() => {});
  }, []);

  const save = async () => {
    if (!form.from_warehouse_id || !form.to_warehouse_id) return error('Select warehouses');
    const valid = items.filter((i) => i.product_id && i.quantity > 0);
    if (!valid.length) return error('Add items');
    setSaving(true);
    try {
      await inventoryAPI.createTransfer({ ...form, items: valid });
      success('Stock transferred');
      setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Stock Transfer</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> New Transfer</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : transfers.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="No transfers yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Number</th><th>Date</th><th>From</th><th>To</th><th>Status</th></tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.transfer_number}</td>
                    <td>{t.transfer_date}</td>
                    <td>{t.from_warehouse}</td>
                    <td>{t.to_warehouse}</td>
                    <td><span className="badge badge-success">{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Stock Transfer" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Transfer'}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From Warehouse</label>
            <select className="form-control" value={form.from_warehouse_id} onChange={(e) => setForm({ ...form, from_warehouse_id: e.target.value })}>
              <option value="">Select</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">To Warehouse</label>
            <select className="form-control" value={form.to_warehouse_id} onChange={(e) => setForm({ ...form, to_warehouse_id: e.target.value })}>
              <option value="">Select</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        {items.map((item, idx) => (
          <div className="form-row" key={idx}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Product</label>
              <select className="form-control" value={item.product_id} onChange={(e) => { const n = [...items]; n[idx].product_id = e.target.value; setItems(n); }}>
                <option value="">Select</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Qty</label>
              <input className="form-control" type="number" value={item.quantity} onChange={(e) => { const n = [...items]; n[idx].quantity = e.target.value; setItems(n); }} />
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setItems([...items, { product_id: '', quantity: 1 }])}>+ Add Item</button>
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
  const [items, setItems] = useState([{ product_id: '', new_qty: 0 }]);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    inventoryAPI.adjustments().then((r) => setAdjustments(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    productsAPI.list({ limit: 100 }).then((r) => setProducts(r.data.data)).catch(() => {});
    inventoryAPI.warehouses().then((r) => setWarehouses(r.data.data)).catch(() => {});
  }, []);

  const save = async () => {
    const valid = items.filter((i) => i.product_id);
    if (!valid.length) return error('Add items');
    setSaving(true);
    try {
      await inventoryAPI.createAdjustment({ ...form, items: valid.map((i) => ({ ...i, new_qty: Number(i.new_qty) })) });
      success('Stock adjusted');
      setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Stock Adjustment</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> New Adjustment</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : adjustments.length === 0 ? (
          <EmptyState icon={SlidersHorizontal} title="No adjustments yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Number</th><th>Date</th><th>Warehouse</th><th>Reason</th></tr></thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.adjustment_number}</td>
                    <td>{a.adjustment_date}</td>
                    <td>{a.warehouse_name || '—'}</td>
                    <td>{a.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Stock Adjustment" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Adjust'}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Warehouse</label>
            <select className="form-control" value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">Default</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Reason</label>
            <input className="form-control" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Damage, count correction..." />
          </div>
        </div>
        {items.map((item, idx) => (
          <div className="form-row" key={idx}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Product</label>
              <select className="form-control" value={item.product_id} onChange={(e) => {
                const n = [...items]; n[idx].product_id = e.target.value;
                const p = products.find((x) => x.id === Number(e.target.value));
                if (p) n[idx].new_qty = p.current_stock;
                setItems(n);
              }}>
                <option value="">Select</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} (Stock: {p.current_stock})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">New Qty</label>
              <input className="form-control" type="number" value={item.new_qty} onChange={(e) => { const n = [...items]; n[idx].new_qty = e.target.value; setItems(n); }} />
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setItems([...items, { product_id: '', new_qty: 0 }])}>+ Add Item</button>
      </Modal>
    </div>
  );
}
