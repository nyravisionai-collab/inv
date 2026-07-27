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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [barcode, setBarcode] = useState('');
  const { formatMoney, t } = useAuth();
  const { success, error } = useToast();
  const barcodeRef = useRef(null);

  const loadProducts = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [productsRes, customersRes] = await Promise.all([
        productsAPI.list({ limit: 100, is_active: '1' }),
        customersAPI.list({ limit: 100 }),
      ]);
      setProducts(productsRes.data.data);
      setCustomers(customersRes.data.data);
    } catch {
      setLoadError(true);
      error(t('Failed to load products'));
    } finally {
      setLoading(false);
      barcodeRef.current?.focus();
    }
  };

  useEffect(() => {
    loadProducts();
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
        error(`${t('Product not found')}: ${barcode}`);
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
      success(`${t('Sale complete')}! ${res.data.data.invoice_number} — ${formatMoney(rounded)}`);
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
    <div className="pos-shell">
      <div className="pos-layout">
        <div className="pos-products">
          <div className="pos-toolbar">
            <div className="search-box">
              <Search size={18} />
              <input placeholder={t('Search products...')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input
              ref={barcodeRef}
              className="form-control pos-barcode-input"
              placeholder={t('Scan barcode...')}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={handleBarcode}
            />
          </div>

          {loading ? (
            <div className="state-block"><div className="spinner" /></div>
          ) : loadError ? (
            <div className="state-block">
              <ShoppingCart className="state-block-icon" />
              <h3>{t('Failed to load products')}</h3>
              <p>{t('Check connection and try again')}</p>
              <div className="state-block-actions">
                <button className="btn btn-primary" onClick={loadProducts}>{t('Try Again')}</button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="pos-empty-products">
              <ShoppingCart size={40} style={{ opacity: 0.35, marginBottom: 8 }} />
              <p>{t('No products found')}</p>
            </div>
          ) : (
            <div className="pos-product-grid">
              {filtered.map((p) => (
                <button key={p.id} type="button" className="pos-product-card" onClick={() => addToCart(p)}>
                  {p.image ? (
                    <img src={p.image} alt={p.name} loading="lazy" className="pos-product-img" />
                  ) : (
                    <div className="pos-product-avatar">{p.name?.[0] || '?'}</div>
                  )}
                  <div className="name">{p.name}</div>
                  <div className="price">{formatMoney(p.selling_price)}</div>
                  <div className="stock">{t('Stock')}: {p.current_stock}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pos-cart">
          <div className="pos-cart-header">
            <div className="pos-cart-title-row">
              <strong className="pos-cart-title"><ShoppingCart size={20} /> {t('Cart')} ({cart.length})</strong>
              {cart.length > 0 && <button className="btn btn-sm btn-secondary" onClick={() => setCart([])}><Trash2 size={14} /> {t('Clear')}</button>}
            </div>
            <select className="form-control" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t('Walk-in Customer')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="pos-cart-items">
            {cart.length === 0 && (
              <div className="state-block compact">
                <ShoppingCart className="state-block-icon" />
                <p>{t('Tap products to add')}</p>
              </div>
            )}
            {cart.map((item, idx) => (
              <div key={idx} className="pos-cart-line">
                <div>
                  <div className="pos-cart-line-name">{item.product_name}</div>
                  <div className="pos-cart-line-meta">{formatMoney(item.unit_price)} × {item.quantity}</div>
                </div>
                <div className="qty-stepper" aria-label={t('Qty')}>
                  <button className="btn-icon" onClick={() => updateQty(idx, -1)} aria-label={t('Decrease quantity')}><Minus size={16} /></button>
                  <span className="qty-value">{item.quantity}</span>
                  <button className="btn-icon" onClick={() => updateQty(idx, 1)} aria-label={t('Increase quantity')}><Plus size={16} /></button>
                </div>
                <div className="pos-line-total">{formatMoney(calcLine(item))}</div>
                <button className="btn-icon" onClick={() => removeFromCart(idx)} aria-label={t('Remove')}><X size={16} /></button>
              </div>
            ))}
          </div>

          <div className="pos-cart-footer">
            <div className="pos-total-row">
              <span>{t('Total')}</span>
              <span style={{ color: 'var(--primary)' }}>{formatMoney(rounded)}</span>
            </div>
            <div className="pos-payment-grid">
              <select className="form-control" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                <option value="cash">{t('Cash')}</option>
                <option value="upi">{t('UPI')}</option>
                <option value="card">{t('Card')}</option>
                <option value="bank">{t('Bank')}</option>
              </select>
              <input className="form-control" type="number" placeholder={`${t('Paid')} (${rounded})`} value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block pos-charge-btn" onClick={checkout} disabled={saving || !cart.length}>
              {saving ? t('Processing...') : `${t('Charge')} ${formatMoney(rounded)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
