/**
 * Reports. Every report the React app exposes is reachable here, each with a
 * date range where the API supports one and a "Save PDF" button that writes to
 * the server's exports folder (same endpoint the desktop uses).
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  /**
   * `dated`   — show the from/to picker
   * `pdf`     — report name accepted by POST /api/reports/:name/pdf
   * `draw`    — turns the API payload into HTML
   */
  var REPORTS = {
    'profit-loss': { label: 'rProfitLoss', url: '/api/reports/profit-loss', dated: true, pdf: 'profit-loss', draw: drawProfitLoss },
    'balance-sheet': { label: 'rBalance', url: '/api/reports/balance-sheet', dated: false, pdf: 'balance-sheet', draw: drawBalance },
    gst: { label: 'rGst', url: '/api/reports/gst', dated: true, pdf: 'gst', draw: drawGst },
    sales: { label: 'rSales', url: '/api/reports/sales', dated: true, pdf: 'sales', draw: drawSales, group: true },
    purchases: { label: 'rPurchases', url: '/api/reports/purchases', dated: true, pdf: 'purchases', draw: drawPurchases },
    expenses: { label: 'rExpenses', url: '/api/reports/expenses', dated: true, pdf: 'expenses', draw: drawExpenses },
    stock: { label: 'rStock', url: '/api/reports/stock', dated: false, pdf: 'stock', draw: drawStock },
    customers: { label: 'rCustomers', url: '/api/reports/customers', dated: false, pdf: 'customers', draw: drawParties },
    suppliers: { label: 'rSuppliers', url: '/api/reports/suppliers', dated: false, pdf: 'suppliers', draw: drawParties },
    outstanding: { label: 'rOutstanding', url: '/api/reports/outstanding', dated: false, pdf: 'outstanding', draw: drawOutstanding },
    'product-profit': { label: 'rProductProfit', url: '/api/reports/product-profit', dated: true, pdf: 'product-profit', draw: drawProductProfit },
    'customer-profit': { label: 'rCustomerProfit', url: '/api/reports/customer-profit', dated: true, pdf: 'customer-profit', draw: drawCustomerProfit },
    expiry: { label: 'rExpiry', url: '/api/reports/expiry', dated: false, pdf: 'expiry', draw: drawExpiry },
    'warehouse-stock': { label: 'rWarehouse', url: '/api/reports/warehouse-stock', dated: false, pdf: 'warehouse-stock', draw: drawWarehouse }
  };

  var ORDER = ['profit-loss', 'balance-sheet', 'gst', 'sales', 'purchases', 'expenses',
    'stock', 'warehouse-stock', 'expiry', 'customers', 'suppliers', 'outstanding',
    'product-profit', 'customer-profit'];

  /* ------------------------------- index ------------------------------- */
  L.screens.reports = {
    title: function () { return t('reports'); },
    render: function (view) {
      var h = '<div class="navsec">' + esc(t('selectReport')) + '</div>';
      for (var i = 0; i < ORDER.length; i++) {
        var key = ORDER[i];
        h += '<button type="button" class="navitem" onclick="Lite.go(\'report\',\'' + key + '\')">'
          + esc(t(REPORTS[key].label)) + ' <span class="muted" style="float:right;">&rsaquo;</span></button>';
      }
      h += '<div class="navsec">' + esc(t('exportedFiles')) + '</div>'
        + '<button type="button" class="navitem" onclick="Lite.go(\'exports\')">'
        + esc(t('exportedFiles')) + ' <span class="muted" style="float:right;">&rsaquo;</span></button>';
      view.innerHTML = h;
    }
  };

  /* ------------------------------ one report --------------------------- */
  L.screens.report = {
    title: function (key) { return t((REPORTS[key] || {}).label || 'reports'); },
    render: function (view, key) {
      var r = REPORTS[key];
      if (!r) { view.innerHTML = L.emptyCard(t('noData')); return; }

      var from = S.data.from || L.firstOfMonth();
      var to = S.data.to || L.todayStr();
      var group = S.data.group || 'date';

      var head = '<div class="card">'
        + (r.dated ? L.dateRangeFields('rpf', 'rpt', from, to) : '')
        + (r.group
          ? '<label class="fld" for="rpg">' + esc(t('groupBy')) + '</label>'
            + '<select id="rpg">'
            + '<option value="date"' + (group === 'date' ? ' selected="selected"' : '') + '>' + esc(t('gDate')) + '</option>'
            + '<option value="customer"' + (group === 'customer' ? ' selected="selected"' : '') + '>' + esc(t('gCustomer')) + '</option>'
            + '<option value="product"' + (group === 'product' ? ' selected="selected"' : '') + '>' + esc(t('gProduct')) + '</option>'
            + '</select>'
          : '')
        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn small" onclick="Lite.reportApply(\'' + key + '\')">'
        + esc(t('apply')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey small" onclick="Lite.reportSavePdf(\'' + key + '\')">'
        + esc(t('savePdf')) + '</button></div></div></div>';

      if (S.data.payload === undefined) {
        view.innerHTML = head + L.spinner();
        var params = {};
        if (r.dated) { params.from_date = from; params.to_date = to; }
        if (r.group) params.group_by = group;
        L.api('GET', r.url + L.qs(params), null, function (err, data) {
          if (S.route.name !== 'report') return;
          S.data.payload = err ? null : data;
          S.data.err = err;
          S.data.from = from; S.data.to = to; S.data.group = group;
          L.screens.report.render(view, key);
        });
        return;
      }
      if (!S.data.payload) { view.innerHTML = head + L.errorCard(S.data.err, 'Lite.reload()'); return; }
      view.innerHTML = head + r.draw(S.data.payload);
    }
  };

  L.reportApply = function (key) {
    var r = REPORTS[key];
    S.data = {
      from: r.dated ? L.val('rpf') : null,
      to: r.dated ? L.val('rpt') : null,
      group: r.group ? L.val('rpg') : null
    };
    L.render();
  };

  L.reportSavePdf = function (key) {
    var r = REPORTS[key];
    var params = {};
    if (r.dated) { params.from_date = S.data.from; params.to_date = S.data.to; }
    if (r.group) params.group_by = S.data.group;
    L.reportPdf(r.pdf, params);
  };

  /** Shared by the stock screen too. */
  L.reportPdf = function (name, params) {
    L.api('POST', '/api/reports/' + name + '/pdf' + L.qs(params || {}), {}, function (err, data) {
      if (err) { L.showErr(err); return; }
      L.toast(t('pdfSaved') + ': ' + ((data && data.fileName) || ''), true);
    });
  };

  /* ------------------------------ renderers ---------------------------- */
  function table(headers, rows) {
    var h = '<div class="card tblwrap"><table class="tbl"><tr>';
    for (var i = 0; i < headers.length; i++) {
      h += '<th' + (headers[i].n ? ' class="n"' : '') + '>' + esc(headers[i].label) + '</th>';
    }
    h += '</tr>';
    for (var r = 0; r < rows.length; r++) {
      h += '<tr>';
      for (var c = 0; c < rows[r].length; c++) {
        h += '<td' + (headers[c] && headers[c].n ? ' class="n"' : '') + '>' + rows[r][c] + '</td>';
      }
      h += '</tr>';
    }
    return h + '</table></div>';
  }

  function drawProfitLoss(d) {
    var h = '<div class="card">'
      + L.kv(t('sales'), L.money(d.sales))
      + L.kv(t('saleReturns'), '-' + L.money(d.saleReturns))
      + L.kv(t('netSales'), L.money(d.netSales))
      + L.kv(t('cogs'), '-' + L.money(d.cogs))
      + L.kv(t('grossProfit'), L.money(d.grossProfit), L.num(d.grossProfit) >= 0 ? 'green' : 'red')
      + L.kv(t('otherIncome'), L.money(d.otherIncome))
      + L.kv(t('totalExpenses'), '-' + L.money(d.totalExpenses))
      + '<hr class="sp" />'
      + L.kv(t('netProfit'), L.money(d.netProfit), L.num(d.netProfit) >= 0 ? 'green' : 'red')
      + '</div>';
    var rows = [];
    for (var i = 0; i < (d.expenses || []).length; i++) {
      rows.push([esc(d.expenses[i].category), esc(L.money(d.expenses[i].total))]);
    }
    if (rows.length) {
      h += L.sectionTitle(t('expenses'))
        + table([{ label: t('category') }, { label: t('amount'), n: true }], rows);
    }
    return h;
  }

  function drawBalance(d) {
    var h = '<div class="card">' + L.sectionTitle(t('assets'));
    var cb = d.assets.cashAndBank || [];
    for (var i = 0; i < cb.length; i++) h += L.kv(cb[i].account_name, L.money(cb[i].current_balance));
    h += L.kv(t('stockValue'), L.money(d.assets.stockValue))
      + L.kv(t('receivables'), L.money(d.assets.receivables))
      + '<hr class="sp" />' + L.kv(t('total'), L.money(d.assets.total))
      + '</div><div class="card">' + L.sectionTitle(t('liabilities'))
      + L.kv(t('payables'), L.money(d.liabilities.payables))
      + L.kv(t('retained'), L.money(d.equity.retainedEarnings))
      + '</div>';
    return h;
  }

  function drawGst(d) {
    var h = '<div class="card">'
      + L.kv(t('outputTax'), L.money(d.outputTax))
      + L.kv(t('inputTax'), L.money(d.inputTax))
      + L.kv(t('netTax'), L.money(d.netTax), L.num(d.netTax) > 0 ? 'red' : 'green')
      + '<hr class="sp" />'
      + L.kv('CGST', L.money(d.netBreakdown.cgst))
      + L.kv('SGST', L.money(d.netBreakdown.sgst))
      + L.kv('IGST', L.money(d.netBreakdown.igst))
      + '</div>';
    var rows = [], i;
    for (i = 0; i < (d.rateWise || []).length; i++) {
      var rw = d.rateWise[i];
      rows.push([esc(L.fmt(rw.rate)) + '%', esc(L.fmt(rw.taxable_value)), esc(L.fmt(rw.tax_amount))]);
    }
    if (rows.length) {
      h += L.sectionTitle(t('rate'))
        + table([{ label: t('rate') }, { label: t('taxable'), n: true }, { label: t('tax'), n: true }], rows);
    }
    var hsn = [];
    for (i = 0; i < (d.hsnWise || []).length; i++) {
      var hw = d.hsnWise[i];
      hsn.push([esc(hw.hsn_code), esc(L.fmt(hw.quantity)), esc(L.fmt(hw.taxable_value)), esc(L.fmt(hw.tax_amount))]);
    }
    if (hsn.length) {
      h += L.sectionTitle('HSN')
        + table([{ label: 'HSN' }, { label: t('qty'), n: true },
          { label: t('taxable'), n: true }, { label: t('tax'), n: true }], hsn);
    }
    return h;
  }

  function drawSales(d) {
    var s = d.summary || {};
    var h = '<div class="card">'
      + L.kv(t('invoices'), String(s.count || 0))
      + L.kv(t('total'), L.money(s.total))
      + L.kv(t('tax'), L.money(s.tax))
      + L.kv(t('paid'), L.money(s.paid))
      + L.kv(t('balance'), L.money(s.balance), L.num(s.balance) > 0 ? 'red' : '')
      + '</div>';
    var rows = [];
    for (var i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      if (d.group_by === 'product') rows.push([esc(r.name), esc(L.fmt(r.qty)), esc(L.money(r.total))]);
      else if (d.group_by === 'customer') rows.push([esc(r.name || t('walkIn')), String(r.invoices), esc(L.money(r.total))]);
      else rows.push([esc(L.dstr(r.date)), String(r.invoices), esc(L.money(r.total))]);
    }
    if (!rows.length) return h + L.emptyCard(t('noData'));
    var first = d.group_by === 'product' ? t('name') : (d.group_by === 'customer' ? t('customer') : t('date'));
    var second = d.group_by === 'product' ? t('qty') : t('invoices');
    return h + table([{ label: first }, { label: second, n: true }, { label: t('total'), n: true }], rows);
  }

  function drawPurchases(d) {
    var s = d.summary || {};
    var h = '<div class="card">'
      + L.kv(t('invoices'), String(s.count || 0))
      + L.kv(t('total'), L.money(s.total))
      + L.kv(t('tax'), L.money(s.tax))
      + L.kv(t('paid'), L.money(s.paid))
      + '</div>';
    var rows = [];
    for (var i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      rows.push([esc(r.bill_number) + '<div class="muted">' + esc(L.dstr(r.date)) + '</div>',
        esc(r.supplier || '—'), esc(L.money(r.total))]);
    }
    if (!rows.length) return h + L.emptyCard(t('noData'));
    return h + table([{ label: t('billNo') }, { label: t('supplier') }, { label: t('total'), n: true }], rows);
  }

  function drawExpenses(d) {
    var h = '<div class="card">' + L.kv(t('total'), L.money(d.total)) + '</div>';
    var rows = [], i;
    for (i = 0; i < (d.byCategory || []).length; i++) {
      rows.push([esc(d.byCategory[i].category), String(d.byCategory[i].count), esc(L.money(d.byCategory[i].total))]);
    }
    if (rows.length) {
      h += table([{ label: t('category') }, { label: t('billsCount'), n: true }, { label: t('amount'), n: true }], rows);
    }
    var detail = [];
    for (i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      detail.push([esc(L.dstr(r.expense_date)), esc(r.category) + '<div class="muted">'
        + esc(r.description || '') + '</div>', esc(L.money(r.amount))]);
    }
    if (detail.length) {
      h += L.sectionTitle(t('expenses'))
        + table([{ label: t('date') }, { label: t('description') }, { label: t('amount'), n: true }], detail);
    }
    return h;
  }

  function drawStock(d) {
    var rows = [], totalVal = 0;
    for (var i = 0; i < (d || []).length; i++) {
      var r = d[i];
      var value = r.stock_value !== undefined ? L.num(r.stock_value) : L.num(r.quantity) * L.num(r.purchase_price);
      totalVal = L.round2(totalVal + value);
      rows.push([esc(r.name), esc(L.fmt(r.quantity)), esc(L.fmt(value))]);
    }
    if (!rows.length) return L.emptyCard(t('noData'));
    return '<div class="card">' + L.kv(t('stockValue'), L.money(totalVal)) + '</div>'
      + table([{ label: t('name') }, { label: t('qty'), n: true }, { label: t('stockValue'), n: true }], rows);
  }

  function drawParties(d) {
    var rows = [];
    for (var i = 0; i < (d || []).length; i++) {
      var r = d[i];
      rows.push([esc(r.name) + '<div class="muted">' + esc(r.phone || '') + '</div>',
        esc(L.money(r.total_sales !== undefined ? r.total_sales : r.total_purchases)),
        esc(L.money(r.current_balance))]);
    }
    if (!rows.length) return L.emptyCard(t('noData'));
    return table([{ label: t('name') }, { label: t('total'), n: true }, { label: t('balance'), n: true }], rows);
  }

  function drawOutstanding(d) {
    var h = '<div class="card">'
      + L.kv(t('receivables'), L.money(d.customerOutstanding), 'red')
      + L.kv(t('payables'), L.money(d.supplierPayable), 'red')
      + '</div>';
    var rows = [], i;
    for (i = 0; i < (d.customers || []).length; i++) {
      rows.push([esc(d.customers[i].name), esc(L.money(d.customers[i].outstanding))]);
    }
    if (rows.length) {
      h += L.sectionTitle(t('customers'))
        + table([{ label: t('name') }, { label: t('outstanding'), n: true }], rows);
    }
    var srows = [];
    for (i = 0; i < (d.suppliers || []).length; i++) {
      srows.push([esc(d.suppliers[i].name), esc(L.money(d.suppliers[i].payable))]);
    }
    if (srows.length) {
      h += L.sectionTitle(t('suppliers'))
        + table([{ label: t('name') }, { label: t('outstanding'), n: true }], srows);
    }
    return h;
  }

  function drawProductProfit(d) {
    var rows = [];
    for (var i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      rows.push([esc(r.product_name), esc(L.fmt(r.quantity)), esc(L.money(r.sales)), esc(L.money(r.profit))]);
    }
    if (!rows.length) return L.emptyCard(t('noData'));
    return table([{ label: t('name') }, { label: t('qty'), n: true },
      { label: t('sales'), n: true }, { label: t('profit'), n: true }], rows);
  }

  function drawCustomerProfit(d) {
    var rows = [];
    for (var i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      rows.push([esc(r.customer_name), String(r.invoices), esc(L.money(r.sales)), esc(L.money(r.profit))]);
    }
    if (!rows.length) return L.emptyCard(t('noData'));
    return table([{ label: t('customer') }, { label: t('invoices'), n: true },
      { label: t('sales'), n: true }, { label: t('profit'), n: true }], rows);
  }

  function drawExpiry(d) {
    var rows = [];
    for (var i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      rows.push([esc(r.product_name) + '<div class="muted">' + esc(r.batch_number || '') + '</div>',
        esc(L.dstr(r.expiry_date)), esc(L.fmt(r.quantity))]);
    }
    if (!rows.length) return L.emptyCard(t('noData'));
    return table([{ label: t('name') }, { label: t('expiryDate') }, { label: t('qty'), n: true }], rows);
  }

  function drawWarehouse(d) {
    var rows = [];
    for (var i = 0; i < (d.rows || []).length; i++) {
      var r = d.rows[i];
      rows.push([esc(r.warehouse_name), esc(r.product_name), esc(L.fmt(r.quantity)), esc(L.fmt(r.stock_value))]);
    }
    if (!rows.length) return L.emptyCard(t('noData'));
    return table([{ label: t('warehouses') }, { label: t('name') },
      { label: t('qty'), n: true }, { label: t('stockValue'), n: true }], rows);
  }

  /* --------------------------- saved PDF exports ----------------------- */
  L.screens.exports = {
    title: function () { return t('exportedFiles'); },
    render: function (view) {
      view.innerHTML = L.spinner();
      L.api('GET', '/api/exports', null, function (err, data) {
        if (S.route.name !== 'exports') return;
        if (err) { view.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        var rows = data || [];
        if (!rows.length) { view.innerHTML = L.emptyCard(t('noData')); return; }
        var h = '';
        for (var i = 0; i < rows.length; i++) {
          h += '<div class="row"><div class="rowl"><div class="bigname">' + esc(rows[i].name) + '</div>'
            + '<div class="muted">' + esc(String(rows[i].created_at).slice(0, 16).replace('T', ' '))
            + ' · ' + Math.round(rows[i].size / 1024) + ' KB</div></div></div>';
        }
        view.innerHTML = h;
      });
    }
  };
}());
