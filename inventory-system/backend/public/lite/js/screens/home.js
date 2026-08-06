/**
 * Home / dashboard, global search and notifications.
 * Reads the same /api/dashboard payload the React dashboard uses.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  /* -------------------------------- HOME ------------------------------- */
  L.screens.home = {
    title: function () { return t('dashboard'); },
    render: function (view) {
      if (S.data.dash === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/dashboard', null, function (err, data) {
          if (S.route.name !== 'home') return;
          S.data.dash = err ? null : data;
          S.data.dashErr = err || null;
          draw(view);
        });
        return;
      }
      draw(view);
    }
  };

  function draw(view) {
    if (!S.data.dash) {
      view.innerHTML = L.errorCard(S.data.dashErr, "Lite.reload()");
      return;
    }
    var d = S.data.dash;
    var i;

    var h = '<div class="kpis">'
      + L.kpi(L.money(d.todaySales), t('todaySales') + ' · ' + (d.todaySalesCount || 0) + ' ' + t('billsCount'), '')
      + L.kpi(L.money(d.cashInHand), t('cashInHand'), 'green')
      + L.kpi(L.money(d.profit), t('profit'), L.num(d.profit) >= 0 ? 'green' : 'red')
      + L.kpi(L.money(d.stockValue), t('stockValue'), '')
      + L.kpi(L.money(d.receivables), t('receivables'), 'orange')
      + L.kpi(L.money(d.payables), t('payables'), 'red')
      + L.kpi(L.money(d.todayPurchases), t('todayPurchases') + ' · ' + (d.todayPurchasesCount || 0), '')
      + L.kpi(L.money(d.bankBalance), t('bankBalance'), '')
      + '</div>';

    // Quick actions — the four things a counter does all day.
    h += '<div class="btnrow">'
      + '<div class="btnhalf"><button type="button" class="btn green" onclick="Lite.go(\'pos\')">' + esc(t('pos')) + '</button></div>'
      + '<div class="btnhalf"><button type="button" class="btn" onclick="Lite.go(\'docForm\',\'purchase\')">' + esc(t('purchaseBills')) + '</button></div>'
      + '</div>'
      + '<div class="btnrow">'
      + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.go(\'paymentForm\',\'payment_in\')">' + esc(t('paymentIn')) + '</button></div>'
      + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.go(\'expenses\')">' + esc(t('expenses')) + '</button></div>'
      + '</div>';

    /* low stock */
    h += L.sectionTitle(t('lowStock'), '(' + (d.lowStockCount || 0) + ')');
    if (!d.lowStock || !d.lowStock.length) {
      h += L.emptyCard(t('noLow'));
    } else {
      for (i = 0; i < d.lowStock.length && i < 10; i++) {
        var p = d.lowStock[i];
        h += '<div class="row lowstock" onclick="Lite.go(\'stockAdjust\',' + Number(p.id) + ')">'
          + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
          + '<div class="muted">' + esc(t('avail')) + ': ' + esc(L.fmt(p.current_stock))
          + ' / ' + esc(t('minStock')) + ' ' + esc(L.fmt(p.min_stock)) + '</div></div>'
          + '<div class="rowr"><span class="chip red">' + esc(L.fmt(p.current_stock)) + '</span></div>'
          + '</div>';
      }
      if (d.lowStockCount > 10) {
        h += '<button type="button" class="btn grey" onclick="Lite.go(\'lowStock\')">' + esc(t('more')) + '</button>';
      }
    }

    /* top products */
    if (d.topProducts && d.topProducts.length) {
      h += L.sectionTitle(t('topProducts'));
      h += '<div class="card tblwrap"><table class="tbl"><tr><th>' + esc(t('name')) + '</th>'
        + '<th class="n">' + esc(t('qtySold')) + '</th><th class="n">' + esc(t('total')) + '</th></tr>';
      for (i = 0; i < d.topProducts.length && i < 8; i++) {
        var tp = d.topProducts[i];
        h += '<tr><td>' + esc(tp.name) + '</td><td class="n">' + esc(L.fmt(tp.qty_sold))
          + '</td><td class="n">' + esc(L.money(tp.revenue)) + '</td></tr>';
      }
      h += '</table></div>';
    }

    /* recent transactions */
    if (d.recentTransactions && d.recentTransactions.length) {
      h += L.sectionTitle(t('recentTx'));
      for (i = 0; i < d.recentTransactions.length && i < 10; i++) {
        var tx = d.recentTransactions[i];
        var target = tx.type === 'sale'
          ? "Lite.go('saleDetail'," + Number(tx.id) + ')'
          : "Lite.go('purchaseDetail'," + Number(tx.id) + ')';
        h += '<div class="row" onclick="' + target + '">'
          + '<div class="rowl"><div class="bigname">' + esc(tx.number) + '</div>'
          + '<div class="muted">' + esc(L.dstr(tx.date))
          + (tx.party ? ' · ' + esc(tx.party) : '') + '</div></div>'
          + '<div class="rowr"><div><b>' + esc(L.money(tx.amount)) + '</b></div>'
          + L.statusChip(tx.status) + '</div></div>';
      }
    }

    h += '<button type="button" class="btn grey" onclick="Lite.reload()">&#8635; ' + esc(t('refresh')) + '</button>';
    view.innerHTML = h;
  }

  /* --------------------------- GLOBAL SEARCH --------------------------- */
  L.screens.search = {
    title: function () { return t('search'); },
    render: function (view) {
      view.innerHTML = '<div class="card">'
        + '<input type="text" id="gq" autocomplete="off" placeholder="' + esc(t('globalSearchPh')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.searchKey(this)" /></div>'
        + '<div id="gres"></div>';
      var el = L.$('gq');
      if (el) { try { el.focus(); } catch (e) { /* ignore */ } }
      if (S.data.res) drawResults();
    }
  };

  L.searchKey = function (el) {
    S.data.q = el.value;
    L.debounce('gsearch', function () {
      var q = L.trim(S.data.q);
      if (!q) { S.data.res = null; drawResults(); return; }
      L.api('GET', '/api/search' + L.qs({ q: q }), null, function (err, data) {
        if (err) { L.showErr(err); return; }
        S.data.res = data;
        drawResults();
      });
    });
  };

  function drawResults() {
    var box = L.$('gres');
    if (!box) return;
    var r = S.data.res;
    if (!r) { box.innerHTML = ''; return; }

    var groups = [
      { key: 'products', label: t('products'), nav: function (it) { return "Lite.go('productForm'," + Number(it.id) + ')'; },
        sub: function (it) { return L.money(it.selling_price) + ' · ' + t('avail') + ': ' + L.fmt(it.current_stock); } },
      { key: 'partys', label: t('partys'), nav: function (it) { return "Lite.go('partyDetail','party'," + Number(it.id) + ')'; },
        sub: function (it) { return it.phone || ''; } },
      { key: 'partys', label: t('partys'), nav: function (it) { return "Lite.go('partyDetail','party'," + Number(it.id) + ')'; },
        sub: function (it) { return it.phone || ''; } },
      { key: 'sales', label: t('saleInvoices'), nav: function (it) { return "Lite.go('saleDetail'," + Number(it.id) + ')'; },
        sub: function (it) { return L.dstr(it.invoice_date) + ' · ' + L.money(it.grand_total); } },
      { key: 'purchases', label: t('purchaseBills'), nav: function (it) { return "Lite.go('purchaseDetail'," + Number(it.id) + ')'; },
        sub: function (it) { return L.dstr(it.bill_date) + ' · ' + L.money(it.grand_total); } }
    ];

    var h = '', any = false;
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var rows = r[grp.key];
      if (!rows || !rows.length) continue;
      any = true;
      h += L.sectionTitle(grp.label, '(' + rows.length + ')');
      for (var i = 0; i < rows.length; i++) {
        var it = rows[i];
        h += '<div class="row" onclick="' + grp.nav(it) + '">'
          + '<div class="bigname">' + esc(it.name) + '</div>'
          + '<div class="muted">' + esc(grp.sub(it)) + '</div></div>';
      }
    }
    box.innerHTML = any ? h : L.emptyCard(t('noData'));
  }

  /* --------------------------- NOTIFICATIONS --------------------------- */
  L.screens.notifications = {
    title: function () { return t('notifications'); },
    render: function (view) {
      if (S.data.list === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/notifications', null, function (err, data) {
          if (S.route.name !== 'notifications') return;
          S.data.list = err ? null : (data && data.notifications) || [];
          S.notifUnread = (data && data.unread) || 0;
          L.renderChrome();
          L.screens.notifications.render(view);
        });
        return;
      }
      if (!S.data.list) { view.innerHTML = L.errorCard(null, 'Lite.reload()'); return; }
      if (!S.data.list.length) { view.innerHTML = L.emptyCard(t('noNotifs')); return; }

      var h = '<button type="button" class="btn grey" onclick="Lite.markAllRead()">' + esc(t('markRead')) + '</button>';
      for (var i = 0; i < S.data.list.length; i++) {
        var n = S.data.list[i];
        h += '<div class="card" style="opacity:' + (n.is_read ? '0.6' : '1') + ';">'
          + '<div class="bigname">' + esc(n.title) + '</div>'
          + '<div class="muted">' + esc(n.message) + '</div>'
          + (n.is_read ? '' : '<button type="button" class="btn grey small mt" onclick="Lite.markRead('
            + Number(n.id) + ')">' + esc(t('markRead')) + '</button>')
          + '</div>';
      }
      view.innerHTML = h;
    }
  };

  L.markRead = function (id) {
    L.api('PUT', '/api/notifications/' + Number(id) + '/read', null, function (err) {
      if (err) { L.showErr(err); return; }
      L.reload();
      L.loadNotifCount();
    });
  };

  L.markAllRead = function () {
    L.api('PUT', '/api/notifications/all/read', null, function (err) {
      if (err) { L.showErr(err); return; }
      L.reload();
      L.loadNotifCount();
    });
  };
}());
