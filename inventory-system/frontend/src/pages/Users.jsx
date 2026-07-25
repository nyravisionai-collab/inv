import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Shield } from 'lucide-react';
import { usersAPI } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const empty = { username: '', email: '', password: '', full_name: '', phone: '', role: 'staff' };

export default function Users() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();

  const load = (page = 1) => {
    setLoading(true);
    usersAPI.list({ page, limit: 20 })
      .then((r) => { setItems(r.data.data); setPagination(r.data.pagination); })
      .catch(() => error('Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.username || !form.email || !form.full_name) return error('Fill required fields');
    if (!editId && !form.password) return error('Password required');
    setSaving(true);
    try {
      if (editId) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await usersAPI.update(editId, payload);
        success('User updated');
      } else {
        await usersAPI.create(form);
        success('User created');
      }
      setModal(false);
      load(pagination.page);
    } catch (err) {
      error(err.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Deactivate this user?')) return;
    try {
      await usersAPI.remove(id);
      success('User deactivated');
      load(pagination.page);
    } catch (err) {
      error(err.response?.data?.message || 'Failed');
    }
  };

  const roleBadge = (role) => {
    const map = { admin: 'badge-error', manager: 'badge-warning', staff: 'badge-info', cashier: 'badge-success' };
    return map[role] || 'badge-default';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">{pagination.total} users</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(empty); setEditId(null); setModal(true); }}>
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="card">
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState icon={Shield} title="No users" />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Username</th><th>Email</th><th>Phone</th>
                    <th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                      <td>{u.username}</td>
                      <td>{u.email}</td>
                      <td>{u.phone || '—'}</td>
                      <td><span className={`badge ${roleBadge(u.role)}`}>{u.role}</span></td>
                      <td><span className={`badge ${u.is_active ? 'badge-success' : 'badge-error'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>{u.last_login || 'Never'}</td>
                      <td>
                        <div className="table-actions">
                          <button className="btn-icon" onClick={() => {
                            setForm({ username: u.username, email: u.email, password: '', full_name: u.full_name, phone: u.phone || '', role: u.role });
                            setEditId(u.id);
                            setModal(true);
                          }}><Edit size={16} /></button>
                          <button className="btn-icon" onClick={() => remove(u.id)}><Trash2 size={16} /></button>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit User' : 'Add User'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Full Name <span className="required">*</span></label>
            <input className="form-control" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Username <span className="required">*</span></label>
            <input className="form-control" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editId} />
          </div>
          <div className="form-group">
            <label className="form-label">Email <span className="required">*</span></label>
            <input className="form-control" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-control" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Password {!editId && <span className="required">*</span>}</label>
            <input className="form-control" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editId ? 'Leave blank to keep' : ''} />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-control" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
