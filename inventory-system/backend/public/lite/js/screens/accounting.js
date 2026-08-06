/**
 * Money screens: payments in/out, expenses, income, cash & bank accounts,
 * the cash book and journal entries.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  function payModeSelect(id) {
    return '<select id="' + id + '">'
      + '<option value="cash">' + esc(t('cash')) + '</option>'
      + '<option value="card">' + esc(t('card')) + '</option>'
      + '<option value="upi">' + esc(t('upi')) + '</option>'
      + '<option value="bank">' + esc(t('bank')) + '</option>'
      + '<option value="cheque">' + esc(t('cheque')) + '</option>'
      + '</select>';
  }

  function bankSelect(id) {
    var out = '<select id="' + id + '"><option value="">—</option>';
    var rows = S.banks || [];
    for (var i = 0; i < rows.length; i++) {
      out += '<option value="' + Number(rows[i].id) + '">' + esc(rows[i].account_name) + '</option>';
    }
    return out + '</select>';
  }

  /* ============================== PAYMENTS ============================== */
  L.screens.payments = {
    title: function (kind) { return kind === 'payment_out' ? t('paymentOut') : t('paymentIn'); },
    render: function (view, kind) {
      kind = kind || 'payment_in';
      view.innerHTML = '<button type="button" class="btn" onclick="Lite.go(\'paymentForm\',\'' + esc(kind) + '\')">+ '
        + esc(t('recordPayment')) + '</button>'
        + '<div id="pyres">' + L.spinner() + '</div>';
      L.api('GET', '/api/payments' + L.qs({ type: kind, limit: 30 }), null, function (err, data) {
        var box = L.$('pyres');
        if (!box) return;
        if (err) { box.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        var rows = data || [];
        if (!rows.length) { box.innerHTML = L.emptyCard(t('noData')); return; }
        var h = '';
        for (var i = 0; i < rows.length; i++) {
          var p = rows[i];
          h += '<div class="row"><div class="rowl">'
            + '<div class="bigname">' + esc(p.payment_number) + '</div>'
            + '<div class="muted">' + esc(L.dstr(p.payment_date))
            + (p.party_name ? ' · ' + esc(p.party_name) : '')
            + ' · ' + esc(p.payment_mode || '') + '</div></div>'
            + '<div class="rowr"><b>' + esc(L.money(p.amount)) + '</b>'
            + '<div><button type="button" class="btn red small mt" onclick="Lite.paymentDel(' + Number(p.id) + ')">'
            + esc(t('del')) + '</button></div></div></div>';
        }
        box.innerHTML = h;
      });
    }
  };

  L.paymentDel = function (id) {
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', '/api/payments/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      L.reload();
    });
  };

  L.screens.paymentForm = {
    title: function (kind) { return kind === 'payment_out' ? t('paymentOut') : t('paymentIn'); },
    render: function (view, kind, partyId) {
      kind = kind || 'payment_in';
      if (!S.banks) {
        view.innerHTML = L.spinner();
        L.ensure('banks', '/api/banks', function () {
          if (S.route.name === 'paymentForm') L.screens.paymentForm.render(view, kind, partyId);
        });
        return;
      }
      // A payment opened from a party/bill screen arrives with the party id.
      if (partyId && S.data.party === undefined) {
        var url = (kind === 'payment_out' ? '/api/partys/' : '/api/partys/') + Number(partyId);
        L.api('GET', url, null, function (err, data) {
          S.data.party = err ? null : data;
          if (S.route.name === 'paymentForm') L.screens.paymentForm.render(view, kind, partyId);
        });
        view.innerHTML = L.spinner();
        return;
      }

      var party = S.data.party;
      view.innerHTML = '<div class="card">'
        + '<div id="pmParty">' + (party
          ? '<div class="row"><div class="rowl"><b>' + esc(party.name) + '</b>'
            + '<div class="muted">' + esc(t('outstanding')) + ': ' + esc(L.money(party.current_balance)) + '</div></div>'
            + '<div class="rowr"><button type="button" class="btn grey small" onclick="Lite.paymentPick(\''
            + esc(kind) + '\')">' + esc(t('changeParty')) + '</button></div></div>'
          : '<button type="button" class="btn grey" onclick="Lite.paymentPick(\'' + esc(kind) + '\')">'
            + esc(t('selectParty')) + '</button>') + '</div>'
        + '<label class="fld" for="pm_amount">' + esc(t('amount')) + ' *</label>'
        + '<input type="number" id="pm_amount" step="any" min="0" value="'
        + esc(party && L.num(party.current_balance) > 0 ? L.num(party.current_balance) : '') + '" />'
        + '<label class="fld" for="pm_date">' + esc(t('date')) + '</label>'
        + '<input type="date" id="pm_date" value="' + esc(L.todayStr()) + '" />'
        + '<label class="fld" for="pm_mode">' + esc(t('payMode')) + '</label>'
        + payModeSelect('pm_mode')
        + '<label class="fld" for="pm_bank">' + esc(t('account')) + '</label>'
        + bankSelect('pm_bank')
        + '<label class="fld" for="pm_ref">' + esc(t('reference')) + '</label>'
        + '<input type="text" id="pm_ref" />'
        + '<label class="fld" for="pm_notes">' + esc(t('notes')) + '</label>'
        + '<input type="text" id="pm_notes" />'
        + '<div class="muted">' + esc(t('advanceNote')) + '</div>'
        + '<button type="button" class="btn green" onclick="Lite.paymentSave(\'' + esc(kind) + '\')">'
        + esc(t('save')) + '</button></div>';
    }
  };

  L.paymentPick = function (kind) {
    L.pickParty(kind === 'payment_out' ? 'party' : 'party', function (party) {
      S.data.party = party;
      L.render();
    });
  };

  L.paymentSave = function (kind) {
    if (S.busy) return;
    var amount = L.num(L.val('pm_amount'));
    if (amount <= 0) { L.toast(t('eAmount'), false); return; }
    var body = {
      payment_type: kind,
      amount: amount,
      payment_date: L.val('pm_date') || undefined,
      payment_mode: L.val('pm_mode') || 'cash',
      reference_number: L.trim(L.val('pm_ref')) || undefined,
      notes: L.trim(L.val('pm_notes')) || undefined
    };
    var bank = L.val('pm_bank'); if (bank) body.bank_account_id = L.toInt(bank);
    if (S.data.party) {
      body.party_type = kind === 'payment_out' ? 'party' : 'party';
      body.party_id = S.data.party.id;
    }

    S.busy = true;
    L.api('POST', '/api/payments', body, function (err, data) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      var extra = data && L.num(data.unallocated_amount) > 0
        ? ' · ' + L.money(data.unallocated_amount) + ' ' + t('advanceNote')
        : '';
      L.toast(t('createdOk') + ': ' + (data.payment_number || '') + extra, true);
      L.back();
    });
  };

  /* ========================== EXPENSES / INCOME ========================= */
  function cashflowScreen(key, url, titleKey, catKey, dateField) {
    return {
      title: function () { return t(titleKey); },
      render: function (view) {
        if (!S.banks) {
          view.innerHTML = L.spinner();
          L.ensure('banks', '/api/banks', function () {
            if (S.route.name === key) L.screens[key].render(view);
          });
          return;
        }
        var form = '<div class="card">'
          + '<label class="fld" for="cf_cat">' + esc(t(catKey)) + ' *</label>'
          + '<input type="text" id="cf_cat" />'
          + '<label class="fld" for="cf_amount">' + esc(t('amount')) + ' *</label>'
          + '<input type="number" id="cf_amount" step="any" min="0" />'
          + '<label class="fld" for="cf_date">' + esc(t('date')) + '</label>'
          + '<input type="date" id="cf_date" value="' + esc(L.todayStr()) + '" />'
          + '<label class="fld" for="cf_mode">' + esc(t('payMode')) + '</label>'
          + payModeSelect('cf_mode')
          + '<label class="fld" for="cf_bank">' + esc(t('account')) + '</label>'
          + bankSelect('cf_bank')
          + '<label class="fld" for="cf_desc">' + esc(t('description')) + '</label>'
          + '<input type="text" id="cf_desc" />'
          + '<button type="button" class="btn green" onclick="Lite.cashflowSave(\'' + key + '\',\'' + url + '\',\''
          + dateField + '\')">' + esc(t('save')) + '</button></div>';

        if (S.data.rows === undefined) {
          view.innerHTML = form + L.spinner();
          L.api('GET', url + L.qs({ limit: 30 }), null, function (err, data) {
            if (S.route.name !== key) return;
            S.data.rows = err ? null : (data || []);
            S.data.err = err;
            L.screens[key].render(view);
          });
          return;
        }
        if (!S.data.rows) { view.innerHTML = form + L.errorCard(S.data.err, 'Lite.reload()'); return; }
        if (!S.data.rows.length) { view.innerHTML = form + L.emptyCard(t('noData')); return; }

        var total = 0, h = '';
        for (var i = 0; i < S.data.rows.length; i++) {
          var r = S.data.rows[i];
          total = L.round2(total + L.num(r.amount));
          h += '<div class="row"><div class="rowl">'
            + '<div class="bigname">' + esc(r.category) + '</div>'
            + '<div class="muted">' + esc(L.dstr(r[dateField])) + ' · ' + esc(r.description || '') + '</div></div>'
            + '<div class="rowr"><b>' + esc(L.money(r.amount)) + '</b>'
            + (key === 'expenses'
              ? '<div><button type="button" class="btn red small mt" onclick="Lite.expenseDel(' + Number(r.id) + ')">'
                + esc(t('del')) + '</button></div>'
              : '')
            + '</div></div>';
        }
        view.innerHTML = form + '<div class="card">' + L.kv(t('total'), L.money(total)) + '</div>' + h;
      }
    };
  }

  L.screens.expenses = cashflowScreen('expenses', '/api/expenses', 'expenses', 'expenseCat', 'expense_date');
  L.screens.incomes = cashflowScreen('incomes', '/api/incomes', 'incomes', 'incomeCat', 'income_date');

  L.cashflowSave = function (key, url, dateField) {
    if (S.busy) return;
    var cat = L.trim(L.val('cf_cat'));
    if (!cat) { L.toast(t('required'), false); return; }
    var amount = L.num(L.val('cf_amount'));
    if (amount <= 0) { L.toast(t('eAmount'), false); return; }
    var body = {
      category: cat,
      amount: amount,
      payment_mode: L.val('cf_mode') || 'cash',
      description: L.trim(L.val('cf_desc')) || undefined
    };
    body[dateField] = L.val('cf_date') || undefined;
    var bank = L.val('cf_bank'); if (bank) body.bank_account_id = L.toInt(bank);

    S.busy = true;
    L.api('POST', url, body, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk'), true);
      L.reload();
    });
  };

  L.expenseDel = function (id) {
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', '/api/expenses/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      L.reload();
    });
  };

  /* ============================ CASH & BANK ============================= */
  L.screens.banks = {
    title: function () { return t('banks'); },
    render: function (view) {
      if (S.data.rows === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/banks', null, function (err, data) {
          if (S.route.name !== 'banks') return;
          S.data.rows = err ? null : (data || []);
          S.data.err = err;
          S.banks = S.data.rows;
          L.screens.banks.render(view);
        });
        return;
      }
      if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var total = 0, h = '';
      for (var i = 0; i < S.data.rows.length; i++) {
        var b = S.data.rows[i];
        total = L.round2(total + L.num(b.current_balance));
        h += '<div class="row"><div class="rowl">'
          + '<div class="bigname">' + esc(b.account_name) + '</div>'
          + '<div class="muted">' + esc(b.account_type === 'cash' ? t('cash') : (b.bank_name || t('bank')))
          + (b.account_number ? ' · ' + esc(b.account_number) : '') + '</div></div>'
          + '<div class="rowr"><b>' + esc(L.money(b.current_balance)) + '</b></div></div>';
      }

      var form = '<div class="card">'
        + '<label class="fld" for="bk_name">' + esc(t('accountName')) + ' *</label>'
        + '<input type="text" id="bk_name" />'
        + '<label class="fld" for="bk_type">' + esc(t('accType')) + '</label>'
        + '<select id="bk_type"><option value="bank">' + esc(t('bank')) + '</option>'
        + '<option value="cash">' + esc(t('cash')) + '</option></select>'
        + '<label class="fld" for="bk_bank">' + esc(t('bank')) + '</label>'
        + '<input type="text" id="bk_bank" />'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="bk_no">' + esc(t('accountNo')) + '</label>'
        + '<input type="text" id="bk_no" /></div>'
        + '<div class="fldhalf"><label class="fld" for="bk_ifsc">' + esc(t('ifsc')) + '</label>'
        + '<input type="text" id="bk_ifsc" /></div></div>'
        + '<label class="fld" for="bk_open">' + esc(t('openingBalance')) + '</label>'
        + '<input type="number" id="bk_open" step="any" />'
        + '<button type="button" class="btn green" onclick="Lite.bankSave()">' + esc(t('save')) + '</button></div>';

      view.innerHTML = '<div class="card">' + L.kv(t('total'), L.money(total)) + '</div>'
        + (h || L.emptyCard(t('noData'))) + form;
    }
  };

  L.bankSave = function () {
    var name = L.trim(L.val('bk_name'));
    if (!name) { L.toast(t('nameReq'), false); return; }
    L.api('POST', '/api/banks', {
      account_name: name,
      account_type: L.val('bk_type') || 'bank',
      bank_name: L.trim(L.val('bk_bank')) || null,
      account_number: L.trim(L.val('bk_no')) || null,
      ifsc: L.trim(L.val('bk_ifsc')) || null,
      opening_balance: L.num(L.val('bk_open'))
    }, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk'), true);
      S.banks = null;
      L.reload();
    });
  };

  /* ============================== CASH BOOK ============================= */
  L.screens.cashBook = {
    title: function () { return t('cashBook'); },
    render: function (view) {
      var from = S.data.from || L.firstOfMonth();
      var to = S.data.to || L.todayStr();
      var head = '<div class="card">' + L.dateRangeFields('cbf', 'cbt', from, to)
        + '<div class="btnrow">'
        + '<div class="btnhalf"><button type="button" class="btn small" onclick="Lite.cashBookApply()">'
        + esc(t('apply')) + '</button></div>'
        + '<div class="btnhalf"><button type="button" class="btn grey small" onclick="Lite.cashBookPdf()">'
        + esc(t('savePdf')) + '</button></div></div></div>';

      if (S.data.book === undefined) {
        view.innerHTML = head + L.spinner();
        L.api('GET', '/api/cash-book' + L.qs({ from_date: from, to_date: to }), null, function (err, data) {
          if (S.route.name !== 'cashBook') return;
          S.data.book = err ? null : data;
          S.data.err = err;
          S.data.from = from; S.data.to = to;
          L.screens.cashBook.render(view);
        });
        return;
      }
      if (!S.data.book) { view.innerHTML = head + L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var d = S.data.book;
      var entries = d.entries || [];
      var h = head + '<div class="card">' + L.kv(t('closingBal'), L.money(d.closing_balance)) + '</div>';
      if (!entries.length) { view.innerHTML = h + L.emptyCard(t('noData')); return; }

      h += '<div class="card tblwrap"><table class="tbl">'
        + '<tr><th>' + esc(t('date')) + '</th><th>' + esc(t('particular')) + '</th>'
        + '<th class="n">' + esc(t('debit')) + '</th><th class="n">' + esc(t('creditC')) + '</th>'
        + '<th class="n">' + esc(t('balance')) + '</th></tr>';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        h += '<tr><td>' + esc(L.dstr(e.date)) + '</td>'
          + '<td>' + esc(e.ref) + '<div class="muted">' + esc(e.particular || e.type) + '</div></td>'
          + '<td class="n">' + (L.num(e.debit) ? esc(L.fmt(e.debit)) : '') + '</td>'
          + '<td class="n">' + (L.num(e.credit) ? esc(L.fmt(e.credit)) : '') + '</td>'
          + '<td class="n">' + esc(L.fmt(e.balance)) + '</td></tr>';
      }
      h += '</table></div>';
      view.innerHTML = h;
    }
  };

  L.cashBookApply = function () {
    S.data = { from: L.val('cbf'), to: L.val('cbt') };
    L.render();
  };

  L.cashBookPdf = function () {
    L.api('POST', '/api/cash-book/pdf' + L.qs({ from_date: L.val('cbf'), to_date: L.val('cbt') }), {},
      function (err, data) {
        if (err) { L.showErr(err); return; }
        L.toast(t('pdfSaved') + ': ' + ((data && data.fileName) || ''), true);
      });
  };

  /* ============================== JOURNALS ============================== */
  L.screens.journals = {
    title: function () { return t('journals'); },
    render: function (view) {
      if (S.data.rows === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/journals', null, function (err, data) {
          if (S.route.name !== 'journals') return;
          S.data.rows = err ? null : (data || []);
          S.data.err = err;
          L.screens.journals.render(view);
        });
        return;
      }
      if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var h = '<button type="button" class="btn" onclick="Lite.go(\'journalForm\')">+ ' + esc(t('add')) + '</button>';
      if (!S.data.rows.length) { view.innerHTML = h + L.emptyCard(t('noData')); return; }
      for (var i = 0; i < S.data.rows.length; i++) {
        var j = S.data.rows[i];
        h += '<div class="row"><div class="rowl">'
          + '<div class="bigname">' + esc(j.entry_number) + '</div>'
          + '<div class="muted">' + esc(L.dstr(j.entry_date)) + ' · ' + esc(j.narration || '') + '</div></div>'
          + '<div class="rowr"><b>' + esc(L.money(j.total_debit)) + '</b></div></div>';
      }
      view.innerHTML = h;
    }
  };

  L.screens.journalForm = {
    title: function () { return t('journals'); },
    render: function (view) {
      if (!S.data.lines) S.data.lines = [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }];
      var h = '<div class="card">'
        + '<label class="fld" for="jn_date">' + esc(t('entryDate')) + '</label>'
        + '<input type="date" id="jn_date" value="' + esc(L.todayStr()) + '" />'
        + '<label class="fld" for="jn_narr">' + esc(t('narration')) + '</label>'
        + '<input type="text" id="jn_narr" /></div>'
        + '<div id="jnLines"></div>'
        + '<button type="button" class="btn grey" onclick="Lite.journalAddLine()">+ ' + esc(t('addLine')) + '</button>'
        + '<div id="jnTotal" class="card"></div>'
        + '<button type="button" class="btn green" onclick="Lite.journalSave()">' + esc(t('save')) + '</button>';
      view.innerHTML = h;
      drawJournalLines();
    }
  };

  function drawJournalLines() {
    var box = L.$('jnLines');
    if (!box) return;
    var lines = S.data.lines || [];
    var h = '', debit = 0, credit = 0;
    for (var i = 0; i < lines.length; i++) {
      debit = L.round2(debit + L.num(lines[i].debit));
      credit = L.round2(credit + L.num(lines[i].credit));
      h += '<div class="card">'
        + '<input type="text" placeholder="' + esc(t('accountName')) + '" value="' + esc(lines[i].account)
        + '" onchange="Lite.journalSet(' + i + ',\'account\',this.value)" />'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld">' + esc(t('debit')) + '</label>'
        + '<input type="number" step="any" min="0" value="' + esc(lines[i].debit)
        + '" onchange="Lite.journalSet(' + i + ',\'debit\',this.value)" /></div>'
        + '<div class="fldhalf"><label class="fld">' + esc(t('creditC')) + '</label>'
        + '<input type="number" step="any" min="0" value="' + esc(lines[i].credit)
        + '" onchange="Lite.journalSet(' + i + ',\'credit\',this.value)" /></div></div>'
        + (lines.length > 2
          ? '<button type="button" class="btn red small" onclick="Lite.journalDel(' + i + ')">'
            + esc(t('del')) + '</button>'
          : '')
        + '</div>';
    }
    box.innerHTML = h;

    var tbox = L.$('jnTotal');
    if (tbox) {
      tbox.innerHTML = L.kv(t('debit'), L.money(debit))
        + L.kv(t('creditC'), L.money(credit))
        + (Math.abs(debit - credit) > 0.01
          ? '<div class="red">' + esc(t('unbalanced')) + '</div>' : '');
    }
  }

  L.journalSet = function (i, field, value) {
    if (!S.data.lines[i]) return;
    S.data.lines[i][field] = field === 'account' ? L.trim(value) : Math.max(0, L.num(value));
    drawJournalLines();
  };

  L.journalAddLine = function () {
    S.data.lines.push({ account: '', debit: 0, credit: 0 });
    drawJournalLines();
  };

  L.journalDel = function (i) { S.data.lines.splice(i, 1); drawJournalLines(); };

  L.journalSave = function () {
    if (S.busy) return;
    var lines = [], debit = 0, credit = 0;
    for (var i = 0; i < S.data.lines.length; i++) {
      var l = S.data.lines[i];
      if (!L.trim(l.account)) { L.toast(t('required'), false); return; }
      debit = L.round2(debit + L.num(l.debit));
      credit = L.round2(credit + L.num(l.credit));
      lines.push({ account_name: l.account, debit: L.num(l.debit), credit: L.num(l.credit) });
    }
    if (Math.abs(debit - credit) > 0.01) { L.toast(t('unbalanced'), false); return; }
    if (debit <= 0) { L.toast(t('eAmount'), false); return; }

    S.busy = true;
    L.api('POST', '/api/journals', {
      entry_date: L.val('jn_date') || undefined,
      narration: L.trim(L.val('jn_narr')) || undefined,
      lines: lines
    }, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk'), true);
      L.back();
    });
  };
}());
