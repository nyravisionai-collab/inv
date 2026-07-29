import { useEffect, useState } from 'react';
import { Save, Download, Upload, Database } from 'lucide-react';
import { settingsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';

export default function Settings() {
  const { settings, refreshSettings, isAdmin, toggleTheme, theme, t } = useAuth();
  const { success, error } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState([]);
  const [pdfExports, setPdfExports] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [tab, setTab] = useState('company');

  useEffect(() => {
    if (settings) setForm({ ...settings });
  }, [settings]);

  useEffect(() => {
    if (isAdmin) {
      settingsAPI.backups().then((r) => setBackups(r.data.data)).catch(() => {});
      settingsAPI.exports().then((r) => setPdfExports(r.data.data)).catch(() => {});
    }
    settingsAPI.taxRates().then((r) => setTaxRates(r.data.data)).catch(() => {});
  }, [isAdmin]);

  const save = async () => {
    setSaving(true);
    try {
      await settingsAPI.update(form);
      await refreshSettings();
      success(t('Settings saved'));
    } catch (err) {
      error(apiErrorMessage(err, t, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const doBackup = async () => {
    try {
      const r = await settingsAPI.backup();
      success(`Backup created: ${r.data.data.db_backup}`);
      const b = await settingsAPI.backups();
      setBackups(b.data.data);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Backup failed'));
    }
  };

  const doExport = async (type, format) => {
    try {
      const r = await settingsAPI.export({ type, format });
      if (format === 'json') {
        const blob = new Blob([JSON.stringify(r.data.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${type}-export.json`; a.click();
      } else {
        const url = URL.createObjectURL(r.data);
        const a = document.createElement('a');
        a.href = url; a.download = `${type}-export.${format}`; a.click();
      }
      success(t('Export downloaded'));
    } catch {
      error(t('Export failed'));
    }
  };

  const doPdfExport = async (type) => {
    try {
      const r = await settingsAPI.exportPdf(type);
      success(`${t('PDF saved')}: ${r.data.data.fileName}`);
      const files = await settingsAPI.exports(); setPdfExports(files.data.data);
    } catch { error(t('PDF export failed')); }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', 'products');
    try {
      const r = await settingsAPI.import(fd);
      success(r.data.message);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Import failed'));
    }
    e.target.value = '';
  };

  const tabs = [
    { id: 'company', label: 'Company' },
    { id: 'invoice', label: 'Invoice' },
    { id: 'tax', label: 'Tax' },
    { id: 'appearance', label: 'Appearance' },
    ...(isAdmin ? [{ id: 'backup', label: 'Backup & Data' }] : []),
  ];

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Settings')}</h1>
          <p className="page-subtitle">{t('Configure your business')}</p>
        </div>
        {tab !== 'backup' && tab !== 'appearance' && (
          <button className="btn btn-primary" onClick={save} disabled={saving || !isAdmin}>
            <Save size={18} /> {saving ? t('Saving...') : t('Save Changes')}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'company' && (
        <div className="card">
          <div className="card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{t('Company Name')}</label>
                <input className="form-control" value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Legal Name')}</label>
                <input className="form-control" value={form.legal_name || ''} onChange={(e) => set('legal_name', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">{t('Address')}</label>
                <input className="form-control" value={form.address || ''} onChange={(e) => set('address', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('City')}</label>
                <input className="form-control" value={form.city || ''} onChange={(e) => set('city', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('State')}</label>
                <input className="form-control" value={form.state || ''} onChange={(e) => set('state', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Pincode')}</label>
                <input className="form-control" value={form.pincode || ''} onChange={(e) => set('pincode', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Phone')}</label>
                <input className="form-control" value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Email')}</label>
                <input className="form-control" value={form.email || ''} onChange={(e) => set('email', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('GSTIN')}</label>
                <input className="form-control" value={form.gstin || ''} onChange={(e) => set('gstin', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('PAN')}</label>
                <input className="form-control" value={form.pan || ''} onChange={(e) => set('pan', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Currency Symbol')}</label>
                <input className="form-control" value={form.currency_symbol || ''} onChange={(e) => set('currency_symbol', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Website')}</label>
                <input className="form-control" value={form.website || ''} onChange={(e) => set('website', e.target.value)} disabled={!isAdmin} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'invoice' && (
        <div className="card">
          <div className="card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{t('Invoice Prefix')}</label>
                <input className="form-control" value={form.invoice_prefix || ''} onChange={(e) => set('invoice_prefix', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Purchase Prefix')}</label>
                <input className="form-control" value={form.purchase_prefix || ''} onChange={(e) => set('purchase_prefix', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Estimate Prefix')}</label>
                <input className="form-control" value={form.estimate_prefix || ''} onChange={(e) => set('estimate_prefix', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Invoice Template')}</label>
                <select className="form-control" value={form.invoice_template || 'standard'} onChange={(e) => set('invoice_template', e.target.value)} disabled={!isAdmin}>
                  <option value="standard">{t('Standard')}</option>
                  <option value="compact">{t('Compact')}</option>
                  <option value="detailed">{t('Detailed')}</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">{t('Default Terms')}</label>
                <textarea className="form-control" value={form.invoice_terms || ''} onChange={(e) => set('invoice_terms', e.target.value)} rows={3} disabled={!isAdmin} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">{t('Default Notes')}</label>
                <textarea className="form-control" value={form.invoice_notes || ''} onChange={(e) => set('invoice_notes', e.target.value)} rows={2} disabled={!isAdmin} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'tax' && (
        <div className="card">
          <div className="card-body">
            <div className="form-row" style={{ marginBottom: 24 }}>
              <div className="form-group">
                <label className="form-label">{t('Tax Enabled')}</label>
                <select className="form-control" value={form.tax_enabled ? '1' : '0'} onChange={(e) => set('tax_enabled', e.target.value === '1' ? 1 : 0)} disabled={!isAdmin}>
                  <option value="1">{t('Yes')}</option>
                  <option value="0">No</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{t('Default Tax Rate %')}</label>
                <input className="form-control" type="number" value={form.default_tax_rate || 0} onChange={(e) => set('default_tax_rate', e.target.value)} disabled={!isAdmin} />
              </div>
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{t('Tax Rates')}</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Name')}</th><th>{t('Rate')}</th><th>{t('CGST')}</th><th>{t('SGST')}</th><th>{t('IGST')}</th></tr></thead>
                <tbody>
                  {taxRates.map((rate) => (
                    <tr key={rate.id}>
                      <td data-label={t('Name')}>{rate.name}</td><td data-label={t('Rate')}>{rate.rate}%</td><td data-label={t('CGST')}>{rate.cgst}%</td><td data-label={t('SGST')}>{rate.sgst}%</td><td data-label={t('IGST')}>{rate.igst}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="card">
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">{t('Theme')}</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => theme !== 'light' && toggleTheme()}>
                  {t('Light Mode')}
                </button>
                <button className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => theme !== 'dark' && toggleTheme()}>
                  {t('Dark Mode')}
                </button>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">{t('Language')}</label>
              <select className="form-control" value={form.language || 'en'} onChange={(e) => set('language', e.target.value)} style={{ maxWidth: 200 }} disabled={!isAdmin}>
                <option value="en">{t('English')}</option>
                <option value="hi">{t('Hindi')}</option>
                <option value="gu">{t('Gujarati')}</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' && isAdmin && (
        <div>
          <div className="grid-2" style={{ marginBottom: 20 }}>
            <div className="card">
              <div className="card-header"><div className="card-title">{t('Database Backup')}</div></div>
              <div className="card-body">
                <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
                  Create a full SQLite backup of your database. Store backups safely.
                </p>
                <button className="btn btn-primary" onClick={doBackup}><Database size={18} /> Create Backup</button>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title">{t('Import / Export')}</div></div>
              <div className="card-body">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => doExport('products', 'csv')}><Download size={16} /> Products CSV</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => doExport('products', 'xlsx')}><Download size={16} /> Products Excel</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => doExport('customers', 'csv')}><Download size={16} /> Customers CSV</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => doExport('sales', 'xlsx')}><Download size={16} /> Sales Excel</button>
                  {['products', 'customers', 'suppliers', 'sales', 'purchases', 'payments', 'expenses', 'stock'].map((type) => <button key={type} className="btn btn-sm btn-secondary" onClick={() => doPdfExport(type)}><Download size={16} /> {type} PDF</button>)
                </div>
                <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                  <Upload size={16} /> Import Products
                  <input type="file" accept=".csv,.xlsx,.xls" hidden onChange={handleImport} />
                </label>
              </div>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">{t('PDF Export History')}</div></div>
            {pdfExports.length === 0 ? <div className="empty-state"><p>{t('No PDF exports yet')}</p></div> : <div className="table-wrap"><table><thead><tr><th>{t('File')}</th><th>{t('Size')}</th><th>{t('Created')}</th></tr></thead><tbody>{pdfExports.map((file) => <tr key={file.name}><td>{file.name}</td><td>{(file.size / 1024).toFixed(1)} KB</td><td>{new Date(file.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="card">
            <div className="card-header"><div className="card-title">{t('Backup History')}</div></div>
            {backups.length === 0 ? (
              <div className="empty-state"><p>{t('No backups yet')}</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('File')}</th><th>{t('Size')}</th><th>{t('Created')}</th></tr></thead>
                  <tbody>
                    {backups.map((b) => (
                      <tr key={b.name}>
                        <td data-label={t('File')} style={{ fontWeight: 500 }}>{b.name}</td>
                        <td data-label={t('Size')}>{(b.size / 1024).toFixed(1)} KB</td>
                        <td data-label={t('Created')}>{new Date(b.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
