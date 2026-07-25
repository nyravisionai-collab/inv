import { useEffect, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { accountingAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

function today() { return new Date().toISOString().slice(0, 10); }

export function Expenses() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [banks, setBanks] = useState([]);
  const [form, setForm] = useState({ category: '', expense_date: today(), amount: '', payment_mode: 'cash', description: '' });
  const [saving, setSaving] = useState(false);
  const { formatMoney } = useAuth();
  const { success, error } = useToast();

  const load = (page = 1) => {
    setLoading(true);
    accountingAPI.expenses({ page, limit: 20 }).then((r) => { setItems(r.data.data); setPagination(r.data.pagination); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); accountingAPI.banks().then((r) => setBanks(r.data.data)).catch(() => {}); }, []);

  const save = async () => {
    if (!form.category || !form.amount) return error('Category and amount required');
    setSaving(true);
    try {
      await accountingAPI.createExpense({ ...form, amount: Number(form.amount) });
      success('Expense recorded'); setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete expense?')) return;
    try { await accountingAPI.deleteExpense(id); success('Deleted'); load(pagination.page); }
    catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  const categories = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Marketing', 'Maintenance', 'Office Supplies', 'Insurance', 'Other'];

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Expenses</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> Add Expense</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No expenses" /> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Number</th><th>Date</th><th>Category</th><th>Description</th><th>Mode</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td>{e.expense_number}</td><td>{e.expense_date}</td>
                      <td><span className="badge badge-warning">{e.category}</span></td>
                      <td>{e.description || '—'}</td><td>{e.payment_mode}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(e.amount)}</td>
                      <td><button className="btn-icon" onClick={() => remove(e.id)}><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pagination} onChange={load} />
          </>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Add Expense"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Select</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-control" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount</label>
            <input className="form-control" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Payment Mode</label>
            <select className="form-control" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
              <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        </div>
      </Modal>
    </div>
  );
}

