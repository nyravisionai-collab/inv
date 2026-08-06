/**
 * Inventory: products (list/create/edit/delete), stock browsing, adjustments,
 * transfers, low stock, the stock report, master data (categories, brands,
 * units, warehouses) and printable barcodes.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  /* ============================== STOCK TAB ============================= */
  // The "Stock" tab is the inventory hub: search + shortcuts.
  L.screens.stock = {
    title: function () { return t('navInventory'); },
    render: function (view) {
      view.innerHTML = '<div class="card">'
        + '<input type="text" id="stq" autocomplete="off" placeholder="' + esc(t('searchPh')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.stockKey(this)" /></div>'
        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn" onclick="Lite.go(\'productForm\')">+ '
        + esc(t('products')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.go(\'lowStock\')">'
        + esc(t('lowStock')) + '</button></div></div>'
        + '<div class="btnrow">'
        + '<div class="btnthird"><button type="button" class="btn grey small" onclick="Lite.go(\'stockTransfer\')">'
        + esc(t('stockTransfer')) + '</button></div>'
        + '<div class="btnthird"><button type="button" class="btn grey small" onclick="Lite.go(\'stockReport\')">'
        + esc(t('stockReport')) + '</button></div>'
        + '<div class="btnthird"><button type="button" class="btn grey small" onclick="Lite.go(\'barcodes\')">'
        + esc(t('barcodes')) + '</button></div>'
        + '</div>'
        + '<div id="stres">' + L.spinner() + '</div>';
      loadStock();
    }
  };

  L.stockKey = function (el) {
    S.data.q = el.value;
    L.debounce('stock', loadStock);
  };

  function loadStock() {
    L.api('GET', '/api/products' + L.qs({ limit: 25, search: L.trim(S.data.q || '') }), null, function (err, data) {
      var box = L.$('stres');
      if (!box) return;
      if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
      box.innerHTML = productRows(data || [], 'stockAdjust');
    });
  }

  function productRows(rows, action) {
    if (!rows.length) return L.emptyCard(t('noData'));
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      var low = L.num(p.min_stock) > 0 && L.num(p.current_stock) <= L.num(p.min_stock);
      h += '<div class="row' + (low ? ' lowstock' : '') + '">'
        + '<div class="rowl" onclick="Lite.go(\'' + action + '\',' + Number(p.id) + ')">'
        + '<div class="bigname">' + esc(p.name) + '</div>'
        + '<div class="muted">' + esc(L.money(p.selling_price))
        + ' · ' + esc(t('avail')) + ': ' + esc(L.fmt(p.current_stock)) + ' ' + esc(p.unit_short || '')
        + (L.num(p.min_stock) ? ' · ' + esc(t('minStock')) + ' ' + esc(L.fmt(p.min_stock)) : '')
        + '</div></div>'
        + '<div class="rowr">'
        + '<span class="chip ' + (low ? 'red' : 'green') + '">' + esc(L.fmt(p.current_stock)) + '</span>'
        + '<div><button type="button" class="btn grey small mt" onclick="Lite.go(\'productForm\',' + Number(p.id) + ')">'
        + esc(t('edit')) + '</button></div>'
        + '</div></div>';
    }
    return h;
  }

  /* ============================== PRODUCTS ============================== */
  L.screens.products = {
    title: function () { return t('products'); },
    render: function (view) {
      view.innerHTML = '<div class="card">'
        + '<input type="text" id="prq" autocomplete="off" placeholder="' + esc(t('searchPh')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.productsKey(this)" /></div>'
        + '<button type="button" class="btn" onclick="Lite.go(\'productForm\')">+ ' + esc(t('add')) + '</button>'
        + '<div id="prres">' + L.spinner() + '</div>';
      loadProducts();
    }
  };

  L.productsKey = function (el) {
    S.data.q = el.value;
    L.debounce('products', loadProducts);
  };

  function loadProducts() {
    L.api('GET', '/api/products' + L.qs({ limit: 30, search: L.trim(S.data.q || '') }), null, function (err, data) {
      var box = L.$('prres');
      if (!box) return;
      if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
      box.innerHTML = productRows(data || [], 'productForm');
    });
  }

  L.screens.lowStock = {
    title: function () { return t('lowStock'); },
    render: function (view) {
      view.innerHTML = L.spinner();
      L.api('GET', '/api/products/low-stock', null, function (err, data) {
        if (S.route.name !== 'lowStock') return;
        if (err) { view.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        var rows = data || [];
        if (!rows.length) { view.innerHTML = L.emptyCard(t('noLow')); return; }
        var h = '';
        for (var i = 0; i < rows.length; i++) {
          var p = rows[i];
          h += '<div class="row lowstock" onclick="Lite.go(\'stockAdjust\',' + Number(p.id) + ')">'
            + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
            + '<div class="muted">' + esc(t('avail')) + ': ' + esc(L.fmt(p.current_stock))
            + ' / ' + esc(t('minStock')) + ' ' + esc(L.fmt(p.min_stock)) + '</div></div>'
            + '<div class="rowr"><span class="chip red">' + esc(L.fmt(p.current_stock)) + '</span></div></div>';
        }
        view.innerHTML = h;
      });
    }
  };

  /* ---------------------------- product form --------------------------- */
  L.screens.productForm = {
    title: function (id) { return (id ? t('edit') : t('add')) + ' — ' + t('products'); },
    render: function (view, id) {
      // Reference data first so the dropdowns are never empty on first paint.
      if (!S.units || !S.categories || !S.brands) {
        view.innerHTML = L.spinner();
        L.ensure('units', '/api/units', function () {
          L.ensure('categories', '/api/categories', function () {
            L.ensure('brands', '/api/brands', function () {
              if (S.route.name === 'productForm') L.screens.productForm.render(view, id);
            });
          });
        });
        return;
      }
      if (id && S.data.product === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/products/' + Number(id), null, function (err, data) {
          if (S.route.name !== 'productForm') return;
          S.data.product = err ? null : data;
          L.screens.productForm.render(view, id);
        });
        return;
      }

      var p = S.data.product || {};
      var h = '<div class="card">'
        + '<label class="fld" for="pi_name">' + esc(t('name')) + ' *</label>'
        + '<input type="text" id="pi_name" value="' + esc(p.name || '') + '" />'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="pi_sell">' + esc(t('sellPrice')) + '</label>'
        + '<input type="number" id="pi_sell" step="any" min="0" value="' + esc(p.selling_price || '') + '" /></div>'
        + '<div class="fldhalf"><label class="fld" for="pi_buy">' + esc(t('buyPrice')) + '</label>'
        + '<input type="number" id="pi_buy" step="any" min="0" value="' + esc(p.purchase_price || '') + '" /></div>'
        + '</div>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="pi_mrp">' + esc(t('mrp')) + '</label>'
        + '<input type="number" id="pi_mrp" step="any" min="0" value="' + esc(p.mrp || '') + '" /></div>'
        + '<div class="fldhalf"><label class="fld" for="pi_open">' + esc(t('openStock')) + '</label>'
        + '<input type="number" id="pi_open" step="any" min="0" value="' + esc(id ? p.current_stock : '') + '"'
        + (id ? ' disabled="disabled"' : '') + ' /></div>'
        + '</div>'
        + '<label class="fld" for="pi_unit">' + esc(t('unit')) + '</label>'
        + '<select id="pi_unit">' + options(S.units, p.unit_id, 'name', 'short_name') + '</select>'
        + '<label class="fld" for="pi_cat">' + esc(t('category')) + '</label>'
        + '<select id="pi_cat">' + options(S.categories, p.category_id, 'name') + '</select>'
        + '<label class="fld" for="pi_brand">' + esc(t('brand')) + '</label>'
        + '<select id="pi_brand">' + options(S.brands, p.brand_id, 'name') + '</select>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="pi_gst">' + esc(t('gst')) + '</label>'
        + '<select id="pi_gst">' + gstOptions(p.tax_rate) + '</select></div>'
        + '<div class="fldhalf"><label class="fld" for="pi_ttype">' + esc(t('tax')) + '</label>'
        + '<select id="pi_ttype">'
        + '<option value="exclusive"' + (p.tax_type === 'exclusive' || !p.tax_type ? ' selected="selected"' : '') + '>' + esc(t('taxTypeExc')) + '</option>'
        + '<option value="inclusive"' + (p.tax_type === 'inclusive' ? ' selected="selected"' : '') + '>' + esc(t('taxTypeInc')) + '</option>'
        + '<option value="none"' + (p.tax_type === 'none' ? ' selected="selected"' : '') + '>' + esc(t('taxTypeNone')) + '</option>'
        + '</select></div></div>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="pi_min">' + esc(t('minStock')) + '</label>'
        + '<input type="number" id="pi_min" step="any" min="0" value="' + esc(p.min_stock || '') + '" /></div>'
        + '<div class="fldhalf"><label class="fld" for="pi_hsn">' + esc(t('hsn')) + '</label>'
        + '<input type="text" id="pi_hsn" value="' + esc(p.hsn_code || '') + '" /></div>'
        + '</div>'
        + '<label class="fld" for="pi_sku">' + esc(t('sku')) + '</label>'
        + '<input type="text" id="pi_sku" value="' + esc(p.sku || '') + '" />'
        + '<label class="fld" for="pi_barcode">' + esc(t('barcodes')) + '</label>'
        + '<input type="text" id="pi_barcode" value="' + esc(p.barcode || '') + '" />'
        + '<button type="button" class="btn green" onclick="Lite.productSave(' + (id ? Number(id) : 0) + ')">'
        + esc(t('save')) + '</button>'
        + (id
          ? '<div class="btnrow">'
            + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.go(\'stockAdjust\','
              + Number(id) + ')">' + esc(t('stockAdjustment')) + '</button></div>'
            + '<div class="btnhalf"><button type="button" class="btn red" onclick="Lite.productDelete('
              + Number(id) + ')">' + esc(t('del')) + '</button></div></div>'
          : '')
        + '</div>';
      view.innerHTML = h;
    }
  };

  function options(rows, selected, nameKey, shortKey) {
    var out = '<option value="">—</option>';
    if (!rows) return out;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var label = r[nameKey] + (shortKey && r[shortKey] ? ' (' + r[shortKey] + ')' : '');
      out += '<option value="' + Number(r.id) + '"'
        + (String(selected) === String(r.id) ? ' selected="selected"' : '') + '>' + esc(label) + '</option>';
    }
    return out;
  }

  function gstOptions(current) {
    var rates = [0, 5, 12, 18, 28];
    var cur = current === undefined || current === null ? 18 : L.num(current);
    var out = '';
    for (var i = 0; i < rates.length; i++) {
      out += '<option value="' + rates[i] + '"' + (cur === rates[i] ? ' selected="selected"' : '')
        + '>' + rates[i] + '%</option>';
    }
    return out;
  }

  L.productSave = function (id) {
    if (S.busy) return;
    var name = L.trim(L.val('pi_name'));
    if (!name) { L.toast(t('nameReq'), false); return; }
    var body = {
      name: name,
      selling_price: L.num(L.val('pi_sell')),
      purchase_price: L.num(L.val('pi_buy')),
      mrp: L.num(L.val('pi_mrp')),
      tax_rate: L.num(L.val('pi_gst')),
      tax_type: L.val('pi_ttype') || 'exclusive',
      min_stock: L.num(L.val('pi_min'))
    };
    var unit = L.val('pi_unit'); if (unit) body.unit_id = L.toInt(unit);
    var cat = L.val('pi_cat'); if (cat) body.category_id = L.toInt(cat);
    var brand = L.val('pi_brand'); if (brand) body.brand_id = L.toInt(brand);
    var hsn = L.trim(L.val('pi_hsn')); if (hsn) body.hsn_code = hsn;
    var sku = L.trim(L.val('pi_sku')); if (sku) body.sku = sku;
    var bc = L.trim(L.val('pi_barcode')); if (bc) body.barcode = bc;
    if (!id) body.opening_stock = L.num(L.val('pi_open'));

    S.busy = true;
    L.api(id ? 'PUT' : 'POST', '/api/products' + (id ? '/' + Number(id) : ''), body, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(id ? t('updatedOk') : t('itemCreated'), true);
      L.back();
    });
  };

  L.productDelete = function (id) {
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', '/api/products/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      L.back();
    });
  };

  /* --------------------------- stock adjust ---------------------------- */
  L.screens.stockAdjust = {
    title: function () { return t('stockAdjustment'); },
    render: function (view, id) {
      if (!id) {
        // No product chosen yet: offer a picker.
        view.innerHTML = '<div class="card">'
          + '<input type="text" id="saq" autocomplete="off" placeholder="' + esc(t('searchPh')) + '"'
          + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.adjustSearch(this)" /></div>'
          + '<div id="sares"></div>';
        return;
      }
      if (S.data.product === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/products/' + Number(id), null, function (err, data) {
          if (S.route.name !== 'stockAdjust') return;
          S.data.product = err ? null : data;
          S.data.err = err;
          L.screens.stockAdjust.render(view, id);
        });
        return;
      }
      if (!S.data.product) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var p = S.data.product;
      view.innerHTML = '<div class="card">'
        + '<div class="cardh">' + esc(p.name) + '</div>'
        + L.kv(t('current'), L.fmt(p.current_stock) + ' ' + (p.unit_name || ''))
        + '<hr class="sp" />'
        + '<label class="fld" for="sa_dir">' + esc(t('direction')) + '</label>'
        + '<select id="sa_dir"><option value="in">' + esc(t('dirIn')) + '</option>'
        + '<option value="out">' + esc(t('dirOut')) + '</option></select>'
        + '<label class="fld" for="sa_qty">' + esc(t('qty')) + '</label>'
        + '<input type="number" id="sa_qty" step="any" min="0" value="1" />'
        + '<label class="fld" for="sa_reason">' + esc(t('reason')) + '</label>'
        + '<select id="sa_reason">'
        + '<option value="purchase">' + esc(t('rPurchase')) + '</option>'
        + '<option value="damage">' + esc(t('rDamage')) + '</option>'
        + '<option value="correction">' + esc(t('rCorrection')) + '</option>'
        + '<option value="other">' + esc(t('rOther')) + '</option></select>'
        + '<label class="fld" for="sa_notes">' + esc(t('notes')) + '</label>'
        + '<input type="text" id="sa_notes" value="" />'
        + '<button type="button" class="btn green" onclick="Lite.adjustSave(' + Number(id) + ')">'
        + esc(t('save')) + '</button></div>';
    }
  };

  L.adjustSearch = function (el) {
    S.data.q = el.value;
    L.debounce('adjust', function () {
      var q = L.trim(S.data.q);
      if (!q) { var b = L.$('sares'); if (b) b.innerHTML = ''; return; }
      L.api('GET', '/api/products' + L.qs({ limit: 15, search: q }), null, function (err, data) {
        var box = L.$('sares');
        if (!box) return;
        if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        box.innerHTML = productRows(data || [], 'stockAdjust');
      });
    });
  };

  L.adjustSave = function (id) {
    if (S.busy) return;
    var q = L.num(L.val('sa_qty'));
    if (q <= 0) { L.toast(t('qtyErr'), false); return; }
    var cur = L.num(S.data.product.current_stock);
    var newQty = L.val('sa_dir') === 'in' ? L.round2(cur + q) : L.round2(cur - q);
    if (newQty < 0) { L.toast(t('qtyNeg'), false); return; }

    S.busy = true;
    L.api('POST', '/api/stock/adjustments', {
      reason: L.val('sa_reason'),
      notes: L.trim(L.val('sa_notes')) || 'lite',
      items: [{ product_id: Number(id), new_qty: newQty }]
    }, function (err, data) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      var item = (data && data.items && data.items[0]) || {};
      L.toast(t('saved') + ': ' + L.fmt(item.previous_qty) + ' → ' + L.fmt(item.new_qty), true);
      S.data.product.current_stock = L.num(item.new_qty);
      L.render();
    });
  };

  /* -------------------------- stock transfer --------------------------- */
  L.screens.stockTransfer = {
    title: function () { return t('stockTransfer'); },
    render: function (view) {
      if (!S.warehouses) {
        view.innerHTML = L.spinner();
        L.ensure('warehouses', '/api/warehouses', function () {
          if (S.route.name === 'stockTransfer') L.screens.stockTransfer.render(view);
        });
        return;
      }
      if (!S.data.lines) S.data.lines = [];

      view.innerHTML = '<div class="card">'
        + '<label class="fld" for="tr_from">' + esc(t('fromWh')) + '</label>'
        + '<select id="tr_from">' + options(S.warehouses, '', 'name') + '</select>'
        + '<label class="fld" for="tr_to">' + esc(t('toWh')) + '</label>'
        + '<select id="tr_to">' + options(S.warehouses, '', 'name') + '</select>'
        + '<label class="fld" for="tr_notes">' + esc(t('notes')) + '</label>'
        + '<input type="text" id="tr_notes" /></div>'
        + '<div class="card">'
        + '<input type="text" id="trq" autocomplete="off" placeholder="' + esc(t('addItemPh')) + '"'
        + ' onkeyup="Lite.transferSearch(this)" /><div id="trres"></div></div>'
        + '<div id="trLines"></div>'
        + '<button type="button" class="btn green" onclick="Lite.transferSave()">' + esc(t('save')) + '</button>';
      drawTransferLines();
    }
  };

  L.transferSearch = function (el) {
    S.data.q = el.value;
    L.debounce('transfer', function () {
      var q = L.trim(S.data.q);
      if (!q) { var b = L.$('trres'); if (b) b.innerHTML = ''; return; }
      L.api('GET', '/api/products' + L.qs({ limit: 12, search: q }), null, function (err, data) {
        var box = L.$('trres');
        if (!box) return;
        if (err) { L.showErr(err); return; }
        S.data.res = data || [];
        var h = '';
        for (var i = 0; i < S.data.res.length; i++) {
          var p = S.data.res[i];
          h += '<div class="row" onclick="Lite.transferAdd(' + Number(p.id) + ')">'
            + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
            + '<div class="muted">' + esc(t('avail')) + ': ' + esc(L.fmt(p.current_stock)) + '</div></div>'
            + '<div class="rowr"><span class="chip green">+</span></div></div>';
        }
        box.innerHTML = h;
      });
    });
  };

  L.transferAdd = function (pid) {
    var p = L.findBy(S.data.res || [], 'id', pid);
    if (!p) return;
    if (!S.data.lines) S.data.lines = [];
    S.data.lines.push({ pid: Number(p.id), name: p.name, qty: 1 });
    drawTransferLines();
  };

  function drawTransferLines() {
    var box = L.$('trLines');
    if (!box) return;
    var lines = S.data.lines || [];
    if (!lines.length) { box.innerHTML = L.emptyCard(t('addOne')); return; }
    var h = '';
    for (var i = 0; i < lines.length; i++) {
      h += '<div class="row"><div class="bigname">' + esc(lines[i].name) + '</div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(lines[i].qty)
        + '" onchange="Lite.transferQty(' + i + ',this.value)" /></div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.transferDel(' + i + ')">&times;</button></div>'
        + '</div>';
    }
    box.innerHTML = h;
  }

  L.transferQty = function (i, v) {
    if (!S.data.lines[i]) return;
    var q = L.round2(L.num(v));
    S.data.lines[i].qty = q > 0 ? q : 1;
    drawTransferLines();
  };

  L.transferDel = function (i) { S.data.lines.splice(i, 1); drawTransferLines(); };

  L.transferSave = function () {
    if (S.busy) return;
    var lines = S.data.lines || [];
    if (!lines.length) { L.toast(t('addOne'), false); return; }
    var items = [];
    for (var i = 0; i < lines.length; i++) items.push({ product_id: lines[i].pid, quantity: lines[i].qty });

    S.busy = true;
    L.api('POST', '/api/stock/transfers', {
      from_warehouse_id: L.toInt(L.val('tr_from')),
      to_warehouse_id: L.toInt(L.val('tr_to')),
      notes: L.trim(L.val('tr_notes')) || null,
      items: items
    }, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('transferOk'), true);
      L.back();
    });
  };

  /* --------------------------- stock report ---------------------------- */
  L.screens.stockReport = {
    title: function () { return t('stockReport'); },
    render: function (view) {
      view.innerHTML = L.spinner();
      L.api('GET', '/api/stock/report', null, function (err, data) {
        if (S.route.name !== 'stockReport') return;
        if (err) { view.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        var rows = data || [];
        if (!rows.length) { view.innerHTML = L.emptyCard(t('noData')); return; }
        var totalQty = 0, totalVal = 0, h = '';
        h += '<div class="card tblwrap"><table class="tbl">'
          + '<tr><th>' + esc(t('name')) + '</th><th class="n">' + esc(t('qty')) + '</th>'
          + '<th class="n">' + esc(t('buyPrice')) + '</th><th class="n">' + esc(t('stockValue')) + '</th></tr>';
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          var value = r.stock_value !== undefined
            ? L.num(r.stock_value) : L.num(r.quantity) * L.num(r.purchase_price);
          totalQty = L.round2(totalQty + L.num(r.quantity));
          totalVal = L.round2(totalVal + value);
          h += '<tr><td>' + esc(r.name) + (r.sku ? '<div class="muted">' + esc(r.sku) + '</div>' : '') + '</td>'
            + '<td class="n">' + esc(L.fmt(r.quantity)) + '</td>'
            + '<td class="n">' + esc(L.fmt(r.purchase_price)) + '</td>'
            + '<td class="n">' + esc(L.fmt(value)) + '</td></tr>';
        }
        h += '</table></div>';
        view.innerHTML = '<div class="card">'
          + L.kv(t('totalProducts'), String(rows.length))
          + L.kv(t('qty'), L.fmt(totalQty))
          + L.kv(t('stockValue'), L.money(totalVal))
          + '</div>' + h
          + '<button type="button" class="btn grey" onclick="Lite.reportPdf(\'stock\',{})">'
          + esc(t('savePdf')) + '</button>';
      });
    }
  };

  /* ============================ MASTER DATA ============================= */
  /**
   * Categories, brands, units and warehouses share one CRUD screen; only the
   * endpoint and the extra fields differ.
   */
  var MASTERS = {
    categories: { url: '/api/categories', label: 'categories', cache: 'categories', extra: 'description' },
    brands: { url: '/api/brands', label: 'brands', cache: 'brands', extra: 'description' },
    units: { url: '/api/units', label: 'units', cache: 'units', extra: 'short_name', required: true },
    warehouses: { url: '/api/warehouses', label: 'warehouses', cache: 'warehouses', extra: 'code' }
  };

  function masterScreen(key) {
    var m = MASTERS[key];
    return {
      title: function () { return t(m.label); },
      render: function (view) {
        if (S.data.rows === undefined) {
          view.innerHTML = L.spinner();
          L.api('GET', m.url, null, function (err, data) {
            if (S.route.name !== key) return;
            S.data.rows = err ? null : (data || []);
            S.data.err = err;
            L.screens[key].render(view);
          });
          return;
        }
        if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

        var h = '<div class="card">'
          + '<label class="fld" for="ms_name">' + esc(t('name')) + ' *</label>'
          + '<input type="text" id="ms_name" />'
          + '<label class="fld" for="ms_extra">'
          + esc(key === 'units' ? t('shortName') : (key === 'warehouses' ? t('code') : t('description')))
          + '</label>'
          + '<input type="text" id="ms_extra" />'
          + '<button type="button" class="btn green" onclick="Lite.masterAdd(\'' + key + '\')">+ '
          + esc(t('add')) + '</button></div>';

        if (!S.data.rows.length) { view.innerHTML = h + L.emptyCard(t('noData')); return; }
        for (var i = 0; i < S.data.rows.length; i++) {
          var r = S.data.rows[i];
          h += '<div class="row"><div class="rowl"><div class="bigname">' + esc(r.name) + '</div>'
            + '<div class="muted">' + esc(r[m.extra] || '')
            + (r.product_count !== undefined ? ' · ' + r.product_count + ' ' + esc(t('products')) : '')
            + '</div></div>'
            + '<div class="rowr"><button type="button" class="btn red small" onclick="Lite.masterDel(\''
            + key + '\',' + Number(r.id) + ')">' + esc(t('del')) + '</button></div></div>';
        }
        view.innerHTML = h;
      }
    };
  }

  L.screens.categories = masterScreen('categories');
  L.screens.brands = masterScreen('brands');
  L.screens.units = masterScreen('units');
  L.screens.warehouses = masterScreen('warehouses');

  L.masterAdd = function (key) {
    var m = MASTERS[key];
    var name = L.trim(L.val('ms_name'));
    if (!name) { L.toast(t('nameReq'), false); return; }
    var extra = L.trim(L.val('ms_extra'));
    if (m.required && !extra) { L.toast(t('required'), false); return; }
    var body = { name: name };
    body[m.extra] = extra || null;
    L.api('POST', m.url, body, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk'), true);
      S[m.cache] = null;   // invalidate the dropdown cache
      L.reload();
    });
  };

  L.masterDel = function (key, id) {
    var m = MASTERS[key];
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', m.url + '/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      S[m.cache] = null;
      L.reload();
    });
  };

  /* ============================== BARCODES ============================== */
  L.screens.barcodes = {
    title: function () { return t('barcodes'); },
    render: function (view) {
      if (S.data.rows === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/products/barcodes/all', null, function (err, data) {
          if (S.route.name !== 'barcodes') return;
          S.data.rows = err ? null : (data || []);
          S.data.err = err;
          L.screens.barcodes.render(view);
        });
        return;
      }
      if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }
      if (!S.data.rows.length) { view.innerHTML = L.emptyCard(t('noData')); return; }

      // QR codes arrive as data: URLs — no extra requests, and they print.
      var h = '<div class="card noprint">'
        + '<button type="button" class="btn" onclick="Lite.printPage()">' + esc(t('print')) + '</button></div>'
        + '<div class="bcgrid">';
      for (var i = 0; i < S.data.rows.length; i++) {
        var b = S.data.rows[i];
        h += '<div class="bccell"><div class="bcin">'
          + '<img src="' + esc(b.qr) + '" alt="' + esc(b.code) + '" />'
          + '<div class="nm">' + esc(b.name) + '</div>'
          + '<div class="cd">' + esc(b.code) + '</div>'
          + '<div class="cd"><b>' + esc(L.money(b.price)) + '</b></div>'
          + '</div></div>';
      }
      h += '</div>';
      view.innerHTML = h;
    }
  };

  L.printPage = function () {
    try { window.print(); } catch (e) { L.toast(t('netError'), false); }
  };
}());
