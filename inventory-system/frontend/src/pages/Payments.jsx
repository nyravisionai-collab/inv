import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Search, Trash2 } from 'lucide-react';
import { paymentsAPI, customersAPI, suppliersAPI, accountingAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
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
  const { formatMoney } = useAuth();
  const { success, error } = useToast();

  const load = (page = 1) => {
    setLoading(true);
    paymentsAPI.list({ page, limit: 20, type })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error('Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    if (isIn) customersAPI.list({ limit: 100 }).then((r) => setParties(r.data.data)).catch(() => {});
    else suppliersAPI.list({ limit: 100 }).then((r) => setParties(r.data.data)).catch(() => {});
    accountingAPI.banks().then((r) => setBanks(r.data.data)).catch(() => {});
  }, [location.pathname]);

  const save = async () => {
    if (!form.amount || form.amount <= 0) return error('Enter valid amount');
    setSaving(true);
    try {
      await paymentsAPI.create({
        payment_type: type,
        party_type: isIn ? 'customer' : 'supplier',
        party_id: form.party_id || null,
        payment_date: form.payment_date,
        amount: Number(form.amount),
        payment_mode: form.payment_mode,
        bank_account_id: form.bank_account_id || null,
        notes: form.notes,
      });
      success('Payment recorded');
      setModal(false);
      setForm({ party_id: '', payment_date: today(), amount: '', payment_mode: 'cash', bank_account_id: '', notes: '' });
      load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this payment?')) return;
    try { await paymentsAPI.remove(id); success('Deleted'); load(pagination.page); }
    catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{title}</h1><p className="page-subtitle">{pagination.total} records</p></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> Record Payment</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState title="No payments" action={<button className="btn btn-primary" onClick={() => setModal(true)}>Record Payment</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Number</th><th>Date</th><th>Party</th><th>Mode</th><th>Amount</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.payment_number}</td>
                      <td>{p.payment_date}</td>
                      <td>{p.party_name || '—'}</td>
                      <td><span className="badge badge-info">{p.payment_mode}</span></td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(p.amount)}</td>
                      <td>{p.notes || '—'}</td>
                      <td><button className="btn-icon" onClick={() => remove(p.id)}><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pagination} onChange={load} />
          </>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={`Record ${title}`}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></>}
      >
        <div className="form-group">
          <label className="form-label">{isIn ? 'Customer' : 'Supplier'}</label>
          <select className="form-control" value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })}>
            <option value="">Select</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-control" type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Amount <span className="required">*</span></label>
            <input className="form-control" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Mode</label>
            <select className="form-control" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
              <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="card">Card</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Account</label>
            <select className="form-control" value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}>
              <option value="">Default Cash</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.account_name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-control" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
      </Modal>
    </div>
  );
}
