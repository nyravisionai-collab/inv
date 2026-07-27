import { useEffect, useState } from 'react';
import { Plus, Search, Edit, Trash2, QrCode, ImagePlus, X } from 'lucide-react';
import { productsAPI, inventoryAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { useConfirm } from '../context/ConfirmContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const empty = {
  name: '', sku: '', barcode: '', hsn_code: '', description: '',
  category_id: '', brand_id: '', unit_id: '', purchase_price: '', selling_price: '',
  mrp: '', tax_rate: '18', min_stock: '5', opening_stock: '0', is_service: false,
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = /\.(jpe?g|png|gif|webp)$/i;

export default function Products() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [qrModal, setQrModal] = useState(null);
  const [allBarcodesModal, setAllBarcodesModal] = useState(false);
  const [allBarcodesList, setAllBarcodesList] = useState([]);
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const confirm = useConfirm();

  const load = (page = 1) => {
    setLoading(true);
    productsAPI.list({ page, limit: 20, search: search || undefined })
      .then((r) => {
        setItems(r.data.data);
        setPagination(r.data.pagination);
      })
      .catch(() => error(t('Failed to load products')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    inventoryAPI.categories().then((r) => setCategories(r.data.data)).catch(() => {});
    inventoryAPI.brands().then((r) => setBrands(r.data.data)).catch(() => {});
    inventoryAPI.units().then((r) => setUnits(r.data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(1), 300);
    return () => clearTimeout(t);
  }, [search]);

  const openCreate = () => {
    setForm(empty); setEditId(null); setImageFile(null); setImagePreview(''); setModal(true);
  };

  const pickImage = (file) => {
    if (!file) return;
    if (!IMAGE_TYPES.test(file.name)) return error(t('Only JPG, PNG, GIF or WebP images are allowed'));
    if (file.size > MAX_IMAGE_BYTES) return error(t('Image must be smaller than 5 MB'));
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => { setImageFile(null); setImagePreview(''); };
  const openEdit = (p) => {
    setForm({
      name: p.name, sku: p.sku || '', barcode: p.barcode || '', hsn_code: p.hsn_code || '',
      description: p.description || '', category_id: p.category_id || '', brand_id: p.brand_id || '',
      unit_id: p.unit_id || '', purchase_price: p.purchase_price, selling_price: p.selling_price,
      mrp: p.mrp, tax_rate: p.tax_rate, min_stock: p.min_stock, opening_stock: p.current_stock,
      is_service: !!p.is_service,
      image: p.image || '',
    });
    setEditId(p.id);
    setImageFile(null);
    setImagePreview(p.image || '');
    setModal(true);
  };

  const save = async () => {
    if (!form.name) return error(t('Product name is required'));
    setSaving(true);
    try {
      const payload = {
        ...form,
        category_id: form.category_id || null,
        brand_id: form.brand_id || null,
        unit_id: form.unit_id || null,
        purchase_price: Number(form.purchase_price) || 0,
        selling_price: Number(form.selling_price) || 0,
        mrp: Number(form.mrp) || 0,
        tax_rate: Number(form.tax_rate) || 0,
        min_stock: Number(form.min_stock) || 0,
        opening_stock: Number(form.opening_stock) || 0,
        // A File switches the request to multipart; '' clears an existing photo.
        image: imageFile || (imagePreview ? undefined : ''),
      };
      if (payload.image === undefined) delete payload.image;
      if (editId) {
        await productsAPI.update(editId, payload);
        success(t('Product updated'));
      } else {
        await productsAPI.create(payload);
        success(t('Product created'));
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
    if (!(await confirm(t('Deactivate this product?')))) return;
    try {
      await productsAPI.remove(id);
      success(t('Product deactivated'));
      load(pagination.page);
    } catch (err) {
      error(apiErrorMessage(err, t, 'Delete failed'));
    }
  };

  const showQr = async (id) => {
    try {
      const r = await productsAPI.generateBarcode(id);
      setQrModal(r.data.data);
    } catch {
      error(t('Failed to generate barcode'));
    }
  };

  const openAllBarcodes = async () => {
    try {
      const r = await productsAPI.allBarcodes();
      setAllBarcodesList(r.data.data);
      setAllBarcodesModal(true);
    } catch {
      error(t('Failed to load barcodes'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Products')}</h1>
          <p className="page-subtitle">{pagination.total} products</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={openAllBarcodes}><QrCode size={18} /> {t('Print All Barcodes')}</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> Add Product</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ maxWidth: 320 }}>
            <Search size={18} />
            <input placeholder={t('Search products...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="spinner" /> : items.length === 0 ? (
          <EmptyState title="No products" message="Add your first product to get started" action={<button className="btn btn-primary" onClick={openCreate}>{t('Add Product')}</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Photo')}</th><th>{t('Name')}</th><th>{t('SKU')}</th><th>{t('Category')}</th><th>{t('Purchase')}</th><th>{t('Selling')}</th>
                    <th>{t('Stock')}</th><th>{t('Tax')}</th><th>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="product-thumb">
                          {p.image ? <img src={p.image} alt={p.name} loading="lazy" /> : <ImagePlus size={16} />}
                        </div>
                      </td>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td>{p.sku || '—'}</td>
                      <td>{p.category_name || '—'}</td>
                      <td>{formatMoney(p.purchase_price)}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(p.selling_price)}</td>
                      <td>
                        <span className={`badge ${p.current_stock <= p.min_stock && p.min_stock > 0 ? 'badge-error' : 'badge-success'}`}>
                          {p.current_stock} {p.unit_short || ''}
                        </span>
                      </td>
                      <td>{p.tax_rate}%</td>
                      <td>
                        <div className="table-actions">
                          <button className="btn-icon" onClick={() => showQr(p.id)} title="Barcode"><QrCode size={16} /></button>
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

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Product' : 'Add Product'} size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </>
        }
      >
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="product-photo">
            {imagePreview
              ? <img src={imagePreview} alt={form.name || t('Product Photo')} />
              : <ImagePlus size={26} />}
          </div>
          <div>
            <label className="form-label">{t('Product Photo')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                <ImagePlus size={16} /> {imagePreview ? t('Change Photo') : t('Upload Photo')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
              {imagePreview && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearImage}>
                  <X size={16} /> {t('Remove Photo')}
                </button>
              )}
            </div>
            <div className="form-hint">{t('JPG, PNG, GIF or WebP up to 5 MB')}</div>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">{t('Product Name')}<span className="required">*</span></label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('SKU')}</label>
            <input className="form-control" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Barcode')}</label>
            <input className="form-control" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('HSN Code')}</label>
            <input className="form-control" value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Category')}</label>
            <select className="form-control" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">{t('Select')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Brand')}</label>
            <select className="form-control" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
              <option value="">{t('Select')}</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Unit')}</label>
            <select className="form-control" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
              <option value="">{t('Select')}</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.short_name})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Purchase Price')}</label>
            <input className="form-control" type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Selling Price')}</label>
            <input className="form-control" type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('MRP')}</label>
            <input className="form-control" type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Tax Rate %')}</label>
            <select className="form-control" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}>
              {[0, 5, 12, 18, 28].map((t) => <option key={t} value={t}>{t}%</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Min Stock')}</label>
            <input className="form-control" type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
          </div>
          {!editId && (
            <div className="form-group">
              <label className="form-label">{t('Opening Stock')}</label>
              <input className="form-control" type="number" value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: e.target.value })} />
            </div>
          )}
        </div>
      </Modal>

      <Modal open={!!qrModal} onClose={() => setQrModal(null)} title="Barcode / QR Code">
        {qrModal && (
          <div style={{ textAlign: 'center' }}>
            <img src={qrModal.qr} alt="QR" style={{ width: 250, height: 250 }} />
            <p style={{ fontWeight: 600, marginTop: 12 }}>{qrModal.product.name}</p>
            <p style={{ color: 'var(--text-secondary)' }}>{qrModal.code}</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{formatMoney(qrModal.product.price)}</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => window.print()}>{t('Print')}</button>
          </div>
        )}
      </Modal>

      <Modal open={allBarcodesModal} onClose={() => setAllBarcodesModal(false)} title={t('All Product Barcodes')} size="xl"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAllBarcodesModal(false)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={() => window.print()}><QrCode size={18} /> {t('Print')}</button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
          {allBarcodesList.map((item) => (
            <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', textAlign: 'center', background: 'var(--surface)', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <img src={item.qr} alt="QR" style={{ width: 140, height: 140, margin: '0 auto' }} />
              <p style={{ fontWeight: 600, fontSize: 13, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{item.code}</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>{formatMoney(item.price)}</p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
