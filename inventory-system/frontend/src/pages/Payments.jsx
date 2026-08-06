import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Trash2, FileText, Download } from 'lucide-react';
import { paymentsAPI, partysAPI, partysAPI, accountingAPI, settingsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { useConfirm } from '../context/ConfirmContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

function today() { return new Date().toISOString().slice(0, 10); }

export default function Payments() {
  const location = useLocation();
  const isIn = location.pathname.includes('payments-in');
  const type = isIn ? 'payment_in' : 'payment_out';
  const title = isIn ? 'Payment In' : 'Payment Out';
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [parties, setParties] = useState([]);
  const [banks, setBanks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ party_id: '', payment_date: today(), amount: '', payment_mode: 'cash', bank_account_id: '', notes: '' });
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const confirm = useConfirm();

  // What the selected party still owes, so the amount can be checked at a glance.
  const outstanding = Number(parties.find((p) => String(p.id) === String(form.party_id))?.current_balance) || 0;

  const load = (page = 1) => {
    setLoading(true);
    paymentsAPI.list({ page, limit: 20, type })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error(t('Failed to load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    if (isIn) partysAPI.list({ limit: 100 }).then((r) => setParties(r.data.data)).catch(() => {});
    else partysAPI.list({ limit: 100 }).then((r) => setParties(r.data.data)).catch(() => {});
    accountingAPI.banks().then((r) => setBanks(r.data.data)).catch(() => {});
  }, [location.pathname]);

  const save = async () => {
    if (saving) return undefined;
    if (!(Number(form.amount) > 0)) return error(t('Enter valid amount'));
    setSaving(true);
    try {
      const res = await paymentsAPI.create({
        payment_type: type,
        party_type: isIn ? 'party' : 'party',
        party_id: form.party_id || null,
        payment_date: form.payment_date,
        amount: Number(form.amount),
        payment_mode: form.payment_mode,
        bank_account_id: form.bank_account_id || null,
        notes: form.notes,
      });
      // The server settles the money against open bills; tell the user when
      // part of it could not be matched and is left on account.
      const extra = Number(res.data.data?.unallocated_amount) || 0;
      if (extra > 0) success(`${t('Payment recorded')} — ${formatMoney(extra)} ${t('kept on account as advance')}`);
      else success(t('Payment recorded'));
      setModal(false);
      setForm({ party_id: '', payment_date: today(), amount: '', payment_mode: 'cash', bank_account_id: '', notes: '' });
      load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  const receiptPdf = async (id) => { try { const r = await paymentsAPI.pdf(id); success(`${t('PDF saved')}: ${r.data.data.fileName}`); } catch { error(t('PDF export failed')); } };

  const remove = async (id) => {
    if (!(await confirm(t('Delete this payment?')))) return;
    try { await paymentsAPI.remove(id); success(t('Deleted')); load(pagination.page); }
    catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t(title)}</h1><p className="page-subtitle">{pagination.total} {t('records')}</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={async () => {
            try {
              const r = await settingsAPI.exportPdf('payments', { type });
              success(`${t('PDF saved')}: ${r.data.data.fileName}`);
            } catch { error(t('Export failed')); }
          }}>
            <Download size={18} /> {t('Export PDF')}
          </button>
          <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> {t('Record Payment')}</button>
        </div>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState title="No payments" action={<button className="btn btn-primary" onClick={() => setModal(true)}>{t('Record Payment')}</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Party')}</th><th>{t('Mode')}</th><th>{t('Amount')}</th><th>{t('Notes')}</th><th>{t('Actions')}</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td data-label={t('Number')} style={{ fontWeight: 600 }}>{p.payment_number}</td>
                      <td data-label={t('Date')}>{p.payment_date}</td>
                      <td data-label={t('Party')}>{p.party_name || '—'}</td>
                      <td data-label={t('Mode')}><span className="badge badge-info">{t(p.payment_mode)}</span></td>
                      <td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(p.amount)}</td>
                      <td data-label={t('Notes')}>{p.notes || '—'}</td>
                      <td data-label={t('Actions')}><button className="btn-icon" title="PDF" onClick={() => receiptPdf(p.id)}><FileText size={16} /></button><button className="btn-icon" onClick={() => remove(p.id)}><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pagination} onChange={load} />
          </>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={`${t('Record')} ${t(title)}`}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('Saving...') : t('Save')}</button></>}
      >
        <div className="form-group">
          <label className="form-label">{t(isIn ? 'Party' : 'Party')}</label>
          <select className="form-control" value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })}>
            <option value="">{t('Select')}</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {outstanding > 0 && (
            <div className="form-hint">
              {t('Outstanding')}: <strong>{formatMoney(outstanding)}</strong> — {t('the amount is settled against the oldest open bills first')}
            </div>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Date')}</label>
            <input className="form-control" type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Amount')}<span className="required">*</span></label>
            <input className="form-control" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Mode')}</label>
            <select className="form-control" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
              <option value="cash">{t('Cash')}</option><option value="upi">{t('UPI')}</option><option value="bank">{t('Bank')}</option><option value="cheque">{t('Cheque')}</option><option value="card">{t('Card')}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Account')}</label>
            <select className="form-control" value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}>
              <option value="">{t('Default Cash')}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.account_name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Notes')}</label>
          <textarea className="form-control" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
      </Modal>
    </div>
  );
}
