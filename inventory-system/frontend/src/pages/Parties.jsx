import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, BookOpen, Users, Truck } from 'lucide-react';
import { customersAPI, suppliersAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const emptyCustomer = { name: '', phone: '', email: '', address: '', city: '', state: '', pincode: '', gstin: '', credit_limit: 0, opening_balance: 0, notes: '' };
const emptySupplier = { name: '', phone: '', email: '', address: '', city: '', state: '', pincode: '', gstin: '', opening_balance: 0, notes: '' };

export function Customers() {
  return <PartyPage type="customer" />;
}

export function Suppliers() {
  return <PartyPage type="supplier" />;
}

function PartyPage({ type }) {
  const isCustomer = type === 'customer';
  const api = isCustomer ? customersAPI : suppliersAPI;
  const title = isCustomer ? 'Customers' : 'Suppliers';
  const Icon = isCustomer ? Users : Truck;
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(isCustomer ? emptyCustomer : emptySupplier);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState(null);
  const { formatMoney } = useAuth();
  const { success, error } = useToast();
  const params = useParams();
  const navigate = useNavigate();

  const load = (page = 1) => {
    setLoading(true);
    api.list({ page, limit: 20, search: search || undefined })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error('Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [search]);

  const openCreate = () => { setForm(isCustomer ? emptyCustomer : emptySupplier); setEditId(null); setModal(true); };
  const openEdit = (p) => { setForm({ ...p }); setEditId(p.id); setModal(true); };

  const save = async () => {
    if (!form.name) return error('Name is required');
    setSaving(true);
    try {
      if (editId) { await api.update(editId, form); success('Updated'); }
      else { await api.create(form); success('Created'); }
      setModal(false);
      load(pagination.page);
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Deactivate this record?')) return;
    try { await api.remove(id); success('Deactivated'); load(pagination.page); }
    catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  const showLedger = async (id) => {
    try {
      const r = await api.ledger(id);
      setLedger(r.data.data);
    } catch { error('Failed to load ledger'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{title}</h1><p className="page-subtitle">{pagination.total} records</p></div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> Add {isCustomer ? 'Customer' : 'Supplier'}</button>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Search size={18} /><input placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState icon={Icon} title={`No ${title.toLowerCase()}`} action={<button className="btn btn-primary" onClick={openCreate}>Add</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Phone</th><th>City</th><th>GSTIN</th>
                    {isCustomer && <th>Credit Limit</th>}
                    <th>Balance</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td>{p.phone || '—'}</td>
                      <td>{p.city || '—'}</td>
                      <td>{p.gstin || '—'}</td>
                      {isCustomer && <td>{formatMoney(p.credit_limit)}</td>}
                      <td style={{ fontWeight: 600, color: p.current_balance > 0 ? 'var(--error)' : 'var(--success)' }}>
                        {formatMoney(p.current_balance)}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="btn-icon" onClick={() => showLedger(p.id)} title="Ledger"><BookOpen size={16} /></button>
                          <button className="btn-icon" onClick={() => openEdit(p)} title="Edit"><Edit size={16} /></button>
                          <button className="btn-icon" onClick={() => remove(p.id)} title="Delete"><Trash2 size={16} /></button>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit' : `Add ${isCustomer ? 'Customer' : 'Supplier'}`} size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}
      >
        <div className="form-row">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Name <span className="required">*</span></label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-control" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Email</label><input className="form-control" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Address</label><input className="form-control" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">City</label><input className="form-control" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">State</label><input className="form-control" value={form.state || ''} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Pincode</label><input className="form-control" value={form.pincode || ''} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">GSTIN</label><input className="form-control" value={form.gstin || ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
          {isCustomer && <div className="form-group"><label className="form-label">Credit Limit</label><input className="form-control" type="number" value={form.credit_limit || 0} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></div>}
          {!editId && <div className="form-group"><label className="form-label">Opening Balance</label><input className="form-control" type="number" value={form.opening_balance || 0} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>}
        </div>
      </Modal>

      <Modal open={!!ledger} onClose={() => setLedger(null)} title={`Ledger — ${ledger?.customer?.name || ledger?.supplier?.name || ''}`} size="lg">
        {ledger && (
          <>
            <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Opening</span><div style={{ fontWeight: 600 }}>{formatMoney(ledger.opening_balance)}</div></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Closing</span><div style={{ fontWeight: 600 }}>{formatMoney(ledger.closing_balance)}</div></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Ref</th><th>Type</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
                <tbody>
                  {(ledger.entries || []).map((e, i) => (
                    <tr key={i}>
                      <td>{e.d}</td><td>{e.ref}</td><td>{e.type}</td>
                      <td>{e.debit ? formatMoney(e.debit) : '—'}</td>
                      <td>{e.credit ? formatMoney(e.credit) : '—'}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(e.balance)}</td>
                    </tr>
                  ))}
                  {(!ledger.entries || !ledger.entries.length) && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No transactions</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
