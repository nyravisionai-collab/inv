import { useEffect, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { accountingAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { useConfirm } from '../context/ConfirmContext';
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
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const confirm = useConfirm();

  const load = (page = 1) => {
    setLoading(true);
    accountingAPI.expenses({ page, limit: 20 }).then((r) => { setItems(r.data.data); setPagination(r.data.pagination); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); accountingAPI.banks().then((r) => setBanks(r.data.data)).catch(() => {}); }, []);

  const save = async () => {
    if (!form.category || !form.amount) return error(t('Category and amount required'));
    setSaving(true);
    try {
      await accountingAPI.createExpense({ ...form, amount: Number(form.amount) });
      success(t('Expense recorded')); setModal(false); load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!(await confirm(t('Delete expense?')))) return;
    try { await accountingAPI.deleteExpense(id); success(t('Deleted')); load(pagination.page); }
    catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  const categories = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Marketing', 'Maintenance', 'Office Supplies', 'Insurance', 'Other'];

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Expenses')}</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> Add Expense</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No expenses" /> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Category')}</th><th>{t('Description')}</th><th>{t('Mode')}</th><th>{t('Amount')}</th><th></th></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td data-label={t('Number')}>{e.expense_number}</td><td data-label={t('Date')}>{e.expense_date}</td>
                      <td data-label={t('Category')}><span className="badge badge-warning">{t(e.category)}</span></td>
                      <td data-label={t('Description')}>{e.description || '—'}</td><td data-label={t('Mode')}>{t(e.payment_mode)}</td>
                      <td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(e.amount)}</td>
                      <td data-label={t('Actions')}><button className="btn-icon" onClick={() => remove(e.id)}><Trash2 size={16} /></button></td>
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
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{t('Save')}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Category')}</label>
            <select className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">{t('Select')}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Date')}</label>
            <input className="form-control" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Amount')}</label>
            <input className="form-control" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Payment Mode')}</label>
            <select className="form-control" value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>
              <option value="cash">{t('Cash')}</option><option value="upi">{t('UPI')}</option><option value="bank">{t('Bank')}</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Description')}</label>
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
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();

  const load = (page = 1) => {
    setLoading(true);
    accountingAPI.incomes({ page, limit: 20 }).then((r) => { setItems(r.data.data); setPagination(r.data.pagination); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.category || !form.amount) return error(t('Category and amount required'));
    setSaving(true);
    try {
      await accountingAPI.createIncome({ ...form, amount: Number(form.amount) });
      success(t('Income recorded')); setModal(false); load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Other Income')}</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> Add Income</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No income records" /> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Category')}</th><th>{t('Description')}</th><th>{t('Amount')}</th></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td data-label={t('Number')}>{e.income_number}</td><td data-label={t('Date')}>{e.income_date}</td>
                      <td data-label={t('Category')}><span className="badge badge-success">{e.category}</span></td>
                      <td data-label={t('Description')}>{e.description || '—'}</td>
                      <td data-label={t('Amount')} style={{ fontWeight: 600 }}>{formatMoney(e.amount)}</td>
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
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{t('Save')}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Category')}</label>
            <input className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t('Interest, Commission...')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Date')}</label>
            <input className="form-control" type="date" value={form.income_date} onChange={(e) => setForm({ ...form, income_date: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Amount')}</label>
          <input className="form-control" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Description')}</label>
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
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    accountingAPI.banks().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.account_name) return error(t('Name required'));
    try {
      await accountingAPI.createBank({ ...form, opening_balance: Number(form.opening_balance) || 0 });
      success(t('Account created')); setModal(false); load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
  };

  const total = items.reduce((s, b) => s + b.current_balance, 0);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Cash & Bank Accounts')}</h1><p className="page-subtitle">Total: {formatMoney(total)}</p></div>
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
              <thead><tr><th>{t('Account')}</th><th>{t('Type')}</th><th>{t('Bank')}</th><th>{t('Number')}</th><th>{t('Balance')}</th></tr></thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td data-label={t('Account')} style={{ fontWeight: 500 }}>{b.account_name} {b.is_default ? <span className="badge badge-info">{t('Default')}</span> : ''}</td>
                    <td data-label={t('Type')}><span className="badge badge-default">{t(b.account_type)}</span></td>
                    <td data-label={t('Bank')}>{b.bank_name || '—'}</td>
                    <td data-label={t('Number')}>{b.account_number || '—'}</td>
                    <td data-label={t('Balance')} style={{ fontWeight: 700 }}>{formatMoney(b.current_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Add Account"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save}>{t('Save')}</button></>}
      >
        <div className="form-group"><label className="form-label">{t('Account Name')}</label><input className="form-control" value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Type')}</label>
            <select className="form-control" value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
              <option value="cash">{t('Cash')}</option><option value="bank">{t('Bank')}</option><option value="upi">{t('UPI')}</option><option value="other">{t('Other')}</option>
            </select>
          </div>
          <div className="form-group"><label className="form-label">{t('Opening Balance')}</label><input className="form-control" type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">{t('Bank Name')}</label><input className="form-control" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">{t('Account Number')}</label><input className="form-control" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">{t('IFSC')}</label><input className="form-control" value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} /></div>
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
  const { formatMoney, t } = useAuth();

  const load = () => {
    setLoading(true);
    accountingAPI.cashBook({ from_date: from, to_date: to }).then((r) => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Cash Book')}</h1></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="form-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          <span>to</span>
          <input className="form-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          <button className="btn btn-primary" onClick={load}>{t('Load')}</button>
        </div>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Date')}</th><th>{t('Particular')}</th><th>{t('Type')}</th><th>{t('Ref')}</th><th>{t('Debit (In)')}</th><th>{t('Credit (Out)')}</th><th>{t('Balance')}</th></tr></thead>
                <tbody>
                  {(data?.entries || []).map((e, i) => (
                    <tr key={i}>
                      <td data-label={t('Date')}>{e.date}</td><td data-label={t('Particular')}>{e.particular}</td><td data-label={t('Type')}><span className="badge badge-default">{t(e.type)}</span></td>
                      <td data-label={t('Ref')}>{e.ref}</td>
                      <td data-label={t('Debit (In)')} style={{ color: 'var(--success)' }}>{e.debit ? formatMoney(e.debit) : '—'}</td>
                      <td data-label={t('Credit (Out)')} style={{ color: 'var(--error)' }}>{e.credit ? formatMoney(e.credit) : '—'}</td>
                      <td data-label={t('Balance')} style={{ fontWeight: 600 }}>{formatMoney(e.balance)}</td>
                    </tr>
                  ))}
                  {(!data?.entries || !data.entries.length) && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{t('No entries in this period')}</td></tr>
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
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    accountingAPI.journals().then((r) => setItems(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const valid = lines.filter((l) => l.account_name);
    if (valid.length < 2) return error(t('At least 2 lines required'));
    setSaving(true);
    try {
      await accountingAPI.createJournal({
        ...form,
        lines: valid.map((l) => ({ account_name: l.account_name, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      success(t('Journal entry created')); setModal(false); load();
    } catch (err) { error(apiErrorMessage(err, t, 'Failed')); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">{t('Journal Entries')}</h1></div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={18} /> New Entry</button>
      </div>
      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? <EmptyState title="No journal entries" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Narration')}</th><th>{t('Debit')}</th><th>{t('Credit')}</th></tr></thead>
              <tbody>
                {items.map((j) => (
                  <tr key={j.id}>
                    <td data-label={t('Number')} style={{ fontWeight: 600 }}>{j.entry_number}</td>
                    <td data-label={t('Date')}>{j.entry_date}</td>
                    <td data-label={t('Type')}><span className="badge badge-info">{t(j.entry_type)}</span></td>
                    <td data-label={t('Narration')}>{j.narration || '—'}</td>
                    <td data-label={t('Debit')}>{formatMoney(j.total_debit)}</td>
                    <td data-label={t('Credit')}>{formatMoney(j.total_credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Journal Entry" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button><button className="btn btn-primary" onClick={save} disabled={saving}>{t('Save')}</button></>}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Date')}</label>
            <input className="form-control" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Type')}</label>
            <select className="form-control" value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })}>
              <option value="journal">{t('Journal')}</option>
              <option value="contra">{t('Contra')}</option>
              <option value="payment">{t('Payment')}</option>
              <option value="receipt">{t('Receipt')}</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Narration')}</label>
          <input className="form-control" value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} />
        </div>
        {lines.map((line, idx) => (
          <div className="form-row" key={idx}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">{t('Account')}</label>
              <input className="form-control" value={line.account_name} onChange={(e) => { const n = [...lines]; n[idx].account_name = e.target.value; setLines(n); }} placeholder={t('Account name')} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Debit')}</label>
              <input className="form-control" type="number" value={line.debit} onChange={(e) => { const n = [...lines]; n[idx].debit = e.target.value; n[idx].credit = ''; setLines(n); }} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Credit')}</label>
              <input className="form-control" type="number" value={line.credit} onChange={(e) => { const n = [...lines]; n[idx].credit = e.target.value; n[idx].debit = ''; setLines(n); }} />
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={() => setLines([...lines, { account_name: '', debit: '', credit: '' }])}>+ Add Line</button>
      </Modal>
    </div>
  );
}
