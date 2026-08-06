/**
 * Inventory Lite — router, app shell and the "More" menu.
 *
 * Screens register themselves into `Lite.screens` (see screens/*.js). A screen
 * is `{ title: fn, render: fn(view, arg, arg2) }`. Navigation is a plain
 * function call plus a hash update so the phone's hardware Back button works.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  L.screens = {};

  /* --------------------------- bottom tab bar -------------------------- */
  // Five thumb-sized destinations; everything else lives behind "More".
  var TABS = [
    { id: 'home', label: 'tabHome' },
    { id: 'pos', label: 'tabSale' },
    { id: 'stock', label: 'tabStock' },
    { id: 'sales', label: 'tabBills' },
    { id: 'menu', label: 'tabMore' }
  ];

  /** Which tab should look active for a given route. */
  var TAB_OF_ROUTE = {
    home: 'home',
    pos: 'pos',
    stock: 'stock', products: 'stock', productForm: 'stock', lowStock: 'stock',
    stockAdjust: 'stock', stockTransfer: 'stock', stockReport: 'stock',
    categories: 'stock', brands: 'stock', units: 'stock', warehouses: 'stock',
    barcodes: 'stock',
    sales: 'sales', saleDetail: 'sales', docForm: 'sales',
    purchases: 'sales', purchaseDetail: 'sales',
    payments: 'sales', paymentForm: 'sales',
    menu: 'menu'
  };

  /* ------------------------------ the menu ----------------------------- */
  // Mirrors the React sidebar (frontend/src/components/Layout.jsx) so nothing
  // reachable on a desktop is missing on the phone.
  var MENU = [
    {
      title: 'navMain',
      items: [
        { route: 'home', label: 'dashboard' },
        { route: 'pos', label: 'pos' },
        { route: 'search', label: 'search' },
        { route: 'notifications', label: 'notifications' }
      ]
    },
    {
      title: 'navSales',
      items: [
        { route: 'sales', arg: 'sale,pos', label: 'saleInvoices' },
        { route: 'sales', arg: 'estimate', label: 'estimates' },
        { route: 'sales', arg: 'sale_order', label: 'saleOrders' },
        { route: 'sales', arg: 'delivery_challan', label: 'deliveryChallans' },
        { route: 'sales', arg: 'sale_return', label: 'saleReturns' },
        { route: 'payments', arg: 'payment_in', label: 'paymentIn' }
      ]
    },
    {
      title: 'navPurchase',
      items: [
        { route: 'purchases', arg: 'purchase', label: 'purchaseBills' },
        { route: 'purchases', arg: 'purchase_order', label: 'purchaseOrders' },
        { route: 'purchases', arg: 'purchase_return', label: 'purchaseReturns' },
        { route: 'payments', arg: 'payment_out', label: 'paymentOut' }
      ]
    },
    {
      title: 'navInventory',
      items: [
        { route: 'products', label: 'products' },
        { route: 'categories', label: 'categories' },
        { route: 'brands', label: 'brands' },
        { route: 'units', label: 'units' },
        { route: 'warehouses', label: 'warehouses' },
        { route: 'stockTransfer', label: 'stockTransfer' },
        { route: 'stockAdjust', label: 'stockAdjustment' },
        { route: 'lowStock', label: 'lowStock' },
        { route: 'barcodes', label: 'barcodes' }
      ]
    },
    {
      title: 'navParties',
      items: [
        { route: 'parties', arg: 'customer', label: 'customers' },
        { route: 'parties', arg: 'supplier', label: 'suppliers' }
      ]
    },
    {
      title: 'navAccounting',
      items: [
        { route: 'expenses', label: 'expenses' },
        { route: 'incomes', label: 'incomes' },
        { route: 'banks', label: 'banks' },
        { route: 'cashBook', label: 'cashBook' },
        { route: 'journals', label: 'journals' }
      ]
    },
    {
      title: 'navReports',
      items: [{ route: 'reports', label: 'reports' }]
    },
    {
      title: 'navSystem',
      items: [
        { route: 'users', label: 'users' },
        { route: 'auditLogs', label: 'auditLogs' },
        { route: 'settings', label: 'settings' },
        { route: 'backups', label: 'backups' }
      ]
    }
  ];

  /* ------------------------------- chrome ------------------------------ */
  function currentTitle() {
    var screen = L.screens[S.route.name];
    if (screen && screen.title) {
      try { return screen.title(S.route.arg, S.route.arg2); } catch (e) { /* fall through */ }
    }
    return t('appName');
  }

  function renderChrome() {
    var titleEl = L.$('hTitle');
    var backEl = L.$('hBack');
    if (backEl) backEl.style.display = S.stack.length ? 'block' : 'none';
    if (titleEl) titleEl.innerHTML = esc(currentTitle());

    var langEl = L.$('hLang');
    if (langEl) langEl.innerHTML = S.lang === 'gu' ? 'EN' : 'ગુ';

    var bell = L.$('hBell');
    if (bell) {
      bell.innerHTML = '&#9993;' + (S.notifUnread > 0
        ? '<span class="dot">' + (S.notifUnread > 9 ? '9+' : S.notifUnread) + '</span>'
        : '');
    }

    var activeTab = TAB_OF_ROUTE[S.route.name] || '';
    for (var i = 0; i < TABS.length; i++) {
      var btn = L.$('tb_' + TABS[i].id);
      if (!btn) continue;
      btn.className = 'tabbtn' + (activeTab === TABS[i].id ? ' on' : '');
      btn.innerHTML = esc(t(TABS[i].label));
    }

    document.title = currentTitle() + ' — ' + t('appName');
    try { document.documentElement.setAttribute('lang', S.lang); } catch (eL) { /* ignore */ }
  }

  /* ------------------------------ navigation --------------------------- */
  var suppressHash = false;

  function render() {
    renderChrome();
    var view = L.$('view');
    if (!view) return;
    var screen = L.screens[S.route.name];
    if (!screen) {
      view.innerHTML = L.emptyCard(t('noData'));
      return;
    }
    try {
      screen.render(view, S.route.arg, S.route.arg2);
    } catch (err) {
      // A screen bug must never leave a blank white page on a device with no
      // dev tools: show the message and a way out.
      view.innerHTML = '<div class="card"><b>' + esc(t('eServer')) + '</b>'
        + '<div class="muted">' + esc(err && err.message ? err.message : String(err)) + '</div>'
        + '<button type="button" class="btn grey" onclick="Lite.go(\'home\')">' + esc(t('dashboard')) + '</button></div>';
    }
    try { window.scrollTo(0, 0); } catch (eS) { /* ignore */ }
  }

  /**
   * Navigate to a screen.
   * @param {string} name  screen id
   * @param {*} arg        primary argument (filter/type/record id)
   * @param {*} arg2       secondary argument
   * @param {boolean} keepStack  true when replacing the current entry
   */
  function go(name, arg, arg2, keepStack) {
    if (!keepStack && S.route.name) {
      // Tab destinations reset the stack; drill-downs push onto it.
      if (TAB_OF_ROUTE[name] && !TAB_OF_ROUTE[S.route.name]) S.stack = [];
      else if (isTabRoot(name)) S.stack = [];
      else S.stack.push({ name: S.route.name, arg: S.route.arg, arg2: S.route.arg2 });
      if (S.stack.length > 24) S.stack.shift();
    }
    S.route = { name: name, arg: arg === undefined ? null : arg, arg2: arg2 === undefined ? null : arg2 };
    S.data = {};
    writeHash();
    render();
  }

  function isTabRoot(name) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === name) return true;
    return false;
  }

  /** Replace the current route without growing the back stack. */
  function replace(name, arg, arg2) {
    S.route = { name: name, arg: arg === undefined ? null : arg, arg2: arg2 === undefined ? null : arg2 };
    S.data = {};
    writeHash();
    render();
  }

  function back() {
    if (!S.stack.length) { go('home'); return; }
    var prev = S.stack.pop();
    S.route = prev;
    S.data = {};
    writeHash();
    render();
  }

  /** Re-render the current screen from scratch (after a save, etc.). */
  function reload() {
    S.data = {};
    render();
  }

  /* Hash sync keeps the hardware Back button useful on Windows Phone. */
  function writeHash() {
    var h = '#' + S.route.name
      + (S.route.arg !== null && S.route.arg !== undefined ? '/' + encodeURIComponent(S.route.arg) : '')
      + (S.route.arg2 !== null && S.route.arg2 !== undefined ? '/' + encodeURIComponent(S.route.arg2) : '');
    if (window.location.hash === h) return;
    suppressHash = true;
    try { window.location.hash = h; } catch (e) { /* ignore */ }
    setTimeout(function () { suppressHash = false; }, 0);
  }

  function readHash() {
    var raw = String(window.location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    var parts = raw.split('/');
    var name = parts[0];
    if (!L.screens[name]) return null;
    return {
      name: name,
      arg: parts.length > 1 ? decodeURIComponent(parts[1]) : null,
      arg2: parts.length > 2 ? decodeURIComponent(parts[2]) : null
    };
  }

  function onHashChange() {
    if (suppressHash) return;
    var r = readHash();
    if (!r) return;
    if (r.name === S.route.name && String(r.arg) === String(S.route.arg)
      && String(r.arg2) === String(S.route.arg2)) return;
    // The user pressed hardware Back: pop our stack in step with it.
    if (S.stack.length) {
      var top = S.stack[S.stack.length - 1];
      if (top.name === r.name && String(top.arg) === String(r.arg)) S.stack.pop();
    }
    S.route = r;
    S.data = {};
    render();
  }

  /* ---------------------------- the More menu -------------------------- */
  L.screens.menu = {
    title: function () { return t('tabMore'); },
    render: function (view) {
      var h = '';
      for (var i = 0; i < MENU.length; i++) {
        var sec = MENU[i];
        h += '<div class="navsec">' + esc(t(sec.title)) + '</div>';
        for (var j = 0; j < sec.items.length; j++) {
          var it = sec.items[j];
          var call = "Lite.go('" + it.route + "'"
            + (it.arg ? ",'" + L.jsq(it.arg) + "'" : '')
            + ')';
          h += '<button type="button" class="navitem" onclick="' + call + '">'
            + esc(t(it.label)) + ' <span class="muted" style="float:right;">&rsaquo;</span></button>';
        }
      }
      h += '<div class="navsec">' + esc(t('company')) + '</div>';
      h += '<div class="card muted">'
        + esc((S.settings && S.settings.company_name) || '')
        + '<br />Inventory Lite · ES5 client'
        + '</div>';
      view.innerHTML = h;
    }
  };

  /* ----------------------------- boot sequence ------------------------- */
  function toggleLang() {
    S.lang = S.lang === 'gu' ? 'en' : 'gu';
    try { window.localStorage.setItem('lite_lang', S.lang); } catch (e) { /* ignore */ }
    render();
  }

  /** Cheap reference-data caches; each loader is a no-op once filled. */
  function ensure(key, url, cb) {
    if (S[key]) { if (cb) cb(S[key]); return; }
    L.api('GET', url, null, function (err, data) {
      if (!err) S[key] = data || [];
      if (cb) cb(S[key] || []);
    });
  }

  function loadNotifCount() {
    L.api('GET', '/api/notifications', null, function (err, data) {
      if (err || !data) return;
      S.notifUnread = data.unread || 0;
      renderChrome();
    });
  }

  function boot() {
    renderChrome();
    // Settings first: the currency symbol is needed by every money label.
    L.api('GET', '/api/settings', null, function (err, data) {
      if (!err) S.settings = data;
      var r = readHash();
      S.route = r || { name: 'home', arg: null, arg2: null };
      render();
      loadNotifCount();
      // Refresh alert badges in the background, exactly like the React header.
      L.api('POST', '/api/notifications/check', {}, function () { loadNotifCount(); });
    });
  }

  L.go = go;
  L.replace = replace;
  L.back = back;
  L.reload = reload;
  L.render = render;
  L.renderChrome = renderChrome;
  L.toggleLang = toggleLang;
  L.ensure = ensure;
  L.loadNotifCount = loadNotifCount;
  L.MENU = MENU;

  if (window.addEventListener) window.addEventListener('hashchange', onHashChange, false);
  else if (window.attachEvent) window.attachEvent('onhashchange', onHashChange);

  L.boot = boot;
}());
