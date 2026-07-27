import { useEffect, useState, useRef } from 'react';
import { Search, Trash2, Plus, Minus, ShoppingCart, X } from 'lucide-react';
import { productsAPI, salesAPI, customersAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';
import { calcLineTotal, round2 } from '../utils/money';

export default function POS() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [barcode, setBarcode] = useState('');
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const barcodeRef = useRef(null);

  useEffect(() => {
    productsAPI.list({ limit: 100, is_active: '1' }).then((r) => setProducts(r.data.data)).catch(() => {});
    customersAPI.list({ limit: 100 }).then((r) => setCustomers(r.data.data)).catch(() => {});
    barcodeRef.current?.focus();
  }, []);

  const addToCart = (product) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product_id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        unit_price: product.selling_price,
        tax_rate: product.tax_rate || 0,
        discount_value: 0,
        discount_type: 'amount',
        tax_type: product.tax_type || 'exclusive',
        hsn_code: product.hsn_code,
        unit_id: product.unit_id,
        stock: product.current_stock,
      }];
    });
  };

  const updateQty = (idx, delta) => {
    setCart((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: Math.max(1, next[idx].quantity + delta) };
      return next;
    });
  };

  const removeFromCart = (idx) => setCart((prev) => prev.filter((_, i) => i !== idx));

  const handleBarcode = async (e) => {
    if (e.key === 'Enter' && barcode.trim()) {
      try {
        const r = await productsAPI.barcode(barcode.trim());
        addToCart(r.data.data);
        setBarcode('');
      } catch {
        error('Product not found: ' + barcode);
        setBarcode('');
      }
    }
  };

  const calcLine = (item) => calcLineTotal(item).total;

  const grandTotal = cart.reduce((s, i) => s + calcLine(i), 0);
  const rounded = round2(grandTotal);

  const filtered = search
    ? products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase()) ||
        p.barcode?.includes(search)
      )
    : products;

  const checkout = async () => {
    if (!cart.length) return error(t('Cart is empty'));
    setSaving(true);
    try {
      const paid = paidAmount !== '' ? Number(paidAmount) : rounded;
      const res = await salesAPI.create({
        invoice_type: 'pos',
        customer_id: customerId || null,
        items: cart,
        paid_amount: paid,
        payment_mode: paymentMode,
        status: 'completed',
      });
      success(`Sale complete! ${res.data.data.invoice_number} — ${formatMoney(rounded)}`);
      setCart([]);
      setPaidAmount('');
      setCustomerId('');
      barcodeRef.current?.focus();
    } catch (err) {
      error(apiErrorMessage(err, t, 'Checkout failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ margin: '-24px' }}>
      <div className="pos-layout">
        <div className="pos-products">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <div className="search-box" style={{ flex: 1, maxWidth: 'none' }}>
              <Search size={18} />
              <input placeholder={t('Search products...')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input
              ref={barcodeRef}
              className="form-control"
              style={{ width: 180 }}
              placeholder={t('Scan barcode...')}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={handleBarcode}
            />
          </div>
          <div className="pos-product-grid">
            {filtered.map((p) => (
              <div key={p.id} className="pos-product-card" onClick={() => addToCart(p)}>
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.name}
                    loading="lazy"
                    style={{ width: 48, height: 48, borderRadius: 10, margin: '0 auto 8px', display: 'block', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{
                    width: 48, height: 48, borderRadius: 10, margin: '0 auto 8px',
                    background: 'linear-gradient(135deg, var(--primary-light), var(--primary))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 16,
                  }}>{p.name[0]}</div>
                )}
                <div className="name">{p.name}</div>
                <div className="price">{formatMoney(p.selling_price)}</div>
                <div className="stock">Stock: {p.current_stock}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="pos-cart">
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShoppingCart size={20} /> Cart ({cart.length})</strong>
              {cart.length > 0 && <button className="btn btn-sm btn-secondary" onClick={() => setCart([])}><Trash2 size={14} /> Clear</button>}
            </div>
            <select className="form-control" value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ height: 36 }}>
              <option value="">{t('Walk-in Customer')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {cart.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                <ShoppingCart size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
                <p>{t('Tap products to add')}</p>
              </div>
            )}
            {cart.map((item, idx) => (
              <div key={idx} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatMoney(item.unit_price)} × {item.quantity}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => updateQty(idx, -1)}><Minus size={14} /></button>
                  <span style={{ width: 28, textAlign: 'center', fontWeight: 600 }}>{item.quantity}</span>
                  <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => updateQty(idx, 1)}><Plus size={14} /></button>
                </div>
                <div style={{ fontWeight: 600, minWidth: 70, textAlign: 'right' }}>{formatMoney(calcLine(item))}</div>
                <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => removeFromCart(idx)}><X size={14} /></button>
              </div>
            ))}
          </div>

          <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
              <span>{t('Total')}</span>
              <span style={{ color: 'var(--primary)' }}>{formatMoney(rounded)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <select className="form-control" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} style={{ height: 36 }}>
                <option value="cash">{t('Cash')}</option>
                <option value="upi">{t('UPI')}</option>
                <option value="card">{t('Card')}</option>
                <option value="bank">{t('Bank')}</option>
              </select>
              <input className="form-control" type="number" placeholder={`Paid (${rounded})`} value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)} style={{ height: 36 }} />
            </div>
            <button className="btn btn-primary btn-block" style={{ height: 48, fontSize: 16 }} onClick={checkout} disabled={saving || !cart.length}>
              {saving ? 'Processing...' : `Charge ${formatMoney(rounded)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
