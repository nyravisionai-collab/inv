/**
 * Documents — one editor and one list for every sale and purchase type.
 *
 * Sales:     sale, estimate, sale_order, delivery_challan, sale_return, pos
 * Purchases: purchase, purchase_order, purchase_return
 *
 * The React app uses two big pages (Sales.jsx / Purchases.jsx) for these; the
 * shapes are near-identical, so Lite drives both from one config table.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  /** Per-type behaviour. `side` decides sales vs purchases endpoints. */
  var DOC = {
    'sale,pos': { side: 'sale', create: 'sale', label: 'saleInvoices', stock: true, pay: true },
    sale: { side: 'sale', create: 'sale', label: 'saleInvoices', stock: true, pay: true },
    pos: { side: 'sale', create: 'pos', label: 'pos', stock: true, pay: true },
    estimate: { side: 'sale', create: 'estimate', label: 'estimates', stock: false, pay: false },
    sale_order: { side: 'sale', create: 'sale_order', label: 'saleOrders', stock: false, pay: false },
    delivery_challan: { side: 'sale', create: 'delivery_challan', label: 'deliveryChallans', stock: true, pay: false },
    sale_return: { side: 'sale', create: 'sale_return', label: 'saleReturns', stock: true, pay: true },
    purchase: { side: 'purchase', create: 'purchase', label: 'purchaseBills', stock: true, pay: true },
    purchase_order: { side: 'purchase', create: 'purchase_order', label: 'purchaseOrders', stock: false, pay: false },
    purchase_return: { side: 'purchase', create: 'purchase_return', label: 'purchaseReturns', stock: true, pay: true }
  };

  function cfg(type) { return DOC[type] || DOC.sale; }
  function isPurchase(type) { return cfg(type).side === 'purchase'; }
  function listUrl(type) { return isPurchase(type) ? '/api/purchases' : '/api/sales'; }

  /* ================================ LIST =============================== */
  function renderList(view, type) {
    var head = '<div class="card">'
      + '<input type="text" id="dlq" autocomplete="off" placeholder="' + esc(t('search')) + '"'
      + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.docListKey(this,\'' + esc(type) + '\')" /></div>'
      + '<button type="button" class="btn" onclick="Lite.go(\'docForm\',\'' + esc(type) + '\')">+ '
      + esc(t('newDoc')) + '</button>'
      + '<div id="dlres">' + L.spinner() + '</div>';
    view.innerHTML = head;
    loadList(type, 1, false);
  }

  L.screens.sales = {
    title: function (type) { return t(cfg(type || 'sale,pos').label); },
    render: function (view, type) { renderList(view, type || 'sale,pos'); }
  };

  L.screens.purchases = {
    title: function (type) { return t(cfg(type || 'purchase').label); },
    render: function (view, type) { renderList(view, type || 'purchase'); }
  };

  L.docListKey = function (el, type) {
    S.data.q = el.value;
    L.debounce('doclist', function () { loadList(type, 1, false); });
  };

  function loadList(type, page, append) {
    L.api('GET', listUrl(type) + L.qs({
      type: type, page: page, limit: 15, search: L.trim(S.data.q || '')
    }), null, function (err, data, res) {
      var box = L.$('dlres');
      if (!box) return;
      if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
      var rows = data || [];
      S.data.rows = append ? (S.data.rows || []).concat(rows) : rows;
      S.data.page = page;
      S.data.pages = (res && res.pagination && res.pagination.pages) || 1;
      drawList(box, type);
    });
  }

  function drawList(box, type) {
    var rows = S.data.rows || [];
    if (!rows.length) { box.innerHTML = L.emptyCard(t('noData')); return; }
    var purchase = isPurchase(type);
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i];
      var num = purchase ? d.bill_number : d.invoice_number;
      var date = purchase ? d.bill_date : d.invoice_date;
      var party = purchase ? d.supplier_name : d.customer_name;
      var target = purchase
        ? "Lite.go('purchaseDetail'," + Number(d.id) + ')'
        : "Lite.go('saleDetail'," + Number(d.id) + ')';
      h += '<div class="row" onclick="' + target + '">'
        + '<div class="rowl"><div class="bigname">' + esc(num) + '</div>'
        + '<div class="muted">' + esc(L.dstr(date))
        + ' · ' + esc(party || t('walkIn')) + '</div>'
        + '<div class="muted">' + L.statusChip(d.status) + ' ' + L.statusChip(d.payment_status) + '</div></div>'
        + '<div class="rowr"><b>' + esc(L.money(d.grand_total)) + '</b>'
        + (L.num(d.balance_amount) > 0
          ? '<div class="muted red">' + esc(t('balance')) + ': ' + esc(L.fmt(d.balance_amount)) + '</div>' : '')
        + '</div></div>';
    }
    if (S.data.page < S.data.pages) {
      h += '<button type="button" class="btn grey" onclick="Lite.docMore(\'' + esc(type) + '\')">'
        + esc(t('more')) + '</button>';
    }
    box.innerHTML = h;
  }

  L.docMore = function (type) { loadList(type, (S.data.page || 1) + 1, true); };

  /* =============================== DETAIL ============================== */
  function renderDetail(view, id, purchase) {
    if (S.data.doc === undefined) {
      view.innerHTML = L.spinner();
      L.api('GET', (purchase ? '/api/purchases/' : '/api/sales/') + Number(id), null, function (err, data) {
        if (S.route.name !== (purchase ? 'purchaseDetail' : 'saleDetail')) return;
        S.data.doc = err ? null : data;
        S.data.docErr = err;
        renderDetail(view, id, purchase);
      });
      return;
    }
    if (!S.data.doc) { view.innerHTML = L.errorCard(S.data.docErr, 'Lite.reload()'); return; }

    var d = S.data.doc;
    var num = purchase ? d.bill_number : d.invoice_number;
    var date = purchase ? d.bill_date : d.invoice_date;
    var party = purchase ? d.supplier_name : d.customer_name;
    var items = d.items || [];
    var i;

    var h = '<div class="card">'
      + '<div class="cardh">' + esc(num) + ' ' + L.statusChip(d.status) + '</div>'
      + '<div class="muted">' + esc(L.dstr(date)) + ' · ' + esc(party || t('walkIn')) + '</div>'
      + (d.due_date ? '<div class="muted">' + esc(t('dueDate')) + ': ' + esc(L.dstr(d.due_date)) + '</div>' : '')
      + (d.reference_number ? '<div class="muted">' + esc(t('reference')) + ': ' + esc(d.reference_number) + '</div>' : '')
      + '<hr class="sp" /><div class="tblwrap"><table class="tbl">'
      + '<tr><th>' + esc(t('name')) + '</th><th class="n">' + esc(t('qty')) + '</th>'
      + '<th class="n">' + esc(t('rate')) + '</th><th class="n">' + esc(t('total')) + '</th></tr>';
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      h += '<tr><td>' + esc(it.product_name || '')
        + (L.num(it.tax_rate) ? '<div class="muted">' + esc(t('gst')) + ' ' + esc(L.fmt(it.tax_rate)) + '</div>' : '')
        + '</td>'
        + '<td class="n">' + esc(L.fmt(it.quantity)) + '</td>'
        + '<td class="n">' + esc(L.fmt(it.unit_price)) + '</td>'
        + '<td class="n">' + esc(L.fmt(it.total)) + '</td></tr>';
    }
    h += '</table></div><hr class="sp" />'
      + L.kv(t('subtotal'), L.money(d.subtotal))
      + (L.num(d.discount_amount) ? L.kv(t('discount'), '-' + L.money(d.discount_amount)) : '')
      + (L.num(d.tax_amount) ? L.kv(t('tax'), L.money(d.tax_amount)) : '')
      + (L.num(d.shipping_charges) ? L.kv(t('shipping'), L.money(d.shipping_charges)) : '')
      + (L.num(d.other_charges) ? L.kv(t('otherCharges'), L.money(d.other_charges)) : '')
      + '<div class="kv"><span class="k"><b>' + esc(t('grandTotal')) + '</b></span>'
      + '<span class="v" style="font-size:18px;">' + esc(L.money(d.grand_total)) + '</span></div>'
      + L.kv(t('paid'), L.money(d.paid_amount))
      + (L.num(d.balance_amount) > 0 ? L.kv(t('balance'), L.money(d.balance_amount), 'red') : '')
      + (d.notes ? '<hr class="sp" /><div class="muted">' + esc(d.notes) + '</div>' : '')
      + '</div>';

    /* sale order delivery progress */
    if (!purchase && d.invoice_type === 'sale_order') {
      h += '<div class="card">' + L.sectionTitle(t('delivered'));
      for (i = 0; i < items.length; i++) {
        h += '<div class="kv"><span class="k">' + esc(items[i].product_name) + '</span>'
          + '<span class="v">' + esc(L.fmt(items[i].delivered_quantity || 0)) + ' / '
          + esc(L.fmt(items[i].quantity)) + '</span></div>';
      }
      h += '</div>';
    }

    /* actions */
    var pdfUrl = purchase ? '/api/purchases/' + Number(d.id) + '/pdf' : '/api/sales/' + Number(d.id) + '/pdf';
    h += '<div class="btnrow">'
      + '<div class="btnhalf"><a class="btn" href="' + pdfUrl + '" target="_blank">' + esc(t('viewPdf')) + '</a></div>'
      + '<div class="btnhalf">' + (purchase
        ? '<button type="button" class="btn grey" onclick="Lite.go(\'paymentForm\',\'payment_out\','
          + Number(d.supplier_id || 0) + ')">' + esc(t('recordPayment')) + '</button>'
        : '<button type="button" class="btn grey" onclick="Lite.docWhatsapp(' + Number(d.id) + ')">'
          + esc(t('sendWa')) + '</button>')
      + '</div></div>';

    if (!purchase && L.num(d.balance_amount) > 0) {
      h += '<button type="button" class="btn green" onclick="Lite.go(\'paymentForm\',\'payment_in\','
        + Number(d.customer_id || 0) + ')">' + esc(t('recordPayment')) + '</button>';
    }

    // Estimates and orders can become the real document.
    if (!purchase && (d.invoice_type === 'estimate' || d.invoice_type === 'sale_order')
      && d.status !== 'cancelled' && d.status !== 'converted') {
      h += '<div class="card">' + L.sectionTitle(t('convertTo'))
        + '<select id="convType">'
        + '<option value="sale">' + esc(t('saleInvoices')) + '</option>'
        + '<option value="delivery_challan">' + esc(t('deliveryChallans')) + '</option>'
        + '<option value="sale_order">' + esc(t('saleOrders')) + '</option>'
        + '</select>'
        + '<button type="button" class="btn" onclick="Lite.docConvert(' + Number(d.id) + ')">'
        + esc(t('convert')) + '</button></div>';
    }

    if (d.status !== 'cancelled') {
      h += '<button type="button" class="btn red" onclick="Lite.docCancel(' + Number(d.id) + ','
        + (purchase ? 'true' : 'false') + ')">' + esc(t('cancel')) + '</button>';
    }
    view.innerHTML = h;
  }

  L.screens.saleDetail = {
    title: function () { return t('saleInvoices'); },
    render: function (view, id) { renderDetail(view, id, false); }
  };

  L.screens.purchaseDetail = {
    title: function () { return t('purchaseBills'); },
    render: function (view, id) { renderDetail(view, id, true); }
  };

  L.docWhatsapp = function (id) {
    L.api('GET', '/api/sales/' + Number(id) + '/whatsapp', null, function (err, data) {
      if (err) { L.showErr(err); return; }
      if (data && data.link) {
        try { window.open(data.link, '_blank'); } catch (e) { window.location.href = data.link; }
      }
    });
  };

  L.docCancel = function (id, purchase) {
    if (!window.confirm(t('cancelDoc'))) return;
    var url = (purchase ? '/api/purchases/' : '/api/sales/') + Number(id) + '/cancel';
    L.api('POST', url, {}, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('cancelled'), true);
      L.reload();
    });
  };

  L.docConvert = function (id) {
    var to = L.val('convType');
    L.api('POST', '/api/sales/' + Number(id) + '/convert', { to_type: to }, function (err, data) {
      if (err) { L.showErr(err); return; }
      L.toast(t('converted'), true);
      L.replace('saleDetail', data.id);
    });
  };

  /* ================================ FORM =============================== */
  /** The document being composed. Rebuilt whenever the form screen opens. */
  var draft = null;

  function newDraft(type) {
    return {
      type: type,
      party: null,
      lines: [],
      date: L.todayStr(),
      dueDate: '',
      reference: '',
      supplierInvoice: '',
      notes: '',
      discType: 'amount',
      discValue: 0,
      shipping: 0,
      other: 0,
      payMode: 'cash',
      payKind: cfg(type).pay ? 'full' : 'none',
      partAmount: 0,
      status: 'completed',
      warehouse: ''
    };
  }

  L.screens.docForm = {
    title: function (type) { return t('newDoc') + ' — ' + t(cfg(type).label); },
    render: function (view, type) {
      type = type || 'sale';
      if (!draft || draft.type !== type) draft = newDraft(type);
      L.docDraft = draft;

      var c = cfg(type);
      var purchase = isPurchase(type);

      var h = '<div class="card">'
        + '<div id="dfParty"></div>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="df_date">' + esc(t('invoiceDate')) + '</label>'
        + '<input type="date" id="df_date" value="' + esc(draft.date) + '" onchange="Lite.docField(\'date\',this.value)" /></div>'
        + '<div class="fldhalf"><label class="fld" for="df_due">' + esc(t('dueDate')) + '</label>'
        + '<input type="date" id="df_due" value="' + esc(draft.dueDate) + '" onchange="Lite.docField(\'dueDate\',this.value)" /></div>'
        + '</div>'
        + '<label class="fld" for="df_ref">' + esc(t('reference')) + '</label>'
        + '<input type="text" id="df_ref" value="' + esc(draft.reference) + '" onchange="Lite.docField(\'reference\',this.value)" />'
        + (purchase
          ? '<label class="fld" for="df_sinv">' + esc(t('supplierInvoice')) + '</label>'
            + '<input type="text" id="df_sinv" value="' + esc(draft.supplierInvoice)
            + '" onchange="Lite.docField(\'supplierInvoice\',this.value)" />'
          : '')
        + '<label class="fld" for="df_status">' + esc(t('docStatus')) + '</label>'
        + '<select id="df_status" onchange="Lite.docField(\'status\',this.value)">'
        + statusOptions(draft.status)
        + '</select>'
        + '</div>'

        + '<div class="card">'
        + '<input type="text" id="dfq" autocomplete="off" placeholder="' + esc(t('addItemPh')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.docSearchKey(this)" />'
        + '<div id="dfres"></div>'
        + (purchase
          ? '<button type="button" class="btn grey small mt" onclick="Lite.docAddFree()">+ '
            + esc(t('newItemHint')) + '</button>'
          : '')
        + '</div>'

        + L.sectionTitle(t('items'))
        + '<div id="dfLines"></div>'

        + '<div class="card">'
        + '<label class="fld" for="df_disc">' + esc(t('discount')) + '</label>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><input type="number" id="df_disc" step="any" min="0" value="' + esc(draft.discValue)
        + '" onchange="Lite.docTotalsChanged()" /></div>'
        + '<div class="fldhalf"><select id="df_disct" onchange="Lite.docTotalsChanged()">'
        + '<option value="amount"' + (draft.discType === 'amount' ? ' selected="selected"' : '') + '>' + esc(t('rupees')) + '</option>'
        + '<option value="percent"' + (draft.discType === 'percent' ? ' selected="selected"' : '') + '>' + esc(t('percent')) + '</option>'
        + '</select></div></div>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="df_ship">' + esc(t('shipping')) + '</label>'
        + '<input type="number" id="df_ship" step="any" min="0" value="' + esc(draft.shipping)
        + '" onchange="Lite.docTotalsChanged()" /></div>'
        + '<div class="fldhalf"><label class="fld" for="df_other">' + esc(t('otherCharges')) + '</label>'
        + '<input type="number" id="df_other" step="any" min="0" value="' + esc(draft.other)
        + '" onchange="Lite.docTotalsChanged()" /></div></div>'
        + (c.pay
          ? '<label class="fld" for="df_mode">' + esc(t('payMode')) + '</label>'
            + '<select id="df_mode" onchange="Lite.docField(\'payMode\',this.value)">' + payModes(draft.payMode) + '</select>'
            + '<div class="seg">'
            + seg('full', t('paidL')) + seg('part', t('partialL')) + seg('credit', t('credit'))
            + '</div><div id="dfPart"></div>'
          : '')
        + '<label class="fld" for="df_notes">' + esc(t('notes')) + '</label>'
        + '<textarea id="df_notes" onchange="Lite.docField(\'notes\',this.value)">' + esc(draft.notes) + '</textarea>'
        + '<div id="dfTotal"></div>'
        + '<button type="button" id="dfSave" class="btn green" onclick="Lite.docSave()">' + esc(t('save')) + '</button>'
        + '<button type="button" class="btn grey" onclick="Lite.docReset()">' + esc(t('cancel')) + '</button>'
        + '</div>';

      view.innerHTML = h;
      drawParty();
      drawLines();
    }
  };

  function statusOptions(current) {
    var opts = [['completed', t('stCompleted')], ['draft', t('stDraft')], ['pending', t('stPending')]];
    var out = '';
    for (var i = 0; i < opts.length; i++) {
      out += '<option value="' + opts[i][0] + '"' + (current === opts[i][0] ? ' selected="selected"' : '')
        + '>' + esc(opts[i][1]) + '</option>';
    }
    return out;
  }

  function payModes(selected) {
    var modes = [['cash', t('cash')], ['card', t('card')], ['upi', t('upi')], ['bank', t('bank')], ['cheque', t('cheque')]];
    var out = '';
    for (var i = 0; i < modes.length; i++) {
      out += '<option value="' + modes[i][0] + '"' + (selected === modes[i][0] ? ' selected="selected"' : '')
        + '>' + esc(modes[i][1]) + '</option>';
    }
    return out;
  }

  function seg(kind, lbl) {
    return '<button type="button" class="segb' + (draft.payKind === kind ? ' on' : '')
      + '" onclick="Lite.docPayKind(\'' + kind + '\')">' + esc(lbl) + '</button>';
  }

  L.docField = function (field, value) { draft[field] = value; };

  L.docPayKind = function (kind) {
    draft.payKind = kind;
    L.go('docForm', draft.type, null, true);
  };

  L.docReset = function () {
    draft = null;
    L.back();
  };

  /* party ---------------------------------------------------------------- */
  function drawParty() {
    var box = L.$('dfParty');
    if (!box) return;
    var purchase = isPurchase(draft.type);
    var lbl = purchase ? t('supplier') : t('customer');
    if (draft.party) {
      box.innerHTML = '<div class="row"><div class="rowl"><b>' + esc(draft.party.name) + '</b>'
        + '<div class="muted">' + esc(lbl) + '</div></div>'
        + '<div class="rowr"><button type="button" class="btn grey small" onclick="Lite.docPickParty()">'
        + esc(t('changeParty')) + '</button></div></div>';
    } else {
      box.innerHTML = '<button type="button" class="btn grey" onclick="Lite.docPickParty()">'
        + esc(t('selectParty')) + ' — ' + esc(lbl) + '</button>';
    }
  }

  L.docPickParty = function () {
    L.pickParty(isPurchase(draft.type) ? 'supplier' : 'customer', function (party) {
      draft.party = party;
      L.go('docForm', draft.type, null, true);
    });
  };

  /* item search ---------------------------------------------------------- */
  L.docSearchKey = function (el) {
    S.data.q = el.value;
    L.debounce('docsearch', function () {
      var q = L.trim(S.data.q);
      if (!q) { S.data.res = []; drawSearch(); return; }
      L.api('GET', '/api/products' + L.qs({ limit: 12, search: q }), null, function (err, data) {
        if (err) { L.showErr(err); return; }
        S.data.res = data || [];
        drawSearch();
      });
    }, 250);
  };

  function drawSearch() {
    var box = L.$('dfres');
    if (!box) return;
    var rows = S.data.res || [];
    if (!rows.length) { box.innerHTML = ''; return; }
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      h += '<div class="row" onclick="Lite.docAdd(' + Number(p.id) + ')">'
        + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
        + '<div class="muted">' + esc(L.money(isPurchase(draft.type) ? p.purchase_price : p.selling_price))
        + ' · ' + esc(t('avail')) + ': ' + esc(L.fmt(p.current_stock)) + '</div></div>'
        + '<div class="rowr"><span class="chip green">+</span></div></div>';
    }
    box.innerHTML = h;
  }

  L.docAdd = function (pid) {
    var p = L.findBy(S.data.res || [], 'id', pid);
    if (!p) return;
    for (var i = 0; i < draft.lines.length; i++) {
      if (String(draft.lines[i].pid) === String(p.id)) {
        draft.lines[i].qty = L.round2(draft.lines[i].qty + 1);
        drawLines();
        return;
      }
    }
    draft.lines.push({
      pid: Number(p.id),
      name: p.name,
      price: L.num(isPurchase(draft.type) ? p.purchase_price : p.selling_price),
      rate: L.num(p.tax_rate),
      ttype: p.tax_type || 'exclusive',
      unit: p.unit_short || '',
      hsn: p.hsn_code || '',
      qty: 1,
      discType: 'amount',
      discValue: 0,
      batch: '',
      expiry: ''
    });
    drawLines();
  };

  /** A purchase bill may name goods that are not in the catalogue yet. */
  L.docAddFree = function () {
    var name = window.prompt(t('name'));
    if (!name) return;
    draft.lines.push({
      pid: null, name: L.trim(name), price: 0, rate: 0, ttype: 'exclusive',
      unit: '', hsn: '', qty: 1, discType: 'amount', discValue: 0, batch: '', expiry: ''
    });
    drawLines();
  };

  /* lines ---------------------------------------------------------------- */
  function drawLines() {
    var box = L.$('dfLines');
    if (!box) return;
    if (!draft.lines.length) { box.innerHTML = L.emptyCard(t('addOne')); drawTotals(); return; }
    var purchase = isPurchase(draft.type);
    var h = '';
    for (var i = 0; i < draft.lines.length; i++) {
      var c = draft.lines[i];
      var lc = L.lineCalc(c.qty, c.price, c.discType, c.discValue, c.rate, c.ttype);
      h += '<div class="row">'
        + '<div class="bigname">' + esc(c.name) + (c.pid ? '' : ' <span class="chip blue">' + esc(t('add')) + '</span>') + '</div>'
        + '<div class="muted">' + esc(L.money(lc.total)) + ' · ' + esc(t('taxable')) + ' ' + esc(L.fmt(lc.taxableAmount))
        + (lc.taxAmount ? ' · ' + esc(t('tax')) + ' ' + esc(L.fmt(lc.taxAmount)) : '') + '</div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.docQty(' + i + ',-1)">&minus;</button></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.qty)
        + '" title="' + esc(t('qty')) + '" onchange="Lite.docSet(' + i + ',\'qty\',this.value)" /></div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.docQty(' + i + ',1)">+</button></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.price)
        + '" title="' + esc(t('price')) + '" onchange="Lite.docSet(' + i + ',\'price\',this.value)" /></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.rate)
        + '" title="' + esc(t('gst')) + '" onchange="Lite.docSet(' + i + ',\'rate\',this.value)" /></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.discValue)
        + '" title="' + esc(t('lineDisc')) + '" onchange="Lite.docSet(' + i + ',\'discValue\',this.value)" /></div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.docDel(' + i + ')">&times;</button></div>'
        + (purchase
          ? '<div style="clear:both;padding-top:6px;"><div class="fldrow">'
            + '<div class="fldhalf"><input type="text" placeholder="' + esc(t('batchNo')) + '" value="' + esc(c.batch)
            + '" onchange="Lite.docSetText(' + i + ',\'batch\',this.value)" /></div>'
            + '<div class="fldhalf"><input type="date" title="' + esc(t('expiryDate')) + '" value="' + esc(c.expiry)
            + '" onchange="Lite.docSetText(' + i + ',\'expiry\',this.value)" /></div>'
            + '</div></div>'
          : '')
        + '</div>';
    }
    box.innerHTML = h;
    drawTotals();
  }

  L.docQty = function (i, delta) {
    if (!draft.lines[i]) return;
    var q = L.round2(draft.lines[i].qty + delta);
    draft.lines[i].qty = q > 0 ? q : 1;
    drawLines();
  };

  L.docSet = function (i, field, value) {
    if (!draft.lines[i]) return;
    var v = L.round2(L.num(value));
    if (field === 'qty') draft.lines[i].qty = v > 0 ? v : 1;
    else draft.lines[i][field] = Math.max(0, v);
    drawLines();
  };

  L.docSetText = function (i, field, value) {
    if (!draft.lines[i]) return;
    draft.lines[i][field] = L.trim(value);
  };

  L.docDel = function (i) { draft.lines.splice(i, 1); drawLines(); };

  L.docTotalsChanged = function () {
    draft.discValue = L.num(L.val('df_disc'));
    draft.discType = L.val('df_disct') || 'amount';
    draft.shipping = L.num(L.val('df_ship'));
    draft.other = L.num(L.val('df_other'));
    drawTotals();
  };

  function docTotals() {
    return L.documentTotals(draft.lines, draft.discType, draft.discValue,
      draft.shipping, draft.other, 0);
  }

  function docPaid(grand) {
    if (!cfg(draft.type).pay || draft.payKind === 'credit' || draft.payKind === 'none') return 0;
    if (draft.payKind === 'part') return Math.min(L.round2(draft.partAmount), grand);
    return grand;
  }

  function drawTotals() {
    var tot = docTotals();
    var partBox = L.$('dfPart');
    if (partBox) {
      partBox.innerHTML = draft.payKind === 'part'
        ? '<label class="fld" for="df_part">' + esc(t('paidAmount')) + '</label>'
          + '<input type="number" id="df_part" step="any" min="0" value="' + esc(draft.partAmount)
          + '" onchange="Lite.docPart(this.value)" />'
        : '';
    }
    var box = L.$('dfTotal');
    if (!box) return;
    var paid = docPaid(tot.grandTotal);
    box.innerHTML = '<hr class="sp" />'
      + L.kv(t('subtotal'), L.money(tot.subtotal))
      + (tot.discountAmount ? L.kv(t('discount'), '-' + L.money(tot.discountAmount)) : '')
      + (tot.taxAmount ? L.kv(t('tax'), L.money(tot.taxAmount)) : '')
      + '<div class="kv"><span class="k"><b>' + esc(t('grandTotal')) + '</b></span>'
      + '<span class="v" style="font-size:18px;">' + esc(L.money(tot.grandTotal)) + '</span></div>'
      + (paid < tot.grandTotal ? L.kv(t('balance'), L.money(L.round2(tot.grandTotal - paid)), 'red') : '')
      + '<hr class="sp" />';
  }

  L.docPart = function (v) { draft.partAmount = Math.max(0, L.num(v)); drawTotals(); };

  /* save ----------------------------------------------------------------- */
  L.docSave = function () {
    if (S.busy) return;
    if (!draft.lines.length) { L.toast(t('addOne'), false); return; }

    var purchase = isPurchase(draft.type);
    var c = cfg(draft.type);
    var tot = docTotals();
    var items = [];
    for (var i = 0; i < draft.lines.length; i++) {
      var l = draft.lines[i];
      var item = {
        product_name: l.name,
        quantity: l.qty,
        unit_price: l.price,
        discount_type: l.discType,
        discount_value: l.discValue,
        tax_rate: L.num(l.rate),
        tax_type: l.ttype
      };
      if (l.pid) item.product_id = l.pid;
      if (l.hsn) item.hsn_code = l.hsn;
      if (purchase && l.batch) item.batch_number = l.batch;
      if (purchase && l.expiry) item.expiry_date = l.expiry;
      items.push(item);
    }

    var body = {
      items: items,
      discount_type: draft.discType,
      discount_value: L.round2(draft.discValue),
      shipping_charges: L.round2(draft.shipping),
      other_charges: L.round2(draft.other),
      status: draft.status,
      notes: L.trim(draft.notes) || undefined,
      reference_number: L.trim(draft.reference) || undefined,
      paid_amount: docPaid(tot.grandTotal),
      payment_mode: draft.payMode
    };
    if (draft.dueDate) body.due_date = draft.dueDate;

    if (purchase) {
      body.bill_type = c.create;
      body.bill_date = draft.date;
      if (draft.party) body.supplier_id = draft.party.id;
      if (L.trim(draft.supplierInvoice)) body.supplier_invoice = L.trim(draft.supplierInvoice);
    } else {
      body.invoice_type = c.create;
      body.invoice_date = draft.date;
      if (draft.party) body.customer_id = draft.party.id;
    }

    S.busy = true;
    L.toast(t('saving'), 'info');
    L.api('POST', purchase ? '/api/purchases' : '/api/sales', body, function (err, data) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk') + ': ' + (data.invoice_number || data.bill_number || ''), true);
      draft = null;
      L.replace(purchase ? 'purchaseDetail' : 'saleDetail', data.id);
    });
  };
}());
