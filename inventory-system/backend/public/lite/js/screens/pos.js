/**
 * POS — fast counter billing.
 *
 * Everything the React POS can do: item search (incl. barcode), per-line
 * quantity/price/discount, a party, bill-level discount in ₹ or %, all
 * payment modes, part payment and credit. The grand total is computed with
 * the same rules the server uses so a cash bill settles exactly.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  /** The live cart survives navigation so a half-built bill is never lost. */
  var cart = {
    lines: [],
    party: null,
    discType: 'amount',
    discValue: 0,
    payMode: 'cash',
    payKind: 'full',   // full | credit | part
    partAmount: 0
  };

  L.posCart = cart;

  function totals() {
    return L.documentTotals(cart.lines, cart.discType, cart.discValue, 0, 0, 0);
  }

  function paidAmount(grand) {
    if (cart.payKind === 'credit') return 0;
    if (cart.payKind === 'part') return Math.min(L.round2(cart.partAmount), grand);
    return grand;
  }

  L.screens.pos = {
    title: function () { return t('pos'); },
    render: function (view) {
      var h = '<div class="card">'
        + '<input type="text" id="pq" autocomplete="off" placeholder="' + esc(t('searchPh')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.posKey(this)" />'
        + '<div id="pres"></div></div>'

        + '<div id="posParty"></div>'

        + L.sectionTitle(t('cart'))
        + '<div id="posCart"></div>'

        + '<div class="card">'
        + '<label class="fld" for="pdisc">' + esc(t('discount')) + '</label>'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><input type="number" id="pdisc" step="any" min="0" value="' + esc(cart.discValue) + '"'
        + ' onchange="Lite.posDisc()" /></div>'
        + '<div class="fldhalf"><select id="pdisct" onchange="Lite.posDisc()">'
        + '<option value="amount"' + (cart.discType === 'amount' ? ' selected="selected"' : '') + '>' + esc(t('rupees')) + '</option>'
        + '<option value="percent"' + (cart.discType === 'percent' ? ' selected="selected"' : '') + '>' + esc(t('percent')) + '</option>'
        + '</select></div></div>'

        + '<label class="fld" for="pmode">' + esc(t('payMode')) + '</label>'
        + '<select id="pmode" onchange="Lite.posMode()">'
        + payModeOptions(cart.payMode)
        + '</select>'

        + '<div class="seg">'
        + segBtn('full', t('paidL'), cart.payKind)
        + segBtn('part', t('partialL'), cart.payKind)
        + segBtn('credit', t('credit'), cart.payKind)
        + '</div>'
        + '<div id="posPart"></div>'

        + '<div id="posTotal" class="center"></div>'
        + '<button type="button" id="posSave" class="btn green" onclick="Lite.posSave()"></button>'
        + '<button type="button" class="btn grey" onclick="Lite.posClear()">' + esc(t('clearParty')) + ' / ' + esc(t('cart')) + '</button>'
        + '</div>';

      view.innerHTML = h;
      drawResults();
      drawParty();
      drawCart();
    }
  };

  function payModeOptions(selected) {
    var modes = [
      ['cash', t('cash')], ['card', t('card')], ['upi', t('upi')],
      ['bank', t('bank')], ['cheque', t('cheque')]
    ];
    var out = '';
    for (var i = 0; i < modes.length; i++) {
      out += '<option value="' + modes[i][0] + '"'
        + (selected === modes[i][0] ? ' selected="selected"' : '') + '>'
        + esc(modes[i][1]) + '</option>';
    }
    return out;
  }

  function segBtn(id, label, active) {
    return '<button type="button" class="segb' + (active === id ? ' on' : '')
      + '" onclick="Lite.posKind(\'' + id + '\')">' + esc(label) + '</button>';
  }

  /* ------------------------------- search ------------------------------ */
  L.posKey = function (el) {
    S.data.q = el.value;
    L.debounce('pos', function () {
      var q = L.trim(S.data.q);
      if (!q) { S.data.res = []; drawResults(); return; }
      L.api('GET', '/api/products' + L.qs({ limit: 15, search: q }), null, function (err, data) {
        if (err) { L.showErr(err); return; }
        S.data.res = data || [];
        // A scanned barcode that matches exactly one item goes straight in —
        // that is what a barcode gun on a counter should do.
        if (S.data.res.length === 1 && isExactCode(S.data.res[0], q)) {
          addLine(S.data.res[0]);
          S.data.q = '';
          var box = L.$('pq');
          if (box) box.value = '';
          S.data.res = [];
        }
        drawResults();
      });
    }, 250);
  };

  function isExactCode(p, q) {
    var needle = String(q).toLowerCase();
    return String(p.barcode || '').toLowerCase() === needle
      || String(p.sku || '').toLowerCase() === needle;
  }

  function drawResults() {
    var box = L.$('pres');
    if (!box) return;
    var rows = S.data.res || [];
    if (!rows.length) { box.innerHTML = ''; return; }
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      h += '<div class="row" onclick="Lite.posAdd(' + Number(p.id) + ')">'
        + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
        + '<div class="muted">' + esc(L.money(p.selling_price)) + ' · ' + esc(t('avail')) + ': '
        + esc(L.fmt(p.current_stock)) + ' ' + esc(p.unit_short || '') + '</div></div>'
        + '<div class="rowr"><span class="chip green">+</span></div></div>';
    }
    box.innerHTML = h;
  }

  L.posAdd = function (pid) {
    var p = L.findBy(S.data.res || [], 'id', pid);
    if (p) addLine(p);
    drawCart();
  };

  function addLine(p) {
    for (var i = 0; i < cart.lines.length; i++) {
      if (String(cart.lines[i].pid) === String(p.id)) {
        cart.lines[i].qty = L.round2(cart.lines[i].qty + 1);
        return;
      }
    }
    cart.lines.push({
      pid: Number(p.id),
      name: p.name,
      price: L.num(p.selling_price),
      rate: L.num(p.tax_rate),
      ttype: p.tax_type || 'exclusive',
      unit: p.unit_short || '',
      hsn: p.hsn_code || '',
      qty: 1,
      discType: 'amount',
      discValue: 0
    });
  }

  /* ------------------------------ party ----------------------------- */
  function drawParty() {
    var box = L.$('posParty');
    if (!box) return;
    if (cart.party) {
      box.innerHTML = '<div class="card"><div class="rowl"><b>' + esc(cart.party.name) + '</b>'
        + (cart.party.phone ? '<div class="muted">' + esc(cart.party.phone) + '</div>' : '')
        + '</div><div class="rowr"><button type="button" class="btn grey small"'
        + ' onclick="Lite.posPickParty()">' + esc(t('changeParty')) + '</button></div></div>';
    } else {
      box.innerHTML = '<div class="card"><button type="button" class="btn grey"'
        + ' onclick="Lite.posPickParty()">' + esc(t('walkIn')) + ' — ' + esc(t('selectParty')) + '</button></div>';
    }
  }

  L.posPickParty = function () {
    L.pickParty('party', function (party) {
      cart.party = party;
      L.go('pos', null, null, true);
    });
  };

  /* -------------------------------- cart ------------------------------- */
  function drawCart() {
    var box = L.$('posCart');
    if (!box) return;
    if (!cart.lines.length) {
      box.innerHTML = L.emptyCard(t('emptyCart'));
      drawTotal();
      return;
    }
    var h = '';
    for (var i = 0; i < cart.lines.length; i++) {
      var c = cart.lines[i];
      var lc = L.lineCalc(c.qty, c.price, c.discType, c.discValue, c.rate, c.ttype);
      h += '<div class="row">'
        + '<div class="bigname">' + esc(c.name) + '</div>'
        + '<div class="muted">' + esc(L.money(c.price)) + ' × ' + esc(L.fmt(c.qty)) + ' ' + esc(c.unit || '')
        + (c.rate ? ' · ' + esc(t('gst')) + ' ' + esc(L.fmt(c.rate)) : '')
        + ' = <b>' + esc(L.money(lc.total)) + '</b></div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.posQty(' + i + ',-1)">&minus;</button></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.qty)
        + '" onchange="Lite.posSet(' + i + ',\'qty\',this.value)" /></div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.posQty(' + i + ',1)">+</button></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.price)
        + '" title="' + esc(t('price')) + '" onchange="Lite.posSet(' + i + ',\'price\',this.value)" /></div>'
        + '<div class="qcell"><input type="number" class="qinput" step="any" value="' + esc(c.discValue)
        + '" title="' + esc(t('lineDisc')) + '" onchange="Lite.posSet(' + i + ',\'discValue\',this.value)" /></div>'
        + '<div class="qcell"><button type="button" class="qbtn" onclick="Lite.posDel(' + i + ')">&times;</button></div>'
        + '</div>';
    }
    box.innerHTML = h;
    drawTotal();
  }

  L.posQty = function (i, delta) {
    if (!cart.lines[i]) return;
    var q = L.round2(cart.lines[i].qty + delta);
    cart.lines[i].qty = q > 0 ? q : 1;
    drawCart();
  };

  L.posSet = function (i, field, value) {
    if (!cart.lines[i]) return;
    var v = L.round2(L.num(value));
    if (field === 'qty') cart.lines[i].qty = v > 0 ? v : 1;
    else cart.lines[i][field] = Math.max(0, v);
    drawCart();
  };

  L.posDel = function (i) {
    cart.lines.splice(i, 1);
    drawCart();
  };

  L.posDisc = function () {
    cart.discValue = L.num(L.val('pdisc'));
    cart.discType = L.val('pdisct') || 'amount';
    drawTotal();
  };

  L.posMode = function () { cart.payMode = L.val('pmode') || 'cash'; };

  L.posKind = function (kind) {
    cart.payKind = kind;
    L.go('pos', null, null, true);
  };

  L.posClear = function () {
    cart.lines = [];
    cart.party = null;
    cart.discValue = 0;
    cart.partAmount = 0;
    cart.payKind = 'full';
    L.go('pos', null, null, true);
  };

  function drawTotal() {
    var tot = totals();
    var partBox = L.$('posPart');
    if (partBox) {
      partBox.innerHTML = cart.payKind === 'part'
        ? '<label class="fld" for="ppart">' + esc(t('paidAmount')) + '</label>'
          + '<input type="number" id="ppart" step="any" min="0" value="' + esc(cart.partAmount)
          + '" onchange="Lite.posPart(this.value)" />'
        : '';
    }

    var box = L.$('posTotal');
    if (box) {
      var paid = paidAmount(tot.grandTotal);
      box.innerHTML = '<hr class="sp" />'
        + L.kv(t('subtotal'), L.money(tot.subtotal))
        + (tot.discountAmount ? L.kv(t('discount'), '-' + L.money(tot.discountAmount)) : '')
        + (tot.taxAmount ? L.kv(t('tax'), L.money(tot.taxAmount)) : '')
        + '<div class="kv"><span class="k"><b>' + esc(t('grandTotal')) + '</b></span>'
        + '<span class="v" style="font-size:19px;">' + esc(L.money(tot.grandTotal)) + '</span></div>'
        + (paid < tot.grandTotal
          ? L.kv(t('balance'), L.money(L.round2(tot.grandTotal - paid)), 'red')
          : '')
        + '<hr class="sp" />';
    }

    var btn = L.$('posSave');
    if (btn) {
      btn.innerHTML = esc(t('makeBill') + (cart.lines.length ? ' — ' + L.money(tot.grandTotal) : ''));
      btn.disabled = !cart.lines.length;
    }
  }

  L.posPart = function (v) {
    cart.partAmount = Math.max(0, L.num(v));
    drawTotal();
  };

  /* -------------------------------- save ------------------------------- */
  L.posSave = function () {
    if (S.busy) return;
    if (!cart.lines.length) { L.toast(t('emptyCart'), false); return; }

    var tot = totals();
    var items = [];
    for (var i = 0; i < cart.lines.length; i++) {
      var c = cart.lines[i];
      items.push({
        product_id: c.pid,
        // sale_items.product_name is NOT NULL, so always send the name.
        product_name: c.name,
        hsn_code: c.hsn || undefined,
        quantity: c.qty,
        unit_price: c.price,
        discount_type: c.discType,
        discount_value: c.discValue,
        tax_rate: L.num(c.rate),
        tax_type: c.ttype
      });
    }

    var body = {
      invoice_type: 'pos',
      status: 'completed',
      party_id: cart.party ? cart.party.id : undefined,
      items: items,
      discount_type: cart.discType,
      discount_value: L.round2(cart.discValue),
      payment_mode: cart.payMode,
      paid_amount: paidAmount(tot.grandTotal)
    };

    S.busy = true;
    L.toast(t('saving'), 'info');
    L.api('POST', '/api/sales', body, function (err, data) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('billSaved') + ': ' + (data.invoice_number || '') + ' — ' + L.money(data.grand_total), true);
      cart.lines = [];
      cart.party = null;
      cart.discValue = 0;
      cart.partAmount = 0;
      cart.payKind = 'full';
      S.data.q = '';
      S.data.res = [];
      L.go('saleDetail', data.id);
    });
  };
}());
