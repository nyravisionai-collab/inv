/**
 * Customers and suppliers: list, create/edit, ledger, outstanding and the
 * WhatsApp payment reminder. Also exposes `Lite.pickParty`, the modal-style
 * picker every document screen uses.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  function base(kind) { return kind === 'supplier' ? '/api/suppliers' : '/api/customers'; }
  function label(kind) { return kind === 'supplier' ? t('suppliers') : t('customers'); }

  /* ------------------------------- picker ------------------------------ */
  // A full screen rather than an overlay: old browsers handle a page swap far
  // more reliably than a positioned modal over a scrolled document.
  var pickCallback = null;

  L.pickParty = function (kind, cb) {
    pickCallback = cb;
    L.go('partyPick', kind);
  };

  L.screens.partyPick = {
    title: function () { return t('selectParty'); },
    render: function (view, kind) {
      view.innerHTML = '<div class="card">'
        + '<input type="text" id="ppq" autocomplete="off" placeholder="' + esc(t('search')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.partyPickKey(this,\'' + esc(kind) + '\')" />'
        + '</div>'
        + '<button type="button" class="btn grey" onclick="Lite.partyPicked(0)">' + esc(t('walkIn')) + '</button>'
        + '<div id="ppres">' + L.spinner() + '</div>';
      loadPick(kind);
    }
  };

  L.partyPickKey = function (el, kind) {
    S.data.q = el.value;
    L.debounce('ppick', function () { loadPick(kind); });
  };

  function loadPick(kind) {
    L.api('GET', base(kind) + L.qs({ limit: 25, search: L.trim(S.data.q || '') }), null, function (err, data) {
      var box = L.$('ppres');
      if (!box) return;
      if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
      S.data.rows = data || [];
      if (!S.data.rows.length) {
        box.innerHTML = L.emptyCard(t('noData'))
          + '<button type="button" class="btn" onclick="Lite.go(\'partyForm\',\'' + esc(kind) + '\')">'
          + esc(t('add')) + '</button>';
        return;
      }
      var h = '';
      for (var i = 0; i < S.data.rows.length; i++) {
        var p = S.data.rows[i];
        h += '<div class="row" onclick="Lite.partyPicked(' + Number(p.id) + ')">'
          + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
          + '<div class="muted">' + esc(p.phone || '') + '</div></div>'
          + '<div class="rowr">' + (L.num(p.current_balance)
            ? '<span class="chip ' + (L.num(p.current_balance) > 0 ? 'red' : 'green') + '">'
              + esc(L.money(Math.abs(p.current_balance))) + '</span>' : '') + '</div></div>';
      }
      h += '<button type="button" class="btn grey" onclick="Lite.go(\'partyForm\',\'' + esc(kind) + '\')">+ '
        + esc(t('add')) + '</button>';
      box.innerHTML = h;
    });
  }

  L.partyPicked = function (id) {
    var party = id ? L.findBy(S.data.rows || [], 'id', id) : null;
    var cb = pickCallback;
    pickCallback = null;
    L.back();
    if (cb) cb(party);
  };

  /* -------------------------------- list ------------------------------- */
  L.screens.parties = {
    title: function (kind) { return label(kind); },
    render: function (view, kind) {
      kind = kind || 'customer';
      view.innerHTML = '<div class="card">'
        + '<input type="text" id="plq" autocomplete="off" placeholder="' + esc(t('search')) + '"'
        + ' value="' + esc(S.data.q || '') + '" onkeyup="Lite.partyListKey(this,\'' + esc(kind) + '\')" /></div>'
        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn" onclick="Lite.go(\'partyForm\',\'' + esc(kind) + '\')">+ '
        + esc(t('add')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.partyOutstanding(\'' + esc(kind) + '\')">'
        + esc(t('outstanding')) + '</button></div>'
        + '</div>'
        + '<div id="plres">' + L.spinner() + '</div>';
      loadList(kind);
    }
  };

  L.partyListKey = function (el, kind) {
    S.data.q = el.value;
    L.debounce('plist', function () { loadList(kind); });
  };

  function loadList(kind) {
    L.api('GET', base(kind) + L.qs({ limit: 30, search: L.trim(S.data.q || '') }), null, function (err, data) {
      var box = L.$('plres');
      if (!box) return;
      if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
      var rows = data || [];
      if (!rows.length) { box.innerHTML = L.emptyCard(t('noData')); return; }
      var h = '';
      for (var i = 0; i < rows.length; i++) {
        var p = rows[i];
        var bal = L.num(p.current_balance);
        h += '<div class="row" onclick="Lite.go(\'partyDetail\',\'' + esc(kind) + '\',' + Number(p.id) + ')">'
          + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
          + '<div class="muted">' + esc(p.phone || '') + (p.city ? ' · ' + esc(p.city) : '') + '</div></div>'
          + '<div class="rowr">' + (bal
            ? '<span class="chip ' + (bal > 0 ? 'red' : 'green') + '">' + esc(L.money(Math.abs(bal))) + '</span>'
            : '<span class="muted">—</span>') + '</div></div>';
      }
      box.innerHTML = h;
    });
  }

  L.partyOutstanding = function (kind) { L.go('partyOutstanding', kind); };

  L.screens.partyOutstanding = {
    title: function () { return t('outstanding'); },
    render: function (view, kind) {
      view.innerHTML = L.spinner();
      L.api('GET', base(kind) + '/outstanding', null, function (err, data) {
        if (S.route.name !== 'partyOutstanding') return;
        if (err) { view.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        var rows = data || [];
        if (!rows.length) { view.innerHTML = L.emptyCard(t('noData')); return; }
        var total = 0, h = '';
        for (var i = 0; i < rows.length; i++) {
          var p = rows[i];
          total = L.round2(total + L.num(p.outstanding));
          var pending = p.pending_invoices || p.pending_bills || [];
          h += '<div class="card">'
            + '<div class="rowl"><div class="bigname">' + esc(p.name) + '</div>'
            + '<div class="muted">' + esc(p.phone || '') + '</div></div>'
            + '<div class="rowr"><b class="red">' + esc(L.money(p.outstanding)) + '</b></div>';
          for (var j = 0; j < pending.length; j++) {
            var inv = pending[j];
            h += '<div class="muted">' + esc(inv.invoice_number || inv.bill_number) + ' · '
              + esc(L.dstr(inv.invoice_date || inv.bill_date)) + ' · ' + esc(L.money(inv.balance_amount)) + '</div>';
          }
          h += '<div class="btnrow">'
            + '<div class="btnhalf"><button type="button" class="btn grey small" onclick="Lite.partyRemind(\''
            + esc(kind) + '\',' + Number(p.id) + ')">' + esc(t('remind')) + '</button></div>'
            + '<div class="btnhalf"><button type="button" class="btn small" onclick="Lite.go(\'paymentForm\',\''
            + (kind === 'supplier' ? 'payment_out' : 'payment_in') + '\',' + Number(p.id) + ')">'
            + esc(t('recordPayment')) + '</button></div></div>'
            + '</div>';
        }
        view.innerHTML = '<div class="card">' + L.kv(t('total'), L.money(total), 'red') + '</div>' + h;
      });
    }
  };

  /* ------------------------------- detail ------------------------------ */
  L.screens.partyDetail = {
    title: function (kind) { return kind === 'supplier' ? t('supplier') : t('customer'); },
    render: function (view, kind, id) {
      if (S.data.party === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', base(kind) + '/' + Number(id), null, function (err, data) {
          if (S.route.name !== 'partyDetail') return;
          if (err) { view.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
          S.data.party = data;
          L.screens.partyDetail.render(view, kind, id);
        });
        return;
      }
      var p = S.data.party;
      var bal = L.num(p.current_balance);
      var h = '<div class="card">'
        + '<div class="cardh">' + esc(p.name) + '</div>'
        + (p.phone ? L.kv(t('phone'), p.phone) : '')
        + (p.email ? L.kv(t('email'), p.email) : '')
        + (p.address ? L.kv(t('address'), p.address) : '')
        + (p.city || p.state ? L.kv(t('city'), [p.city, p.state, p.pincode].join(' ')) : '')
        + (p.gstin ? L.kv(t('gstin'), p.gstin) : '')
        + (p.credit_limit ? L.kv(t('creditLimit'), L.money(p.credit_limit)) : '')
        + L.kv(t('outstanding'), L.money(Math.abs(bal)), bal > 0 ? 'red' : 'green')
        + '</div>'

        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn" onclick="Lite.go(\'partyLedger\',\''
        + esc(kind) + '\',' + Number(id) + ')">' + esc(t('ledger')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.go(\'partyForm\',\''
        + esc(kind) + '\',' + Number(id) + ')">' + esc(t('edit')) + '</button></div>'
        + '</div>'
        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn green" onclick="Lite.go(\'paymentForm\',\''
        + (kind === 'supplier' ? 'payment_out' : 'payment_in') + '\',' + Number(id) + ')">'
        + esc(t('recordPayment')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey" onclick="Lite.partyRemind(\''
        + esc(kind) + '\',' + Number(id) + ')">' + esc(t('remind')) + '</button></div>'
        + '</div>'
        + '<button type="button" class="btn red" onclick="Lite.partyDelete(\'' + esc(kind) + '\',' + Number(id) + ')">'
        + esc(t('del')) + '</button>';
      view.innerHTML = h;
    }
  };

  L.partyRemind = function (kind, id) {
    L.api('POST', base(kind) + '/' + Number(id) + '/remind', {}, function (err, data) {
      if (err) { L.showErr(err); return; }
      L.toast(t('reminderReady'), true);
      // wa.me opens in the phone's browser/WhatsApp; old handsets simply show
      // the link, which is still better than nothing.
      if (data && data.link) {
        try { window.open(data.link, '_blank'); } catch (e) { window.location.href = data.link; }
      }
    });
  };

  L.partyDelete = function (kind, id) {
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', base(kind) + '/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      L.back();
    });
  };

  /* ------------------------------- ledger ------------------------------ */
  L.screens.partyLedger = {
    title: function () { return t('ledger'); },
    render: function (view, kind, id) {
      var from = S.data.from || '';
      var to = S.data.to || '';
      var head = '<div class="card">'
        + L.dateRangeFields('lgf', 'lgt', from, to)
        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn small" onclick="Lite.ledgerApply()">'
        + esc(t('apply')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey small" onclick="Lite.ledgerPdf(\''
        + esc(kind) + '\',' + Number(id) + ')">' + esc(t('savePdf')) + '</button></div>'
        + '</div></div>';

      if (S.data.ledger === undefined) {
        view.innerHTML = head + L.spinner();
        L.api('GET', base(kind) + '/' + Number(id) + '/ledger' + L.qs({ from_date: from, to_date: to }),
          null, function (err, data) {
            if (S.route.name !== 'partyLedger') return;
            S.data.ledger = err ? null : data;
            S.data.ledgerErr = err;
            L.screens.partyLedger.render(view, kind, id);
          });
        return;
      }
      if (!S.data.ledger) { view.innerHTML = head + L.errorCard(S.data.ledgerErr, 'Lite.reload()'); return; }

      var d = S.data.ledger;
      var h = head + '<div class="card">'
        + L.kv(t('openingBal'), L.money(d.opening_balance))
        + L.kv(t('closingBal'), L.money(d.closing_balance), L.num(d.closing_balance) > 0 ? 'red' : 'green')
        + '</div>';

      var entries = d.entries || [];
      if (!entries.length) { view.innerHTML = h + L.emptyCard(t('noData')); return; }

      h += '<div class="card tblwrap"><table class="tbl">'
        + '<tr><th>' + esc(t('date')) + '</th><th>' + esc(t('particular')) + '</th>'
        + '<th class="n">' + esc(t('debit')) + '</th><th class="n">' + esc(t('creditC')) + '</th>'
        + '<th class="n">' + esc(t('balance')) + '</th></tr>';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        h += '<tr><td>' + esc(L.dstr(e.d)) + '</td>'
          + '<td>' + esc(e.ref) + '<div class="muted">' + esc(e.type) + '</div></td>'
          + '<td class="n">' + (L.num(e.debit) ? esc(L.fmt(e.debit)) : '') + '</td>'
          + '<td class="n">' + (L.num(e.credit) ? esc(L.fmt(e.credit)) : '') + '</td>'
          + '<td class="n">' + esc(L.fmt(e.balance)) + '</td></tr>';
      }
      h += '</table></div>';
      view.innerHTML = h;
    }
  };

  L.ledgerApply = function () {
    S.data = { from: L.val('lgf'), to: L.val('lgt') };
    L.render();
  };

  L.ledgerPdf = function (kind, id) {
    L.api('POST', base(kind) + '/' + Number(id) + '/ledger/pdf'
      + L.qs({ from_date: L.val('lgf'), to_date: L.val('lgt') }), {}, function (err, data) {
      if (err) { L.showErr(err); return; }
      L.toast(t('pdfSaved') + ': ' + ((data && data.fileName) || ''), true);
    });
  };

  /* -------------------------------- form ------------------------------- */
  L.screens.partyForm = {
    title: function (kind, id) {
      return (id ? t('edit') : t('add')) + ' — ' + (kind === 'supplier' ? t('supplier') : t('customer'));
    },
    render: function (view, kind, id) {
      if (id && S.data.party === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', base(kind) + '/' + Number(id), null, function (err, data) {
          if (S.route.name !== 'partyForm') return;
          S.data.party = err ? null : data;
          L.screens.partyForm.render(view, kind, id);
        });
        return;
      }
      var p = S.data.party || {};
      var f = function (fid, lbl, value, type) {
        return '<label class="fld" for="' + fid + '">' + esc(lbl) + '</label>'
          + '<input type="' + (type || 'text') + '" id="' + fid + '" value="' + esc(value === undefined || value === null ? '' : value) + '" />';
      };

      view.innerHTML = '<div class="card">'
        + f('pf_name', t('name') + ' *', p.name)
        + f('pf_phone', t('phone'), p.phone, 'tel')
        + f('pf_email', t('email'), p.email, 'email')
        + f('pf_address', t('address'), p.address)
        + '<div class="fldrow"><div class="fldhalf">' + f('pf_city', t('city'), p.city) + '</div>'
        + '<div class="fldhalf">' + f('pf_state', t('state'), p.state) + '</div></div>'
        + '<div class="fldrow"><div class="fldhalf">' + f('pf_pin', t('pincode'), p.pincode) + '</div>'
        + '<div class="fldhalf">' + f('pf_gstin', t('gstin'), p.gstin) + '</div></div>'
        + f('pf_pan', t('pan'), p.pan)
        + f('pf_climit', t('creditLimit'), p.credit_limit, 'number')
        + (id ? '' : f('pf_open', t('openingBalance'), p.opening_balance, 'number'))
        + (id ? '' : '<label class="fld" for="pf_btype">' + esc(t('balanceType')) + '</label>'
          + '<select id="pf_btype"><option value="debit">' + esc(t('debit')) + '</option>'
          + '<option value="credit">' + esc(t('creditC')) + '</option></select>')
        + '<label class="fld" for="pf_notes">' + esc(t('notes')) + '</label>'
        + '<textarea id="pf_notes">' + esc(p.notes || '') + '</textarea>'
        + '<button type="button" class="btn green" onclick="Lite.partySave(\'' + esc(kind) + '\','
        + (id ? Number(id) : 0) + ')">' + esc(t('save')) + '</button>'
        + '</div>';
    }
  };

  L.partySave = function (kind, id) {
    if (S.busy) return;
    var name = L.trim(L.val('pf_name'));
    if (!name) { L.toast(t('nameReq'), false); return; }
    var body = {
      name: name,
      phone: L.trim(L.val('pf_phone')) || null,
      email: L.trim(L.val('pf_email')) || null,
      address: L.trim(L.val('pf_address')) || null,
      city: L.trim(L.val('pf_city')) || null,
      state: L.trim(L.val('pf_state')) || null,
      pincode: L.trim(L.val('pf_pin')) || null,
      gstin: L.trim(L.val('pf_gstin')) || null,
      pan: L.trim(L.val('pf_pan')) || null,
      credit_limit: L.num(L.val('pf_climit')),
      notes: L.trim(L.val('pf_notes')) || null
    };
    if (!id) {
      body.opening_balance = L.num(L.val('pf_open'));
      body.balance_type = L.val('pf_btype') || 'debit';
    }
    S.busy = true;
    L.api(id ? 'PUT' : 'POST', base(kind) + (id ? '/' + Number(id) : ''), body, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(id ? t('updatedOk') : t('createdOk'), true);
      L.back();
    });
  };
}());