export function Incomes() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ category: '', income_date: today(), amount: '', payment_mode: 'cash', description: '' });
  const [saving, setSaving] = useState(false);
  const { formatMoney } = useAuth();
  const { success, error } = useToast();

  const load = (page = 1) => {
    setLoading(true);
    accountingAPI.incomes({ page, limit: 20 }).then((r) => { setItems(r.data.data); setPagination(r.data.pagination); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.category || !form.amount) return error('Category and amount required');
    setSaving(true);
    try {
      await accountingAPI.createIncome({ ...form, amount: Number(form.amount) });
      success('Income recorded'); setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Other Income</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> Add Income</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No income records" /> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Number</th><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td>{e.income_number}</td><td>{e.income_date}</td>
                      <td><span className="badge badge-success">{e.category}</span></td>
                      <td>{e.description || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pagination} onChange={load} />
          </>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Add Income"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <input className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Interest, Commission..." />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-control" type="date" value={form.income_date} onChange={(e) => setForm({ ...form, income_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Amount</label>
          <input className="form-control" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        </div>
      </Modal>
    </div>
  );
}

export function Banks() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ account_name: '', bank_name: '', account_number: '', ifsc: '', account_type: 'bank', opening_balance: 0 });
  const { formatMoney } = useAuth();
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    accountingAPI.banks().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.account_name) return error('Name required');
    try {
      await accountingAPI.createBank({ ...form, opening_balance: Number(form.opening_balance) || 0 });
      success('Account created'); setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
  };

  const total = items.reduce((s, b) => s + b.current_balance, 0);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Cash & Bank Accounts</h1><p className="page-subtitle">Total: {formatMoney(total)}</p></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> Add Account</button>
      </div>
      <div className="stats-grid">
        {items.map((b) => (
          <div key={b.id} className="stat-card">
            <div className={`stat-icon ${b.account_type === 'cash' ? 'green' : b.account_type === 'upi' ? 'purple' : 'blue'}`}>
              <Wallet size={24} />
            </div>
            <div>
              <div className="stat-label">{b.account_name}</div>
              <div className="stat-value">{formatMoney(b.current_balance)}</div>
              <div className="stat-sub">{b.bank_name || b.account_type}{b.account_number ? ` · ${b.account_number.slice(-4)}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Type</th><th>Bank</th><th>Number</th><th>Balance</th></tr></thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>{b.account_name} {b.is_default ? <span className="badge badge-info">Default</span> : ''}</td>
                    <td><span className="badge badge-default">{b.account_type}</span></td>
                    <td>{b.bank_name || '—'}</td>
                    <td>{b.account_number || '—'}</td>
                    <td style={{ fontWeight: 700 }}>{formatMoney(b.current_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Add Account"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}
      >
        <div className="form-group"><label className="form-label">Account Name</label><input className="form-control" value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-control" value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
              <option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="other">Other</option>
            </select>
          </div>
          <div className="form-group"><label className="form-label">Opening Balance</label><input className="form-control" type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">Bank Name</label><input className="form-control" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Account Number</label><input className="form-control" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">IFSC</label><input className="form-control" value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}

export function CashBook() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
  const [to, setTo] = useState(today());
  const { formatMoney } = useAuth();

  const load = () => {
    setLoading(true);
    accountingAPI.cashBook({ from_date: from, to_date: to }).then((r) => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Cash Book</h1></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="form-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          <span>to</span>
          <input className="form-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          <button className="btn btn-primary" onClick={load}>Load</button>
        </div>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Particular</th><th>Type</th><th>Ref</th><th>Debit (In)</th><th>Credit (Out)</th><th>Balance</th></tr></thead>
                <tbody>
                  {(data?.entries || []).map((e, i) => (
                    <tr key={i}>
                      <td>{e.date}</td><td>{e.particular}</td><td><span className="badge badge-default">{e.type}</span></td>
                      <td>{e.ref}</td>
                      <td style={{ color: 'var(--success)' }}>{e.debit ? formatMoney(e.debit) : '—'}</td>
                      <td style={{ color: 'var(--error)' }}>{e.credit ? formatMoney(e.credit) : '—'}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(e.balance)}</td>
                    </tr>
                  ))}
                  {(!data?.entries || !data.entries.length) && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No entries in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && (
              <div className="card-body" style={{ textAlign: 'right', fontWeight: 700, fontSize: 16 }}>
                Closing Balance: {formatMoney(data.closing_balance)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Journals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ entry_date: today(), entry_type: 'journal', narration: '' });
  const [lines, setLines] = useState([
    { account_name: '', debit: '', credit: '' },
    { account_name: '', debit: '', credit: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const { formatMoney } = useAuth();
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    accountingAPI.journals().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const valid = lines.filter((l) => l.account_name);
    if (valid.length < 2) return error('At least 2 lines required');
    setSaving(true);
    try {
      await accountingAPI.createJournal({
        ...form,
        lines: valid.map((l) => ({ account_name: l.account_name, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      success('Journal entry created'); setModal(false); load();
    } catch (err) { error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Journal Entries</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> New Entry</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No journal entries" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Number</th><th>Date</th><th>Type</th><th>Narration</th><th>Debit</th><th>Credit</th></tr></thead>
              <tbody>
                {items.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 600 }}>{j.entry_number}</td>
                    <td>{j.entry_date}</td>
                    <td><span className="badge badge-info">{j.entry_type}</span></td>
                    <td>{j.narration || '—'}</td>
                    <td>{formatMoney(j.total_debit)}</td>
                    <td>{formatMoney(j.total_credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Journal Entry" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-control" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-control" value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })}>
              <option value="journal">Journal</option>
              <option value="contra">Contra</option>
              <option value="payment">Payment</option>
              <option value="receipt">Receipt</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Narration</label>
          <input className="form-control" value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} />
        </div>
        {lines.map((line, idx) => (
          <div className="form-row" key={idx}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Account</label>
              <input className="form-control" value={line.account_name} onChange={(e) => { const n = [...lines]; n[idx].account_name = e.target.value; setLines(n); }} placeholder="Account name" />
            </div>
            <div className="form-group">
              <label className="form-label">Debit</label>
              <input className="form-control" type="number" value={line.debit} onChange={(e) => { const n = [...lines]; n[idx].debit = e.target.value; n[idx].credit = ''; setLines(n); }} />
            </div>
            <div className="form-group">
              <label className="form-label">Credit</label>
              <input className="form-control" type="number" value={line.credit} onChange={(e) => { const n = [...lines]; n[idx].credit = e.target.value; n[idx].debit = ''; setLines(n); }} />
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setLines([...lines, { account_name: '', debit: '', credit: '' }])}>+ Add Line</button>
      </Modal>
    </div>
  );
}
