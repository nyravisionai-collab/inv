import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, BookOpen, Users, Download, TriangleAlert } from 'lucide-react';
import { partiesAPI, settingsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { useConfirm } from '../context/ConfirmContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const emptyParty = {
  name: '', phone: '', email: '', address: '', city: '', state: '', pincode: '',
  gstin: '', credit_limit: 0, opening_balance: 0, balance_type: 'debit', notes: '',
};

export default function Parties() {
  const location = useLocation();
  const isOutstandingPage = location.pathname.endsWith('/outstanding');
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyParty);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState(null);
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const confirm = useConfirm();

  const load = (page = 1) => {
    setLoading(true);
    const params = { page, limit: 20, search: search || undefined };
    if (isOutstandingPage) params.outstanding = 1;
    partiesAPI.list(params)
      .then((r) => {
        setItems(r.data.data);
        setPagination(r.data.pagination);
      })
      .catch(() => error(t('Failed to load parties')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [location.pathname]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 300);
    return () => clearTimeout(t);
  }, [search]);

  const openCreate = () => {
    setForm(emptyParty);
    setEditId(null);
    setModal(true);
  };

  const openEdit = (p) => {
    setForm({ ...p });
    setEditId(p.id);
    setModal(true);
  };

  const save = async () => {
    if (saving) return undefined;
    if (!String(form.name || '').trim()) return error(t('Name is required'));
    setSaving(true);
    try {
      if (editId) {
        await partiesAPI.update(editId, form);
        success(t('Party updated'));
      } else {
        await partiesAPI.create(form);
        success(t('Party created'));
      }
      setModal(false);
      load(pagination.page);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!(await confirm(t('Deactivate this party?')))) return;
    try {
      await partiesAPI.remove(id);
      success(t('Party deactivated'));
      load(pagination.page);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Delete failed'));
    }
  };

  const showLedger = async (id) => {
    try {
      const r = await partiesAPI.ledger(id);
      setLedger(r.data.data);
    } catch {
      error(t('Failed to load ledger'));
    }
  };

  const exportLedgerPdf = async () => {
    if (!ledger?.party?.id) return;
    try {
      const r = await partiesAPI.ledgerPdf(ledger.party.id);
      success(`${t('PDF saved')}: ${r.data.data.fileName}`);
    } catch {
      error(t('PDF export failed'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{isOutstandingPage ? t('Outstanding Balances') : t('Parties')}</h1>
          <p className="page-subtitle">{pagination.total} {t('records')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={async () => {
            try {
              const r = await settingsAPI.exportPdf('parties', { search, outstanding: isOutstandingPage ? 1 : 0 });
              success(`${t('PDF saved')}: ${r.data.data.fileName}`);
            } catch { error(t('Export failed')); }
          }}>
            <Download size={18} /> {t('Export PDF')}
          </button>
          {!isOutstandingPage && <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> {t('Add Party')}</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Search size={18} />
            <input placeholder={t('Search parties...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState icon={isOutstandingPage ? TriangleAlert : Users} title={isOutstandingPage ? t('No outstanding balances') : t('No parties')} message={t('Add your first party to get started')} action={!isOutstandingPage && <button className="btn btn-primary" onClick={openCreate}>{t('Add Party')}</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Name')}</th><th>{t('Phone')}</th><th>{t('City')}</th>
                    <th>{t('Balance')}</th><th>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td data-label={t('Name')} style={{ fontWeight: 500 }}>{p.name}</td>
                      <td data-label={t('Phone')}>{p.phone || '—'}</td>
                      <td data-label={t('City')}>{p.city || '—'}</td>
                      <td data-label={t('Balance')} style={{ fontWeight: 600, color: p.current_balance > 0 ? 'var(--success)' : p.current_balance < 0 ? 'var(--error)' : 'inherit' }}>
                        {formatMoney(Math.abs(p.current_balance))}
                        <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>
                          {p.current_balance > 0 ? t('(Receivable)') : p.current_balance < 0 ? t('(Payable)') : ''}
                        </span>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? t('Edit Party') : t('Add Party')} size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button>
          </>
        }
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
          <div className="form-group"><label className="form-label">{t('Credit Limit')}</label><input className="form-control" type="number" value={form.credit_limit || 0} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></div>
          {!editId && (
            <>
              <div className="form-group"><label className="form-label">{t('Opening Balance')}</label><input className="form-control" type="number" value={form.opening_balance || 0} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>
              <div className="form-group">
                <label className="form-label">{t('Balance Type')}</label>
                <select className="form-control" value={form.balance_type} onChange={(e) => setForm({ ...form, balance_type: e.target.value })}>
                  <option value="debit">{t('Receivable (Party)')}</option>
                  <option value="credit">{t('Payable (Party)')}</option>
                </select>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!ledger} onClose={() => setLedger(null)} title={`Ledger — ${ledger?.party?.name || ''}`} size="lg">
        {ledger && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 24 }}>
                <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Opening')}</span><div style={{ fontWeight: 600 }}>{formatMoney(ledger.opening_balance)}</div></div>
                <div><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('Closing')}</span><div style={{ fontWeight: 600 }}>{formatMoney(ledger.closing_balance)}</div></div>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={exportLedgerPdf}><Download size={14} /> {t('Export PDF')}</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Date')}</th><th>{t('Ref')}</th><th>{t('Type')}</th><th>{t('Amount')}</th><th>{t('Paid')}</th><th>{t('Status')}</th></tr></thead>
                <tbody>
                  {(ledger.entries || []).map((e, i) => (
                    <tr key={i}>
                      <td data-label={t('Date')}>{e.d}</td>
                      <td data-label={t('Ref')}>{e.ref}</td>
                      <td data-label={t('Type')}><span className={`badge ${e.type === 'sale' ? 'badge-info' : e.type === 'purchase' ? 'badge-warning' : 'badge-success'}`}>{t(e.type)}</span></td>
                      <td data-label={t('Amount')}>{formatMoney(e.amount)}</td>
                      <td data-label={t('Paid')}>{formatMoney(e.paid)}</td>
                      <td data-label={t('Status')}><span className={`badge ${e.status === 'completed' ? 'badge-success' : 'badge-error'}`}>{t(e.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
