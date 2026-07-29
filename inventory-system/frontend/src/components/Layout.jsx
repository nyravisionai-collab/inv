import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Package, Users, Truck,
  Wallet, BarChart3, Settings, UserCog, Menu, X, Search, Bell,
  Sun, Moon, ChevronDown, Store, FileText, RotateCcw,
  ClipboardList, ScanBarcode, CreditCard, Tags, Tag, Building2,
  ArrowLeftRight, SlidersHorizontal, Receipt, BookOpen, PiggyBank,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { searchAPI, notificationsAPI } from '../api/client';
import InstallPrompt from './InstallPrompt';

const NAV = [
  {
    title: 'Main',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/pos', icon: ScanBarcode, label: 'POS' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/sales', icon: ShoppingCart, label: 'Sale Invoices' },
      { to: '/estimates', icon: FileText, label: 'Estimates' },
      { to: '/sale-orders', icon: ClipboardList, label: 'Sale Orders' },
      { to: '/delivery-challans', icon: Truck, label: 'Delivery Challans' },
      { to: '/sale-returns', icon: RotateCcw, label: 'Sale Returns' },
      { to: '/payments-in', icon: CreditCard, label: 'Payment In' },
    ],
  },
  {
    title: 'Purchase',
    items: [
      { to: '/purchases', icon: ShoppingBag, label: 'Purchase Bills' },
      { to: '/purchase-orders', icon: ClipboardList, label: 'Purchase Orders' },
      { to: '/purchase-returns', icon: RotateCcw, label: 'Purchase Returns' },
      { to: '/payments-out', icon: CreditCard, label: 'Payment Out' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { to: '/products', icon: Package, label: 'Products' },
      { to: '/categories', icon: Tags, label: 'Categories' },
      { to: '/brands', icon: Tag, label: 'Brands' },
      { to: '/warehouses', icon: Building2, label: 'Warehouses' },
      { to: '/stock-transfer', icon: ArrowLeftRight, label: 'Stock Transfer' },
      { to: '/stock-adjustment', icon: SlidersHorizontal, label: 'Stock Adjustment' },
      { to: '/low-stock', icon: Package, label: 'Low Stock' },
    ],
  },
  {
    title: 'Parties',
    items: [
      { to: '/customers', icon: Users, label: 'Customers' },
      { to: '/suppliers', icon: Truck, label: 'Suppliers' },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { to: '/expenses', icon: Receipt, label: 'Expenses' },
      { to: '/incomes', icon: PiggyBank, label: 'Income' },
      { to: '/banks', icon: Wallet, label: 'Cash & Bank' },
      { to: '/cash-book', icon: BookOpen, label: 'Cash Book' },
      { to: '/journals', icon: FileText, label: 'Journal Entries' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/reports', icon: BarChart3, label: 'All Reports' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/users', icon: UserCog, label: 'Users', admin: true },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export default function Layout() {
  const { user, theme, toggleTheme, online, settings, language, setLanguage, t } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [notifs, setNotifs] = useState({ notifications: [], unread: 0 });
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    notificationsAPI.list().then((r) => setNotifs(r.data.data)).catch(() => {});
    notificationsAPI.check().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        setShowSearch(false);
        setShowNotifs(false);
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleSearch = (val) => {
    setSearchQ(val);
    clearTimeout(searchTimer.current);
    if (val.length < 1) { setSearchResults(null); setShowSearch(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchAPI.global(val);
        setSearchResults(res.data.data);
        setShowSearch(true);
      } catch { /* ignore */ }
    }, 300);
  };

  const goTo = (path) => {
    navigate(path);
    setSidebarOpen(false);
    setShowSearch(false);
    setSearchQ('');
  };

  return (
    <div className="app-layout">
      {!online && <div className="offline-banner" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 }}>{t('You are offline — changes will sync when reconnected')}</div>}

      <InstallPrompt />

      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo"><Store size={20} /></div>
          <div className="sidebar-title">{settings?.company_name || 'Inventory'}</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-section-title">{t(section.title)}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon size={20} />
                  {t(item.label)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main-content">
        <header className="header">
          <div className="header-left">
            <button
              className="menu-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? t('Close menu') : t('Open menu')}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="search-box" ref={searchRef} style={{ position: 'relative' }}>
              <Search size={18} />
              <input
                placeholder={t('Search products, customers, invoices...')}
                value={searchQ}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchResults && setShowSearch(true)}
              />
              {showSearch && searchResults && (
                <div className="search-dropdown">
                  {['products', 'customers', 'suppliers', 'sales', 'purchases'].map((key) =>
                    searchResults[key]?.length > 0 && (
                      <div key={key}>
                        <div className="search-group-title">{key}</div>
                        {searchResults[key].map((item) => (
                          <div
                            key={`${key}-${item.id}`}
                            className="search-result-item"
                            onClick={() => {
                              const paths = {
                                products: `/products`,
                                customers: `/customers`,
                                suppliers: `/suppliers`,
                                sales: `/sales/${item.id}`,
                                purchases: `/purchases/${item.id}`,
                              };
                              goTo(paths[key] || '/');
                            }}
                          >
                            <span>{item.name}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                              {item.selling_price != null ? `₹${item.selling_price}` : item.phone || item.party || ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                  {!Object.values(searchResults).some((a) => a?.length) && (
                    <div className="search-result-item" style={{ color: 'var(--text-secondary)' }}>{t('No results found')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="header-right">
            <select
              className="header-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label={t('Language')}
            >
              <option value="en">{t('English')}</option>
              <option value="gu">ગુજરાતી</option>
            </select>
            <button className="btn-icon" onClick={toggleTheme} title={t('Toggle theme')} aria-label={t('Toggle theme')}>
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <div style={{ position: 'relative' }}>
              <button className="btn-icon" onClick={() => setShowNotifs(!showNotifs)} aria-label={t('Notifications')} aria-expanded={showNotifs}>
                <Bell size={20} />
                {notifs.unread > 0 && (
                  <span className="notification-dot">{notifs.unread > 9 ? '9+' : notifs.unread}</span>
                )}
              </button>
              {showNotifs && (
                <div className="search-dropdown" style={{ right: 0, left: 'auto', width: 320 }}>
                  <div className="search-group-title">{t('Notifications')}</div>
                  {notifs.notifications?.length === 0 && (
                    <div className="search-result-item" style={{ color: 'var(--text-secondary)' }}>{t('No notifications')}</div>
                  )}
                  {notifs.notifications?.slice(0, 10).map((n) => (
                    <div key={n.id} className="search-result-item" style={{ flexDirection: 'column', alignItems: 'flex-start', opacity: n.is_read ? 0.6 : 1 }}
                      onClick={() => { notificationsAPI.markRead(n.id); setNotifs((p) => ({ ...p, notifications: p.notifications.map((x) => x.id === n.id ? { ...x, is_read: 1 } : x), unread: Math.max(0, p.unread - 1) })); }}>
                      <strong style={{ fontSize: 13 }}>{n.title}</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowUserMenu(!showUserMenu)} style={{ gap: 6 }}>
                <div className="user-avatar">{user?.full_name?.[0] || 'U'}</div>
                <span className="hide-mobile">{user?.full_name?.split(' ')[0]}</span>
                <ChevronDown size={14} />
              </button>
              {showUserMenu && (
                <div className="search-dropdown" style={{ right: 0, left: 'auto', width: 200 }}>
                  <div className="search-result-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <strong>{user?.full_name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user?.role}</span>
                  </div>
                  <div className="search-result-item" onClick={() => { setShowUserMenu(false); navigate('/settings'); }}>
                    <Settings size={16} /> {t('Settings')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
