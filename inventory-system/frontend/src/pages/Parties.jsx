import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, BookOpen, Users, Truck } from 'lucide-react';
import { customersAPI, suppliersAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { useConfirm } from '../context/ConfirmContext';
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
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const confirm = useConfirm();
  const params = useParams();
  const navigate = useNavigate();

  const load = (page = 1) => {
    setLoading(true);
    api.list({ page, limit: 20, search: search || undefined })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error(t('Failed to load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [search]);

  const openCreate = () => { setForm(isCustomer ? emptyCustomer : emptySupplier); setEditId(null); setModal(true); };
  const openEdit = (p) => { setForm({ ...p }); setEditId(p.id); setModal(true); };

  const save = async () => {
    if (!form.name) return error(t('Name is required'));
    setSaving(true);
    try {
      if (editId) { await api.update(editId, form); success(t('Updated')); }
      else { await api.create(form); success(t('Created')); }
      setModal(false);
      load(pagination.page);
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!(await confirm(t('Deactivate this record?')))) return;
    try { await api.remove(id); success(t('Deactivated')); load(pagination.page); }
    catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  const showLedger = async (id) => {
    try {
      const r = await api.ledger(id);
      setLedger(r.data.data);
    } catch { error(t('Failed to load ledger')); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t(title)}</h1><p className="page-subtitle">{pagination.total} {t('records')}</p></div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> {t(isCustomer ? 'Add Customer' : 'Add Supplier')}</button>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Search size={18} /><input placeholder={t(isCustomer ? 'Search customers...' : 'Search suppliers...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState icon={Icon} title={`No ${title.toLowerCase()}`} action={<button className="btn btn-primary" onClick={openCreate}>{t('Add')}</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Name')}</th><th>{t('Phone')}</th><th>{t('City')}</th><th>{t('GSTIN')}</th>
                    {isCustomer && <th>{t('Credit Limit')}</th>}
                    <th>{t('Balance')}</th><th>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td data-label={t('Name')} style={{ fontWeight: 500 }}>{p.name}</td>
                      <td data-label={t('Phone')}>{p.phone || '—'}</td>
                      <td data-label={t('City')}>{p.city || '—'}</td>
                      <td data-label={t('GSTIN')}>{p.gstin || '—'}</td>
                      {isCustomer && <td data-label={t('Credit Limit')}>{formatMoney(p.credit_limit)}</td>}
                      <td data-label={t('Balance')} style={{ fontWeight: 600, color: p.current_balance > 0 ? 'var(--error)' : 'var(--success)' }}>
                        {formatMoney(p.current_balance)}
                      </td>
                      <td data-label={t('Actions')}>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? t('Edit') : t(isCustomer ? 'Add Customer' : 'Add Supplier')} size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button></>}
      >
        <div className="form-row">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">{t('Name')}<span className="required">*</span></label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group"><label className="form-label">{t('Phone')}</label><input className="form-control" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('Email')}</label><input className="form-control" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('Address')}</label><input className="form-control" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('City')}</label><input className="form-control" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('State')}</label><input className="form-control" value={form.state || ''} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('Pincode')}</label><input className="form-control" value={form.pincode || ''} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('GSTIN')}</label><input className="form-control" value={form.gstin || ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
          {isCustomer && <div className="form-group"><label className="form-label">{t('Credit Limit')}</label><input className="form-control" type="number" value={form.credit_limit || 0} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></div>}
          {!editId && <div className="form-group"><label className="form-label">{t('Opening Balance')}</label><input className="form-control" type="number" value={form.opening_balance || 0} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>}
        </div>
      </Modal>

      <Modal open={!!ledger} onClose={() => setLedger(null)} title={`Ledger — ${ledger?.customer?.name || ledger?.supplier?.name || ''}`} size="lg">
        {ledger && (
          <>
            <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Opening')}</span><div style={{ fontWeight: 600 }}>{formatMoney(ledger.opening_balance)}</div></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Closing')}</span><div style={{ fontWeight: 600 }}>{formatMoney(ledger.closing_balance)}</div></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Date')}</th><th>{t('Ref')}</th><th>{t('Type')}</th><th>{t('Debit')}</th><th>{t('Credit')}</th><th>{t('Balance')}</th></tr></thead>
                <tbody>
                  {(ledger.entries || []).map((e, i) => (
                    <tr key={i}>
                      <td data-label={t('Date')}>{e.d}</td><td data-label={t('Ref')}>{e.ref}</td><td data-label={t('Type')}>{t(e.type)}</td>
                      <td data-label={t('Debit')}>{e.debit ? formatMoney(e.debit) : '—'}</td>
                      <td data-label={t('Credit')}>{e.credit ? formatMoney(e.credit) : '—'}</td>
                      <td data-label={t('Balance')} style={{ fontWeight: 600 }}>{formatMoney(e.balance)}</td>
                    </tr>
                  ))}
                  {(!ledger.entries || !ledger.entries.length) && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No transactions')}</td></tr>
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
