/**
 * System screens: company settings, tax rates, users, audit log, and
 * backup / restore / data export.
 */
(function () {
  'use strict';

  var L = window.Lite;
  var t = L.t;
  var esc = L.esc;
  var S = L.S;

  /* ============================== SETTINGS ============================== */
  L.screens.settings = {
    title: function () { return t('settings'); },
    render: function (view) {
      if (S.data.cfg === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/settings', null, function (err, data) {
          if (S.route.name !== 'settings') return;
          S.data.cfg = err ? null : data;
          S.data.err = err;
          L.screens.settings.render(view);
        });
        return;
      }
      if (!S.data.cfg) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var c = S.data.cfg;
      var f = function (id, label, value, type) {
        return '<label class="fld" for="' + id + '">' + esc(label) + '</label>'
          + '<input type="' + (type || 'text') + '" id="' + id + '" value="'
          + esc(value === null || value === undefined ? '' : value) + '" />';
      };

      view.innerHTML = '<div class="card">' + L.sectionTitle(t('company'))
        + f('st_name', t('companyName'), c.company_name)
        + f('st_legal', t('legalName'), c.legal_name)
        + f('st_phone', t('phone'), c.phone, 'tel')
        + f('st_email', t('email'), c.email, 'email')
        + f('st_address', t('address'), c.address)
        + '<div class="fldrow"><div class="fldhalf">' + f('st_city', t('city'), c.city) + '</div>'
        + '<div class="fldhalf">' + f('st_state', t('state'), c.state) + '</div></div>'
        + '<div class="fldrow"><div class="fldhalf">' + f('st_pin', t('pincode'), c.pincode) + '</div>'
        + '<div class="fldhalf">' + f('st_gstin', t('gstin'), c.gstin) + '</div></div>'
        + f('st_pan', t('pan'), c.pan)
        + f('st_web', t('website'), c.website)
        + '</div>'

        + '<div class="card">' + L.sectionTitle(t('invoicePrefix'))
        + '<div class="fldrow"><div class="fldhalf">' + f('st_iprefix', t('invoicePrefix'), c.invoice_prefix) + '</div>'
        + '<div class="fldhalf">' + f('st_pprefix', t('purchasePrefix'), c.purchase_prefix) + '</div></div>'
        + '<div class="fldrow"><div class="fldhalf">' + f('st_cursym', t('currencySym'), c.currency_symbol) + '</div>'
        + '<div class="fldhalf">' + f('st_tax', t('defaultTax'), c.default_tax_rate, 'number') + '</div></div>'
        + '<label class="fld" for="st_terms">' + esc(t('invoiceTerms')) + '</label>'
        + '<textarea id="st_terms">' + esc(c.invoice_terms || '') + '</textarea>'
        + '<label class="fld" for="st_notes">' + esc(t('invoiceNotes')) + '</label>'
        + '<textarea id="st_notes">' + esc(c.invoice_notes || '') + '</textarea>'
        + '<button type="button" class="btn green" onclick="Lite.settingsSave()">' + esc(t('save')) + '</button>'
        + '</div>'

        + '<button type="button" class="btn grey" onclick="Lite.go(\'taxRates\')">' + esc(t('taxRates')) + '</button>'
        + '<button type="button" class="btn grey" onclick="Lite.go(\'backups\')">' + esc(t('backups')) + '</button>';
    }
  };

  L.settingsSave = function () {
    if (S.busy) return;
    S.busy = true;
    L.api('PUT', '/api/settings', {
      company_name: L.trim(L.val('st_name')),
      legal_name: L.trim(L.val('st_legal')),
      phone: L.trim(L.val('st_phone')),
      email: L.trim(L.val('st_email')),
      address: L.trim(L.val('st_address')),
      city: L.trim(L.val('st_city')),
      state: L.trim(L.val('st_state')),
      pincode: L.trim(L.val('st_pin')),
      gstin: L.trim(L.val('st_gstin')),
      pan: L.trim(L.val('st_pan')),
      website: L.trim(L.val('st_web')),
      invoice_prefix: L.trim(L.val('st_iprefix')),
      purchase_prefix: L.trim(L.val('st_pprefix')),
      currency_symbol: L.trim(L.val('st_cursym')) || '₹',
      default_tax_rate: L.num(L.val('st_tax')),
      invoice_terms: L.trim(L.val('st_terms')),
      invoice_notes: L.trim(L.val('st_notes'))
    }, function (err, data) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      S.settings = data;           // currency symbol may have changed
      L.toast(t('updatedOk'), true);
      L.renderChrome();
    });
  };

  /* ============================== TAX RATES ============================= */
  L.screens.taxRates = {
    title: function () { return t('taxRates'); },
    render: function (view) {
      if (S.data.rows === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/tax-rates', null, function (err, data) {
          if (S.route.name !== 'taxRates') return;
          S.data.rows = err ? null : (data || []);
          S.data.err = err;
          L.screens.taxRates.render(view);
        });
        return;
      }
      if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var h = '<div class="card">'
        + '<div class="fldrow">'
        + '<div class="fldhalf"><label class="fld" for="tx_name">' + esc(t('name')) + '</label>'
        + '<input type="text" id="tx_name" /></div>'
        + '<div class="fldhalf"><label class="fld" for="tx_rate">' + esc(t('rate')) + ' %</label>'
        + '<input type="number" id="tx_rate" step="any" min="0" /></div></div>'
        + '<button type="button" class="btn green" onclick="Lite.taxRateAdd()">+ ' + esc(t('add')) + '</button></div>';
      for (var i = 0; i < S.data.rows.length; i++) {
        var r = S.data.rows[i];
        h += '<div class="row"><div class="rowl"><div class="bigname">' + esc(r.name) + '</div>'
          + '<div class="muted">' + esc(L.fmt(r.rate)) + '% · CGST ' + esc(L.fmt(r.cgst))
          + ' · SGST ' + esc(L.fmt(r.sgst)) + '</div></div>'
          + '<div class="rowr"><button type="button" class="btn red small" onclick="Lite.taxRateDel('
          + Number(r.id) + ')">' + esc(t('del')) + '</button></div></div>';
      }
      view.innerHTML = h;
    }
  };

  L.taxRateAdd = function () {
    var name = L.trim(L.val('tx_name'));
    var rate = L.num(L.val('tx_rate'));
    if (!name) { L.toast(t('nameReq'), false); return; }
    L.api('POST', '/api/tax-rates', { name: name, rate: rate }, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk'), true);
      L.reload();
    });
  };

  L.taxRateDel = function (id) {
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', '/api/tax-rates/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      L.reload();
    });
  };

  /* ================================ USERS =============================== */
  L.screens.users = {
    title: function () { return t('users'); },
    render: function (view) {
      if (S.data.rows === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/users' + L.qs({ limit: 50 }), null, function (err, data) {
          if (S.route.name !== 'users') return;
          S.data.rows = err ? null : (data || []);
          S.data.err = err;
          L.screens.users.render(view);
        });
        return;
      }
      if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var h = '<button type="button" class="btn" onclick="Lite.go(\'userForm\')">+ ' + esc(t('add')) + '</button>';
      for (var i = 0; i < S.data.rows.length; i++) {
        var u = S.data.rows[i];
        h += '<div class="row"><div class="rowl"><div class="bigname">' + esc(u.full_name) + '</div>'
          + '<div class="muted">' + esc(u.username) + ' · ' + esc(roleLabel(u.role)) + '</div></div>'
          + '<div class="rowr"><span class="chip ' + (u.is_active ? 'green' : 'grey') + '">'
          + esc(u.is_active ? t('active') : t('inactive')) + '</span>'
          + '<div><button type="button" class="btn red small mt" onclick="Lite.userDel(' + Number(u.id) + ')">'
          + esc(t('del')) + '</button></div></div></div>';
      }
      view.innerHTML = h;
    }
  };

  function roleLabel(role) {
    var map = { admin: t('rAdmin'), manager: t('rManager'), staff: t('rStaff'), cashier: t('rCashier') };
    return map[role] || role;
  }

  L.screens.userForm = {
    title: function () { return t('users'); },
    render: function (view) {
      view.innerHTML = '<div class="card">'
        + '<label class="fld" for="us_name">' + esc(t('fullName')) + ' *</label>'
        + '<input type="text" id="us_name" />'
        + '<label class="fld" for="us_user">' + esc(t('username')) + ' *</label>'
        + '<input type="text" id="us_user" autocomplete="off" />'
        + '<label class="fld" for="us_email">' + esc(t('email')) + ' *</label>'
        + '<input type="email" id="us_email" autocomplete="off" />'
        + '<label class="fld" for="us_pass">' + esc(t('password')) + ' *</label>'
        + '<input type="password" id="us_pass" autocomplete="off" />'
        + '<label class="fld" for="us_phone">' + esc(t('phone')) + '</label>'
        + '<input type="tel" id="us_phone" />'
        + '<label class="fld" for="us_role">' + esc(t('role')) + '</label>'
        + '<select id="us_role">'
        + '<option value="staff">' + esc(t('rStaff')) + '</option>'
        + '<option value="cashier">' + esc(t('rCashier')) + '</option>'
        + '<option value="manager">' + esc(t('rManager')) + '</option>'
        + '<option value="admin">' + esc(t('rAdmin')) + '</option>'
        + '</select>'
        + '<button type="button" class="btn green" onclick="Lite.userSave()">' + esc(t('save')) + '</button></div>';
    }
  };

  L.userSave = function () {
    if (S.busy) return;
    var body = {
      full_name: L.trim(L.val('us_name')),
      username: L.trim(L.val('us_user')),
      email: L.trim(L.val('us_email')),
      password: L.val('us_pass'),
      phone: L.trim(L.val('us_phone')) || null,
      role: L.val('us_role') || 'staff'
    };
    if (!body.full_name || !body.username || !body.email || !body.password) {
      L.toast(t('required'), false);
      return;
    }
    S.busy = true;
    L.api('POST', '/api/users', body, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('createdOk'), true);
      L.back();
    });
  };

  L.userDel = function (id) {
    if (!window.confirm(t('confirmDel'))) return;
    L.api('DELETE', '/api/users/' + Number(id), null, function (err) {
      if (err) { L.showErr(err); return; }
      L.toast(t('deleted'), true);
      L.reload();
    });
  };

  /* ============================= AUDIT LOG ============================== */
  L.screens.auditLogs = {
    title: function () { return t('auditLogs'); },
    render: function (view) {
      view.innerHTML = L.spinner();
      L.api('GET', '/api/audit-logs' + L.qs({ limit: 50 }), null, function (err, data) {
        if (S.route.name !== 'auditLogs') return;
        if (err) { view.innerHTML = L.errorCard(err, 'Lite.reload()'); return; }
        var rows = data || [];
        if (!rows.length) { view.innerHTML = L.emptyCard(t('noData')); return; }
        var h = '';
        for (var i = 0; i < rows.length; i++) {
          var a = rows[i];
          h += '<div class="row"><div class="bigname">' + esc(a.action) + ' · ' + esc(a.entity_type || '') + '</div>'
            + '<div class="muted">' + esc(String(a.created_at || '').slice(0, 16))
            + (a.user_name ? ' · ' + esc(a.user_name) : '') + '</div></div>';
        }
        view.innerHTML = h;
      });
    }
  };

  /* ========================== BACKUP / RESTORE ========================== */
  L.screens.backups = {
    title: function () { return t('backups'); },
    render: function (view) {
      if (S.data.rows === undefined) {
        view.innerHTML = L.spinner();
        L.api('GET', '/api/backups', null, function (err, data) {
          if (S.route.name !== 'backups') return;
          S.data.rows = err ? null : (data || []);
          S.data.err = err;
          L.screens.backups.render(view);
        });
        return;
      }
      if (!S.data.rows) { view.innerHTML = L.errorCard(S.data.err, 'Lite.reload()'); return; }

      var h = '<button type="button" class="btn green" onclick="Lite.backupCreate()">'
        + esc(t('createBackup')) + '</button>'
        + '<div class="card">' + L.sectionTitle(t('exportData'))
        + '<div class="btnrow">'
        + '<div class="btnthird"><a class="btn grey small" href="/api/export?type=products&amp;format=csv">'
        + esc(t('products')) + '</a></div>'
        + '<div class="btnthird"><a class="btn grey small" href="/api/export?type=partys&amp;format=csv">'
        + esc(t('partys')) + '</a></div>'
        + '<div class="btnthird"><a class="btn grey small" href="/api/export?type=sales&amp;format=csv">'
        + esc(t('sales')) + '</a></div>'
        + '</div></div>';

      if (!S.data.rows.length) { view.innerHTML = h + L.emptyCard(t('noData')); return; }
      for (var i = 0; i < S.data.rows.length; i++) {
        var b = S.data.rows[i];
        var isDb = /\.db$/.test(b.name);
        h += '<div class="row"><div class="rowl"><div class="bigname">' + esc(b.name) + '</div>'
          + '<div class="muted">' + esc(String(b.created_at).slice(0, 16).replace('T', ' '))
          + ' · ' + Math.round(b.size / 1024) + ' KB</div></div>'
          + '<div class="rowr">' + (isDb
            ? '<button type="button" class="btn small" onclick="Lite.backupRestore(\'' + L.jsq(b.name) + '\')">'
              + esc(t('restore')) + '</button>'
            : '') + '</div></div>';
      }
      view.innerHTML = h;
    }
  };

  L.backupCreate = function () {
    if (S.busy) return;
    S.busy = true;
    L.toast(t('saving'), 'info');
    L.api('POST', '/api/backup', {}, function (err, data) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('backupOk') + ': ' + ((data && data.db_backup) || ''), true);
      L.reload();
    });
  };

  L.backupRestore = function (filename) {
    if (!window.confirm(t('restoreWarn'))) return;
    S.busy = true;
    L.api('POST', '/api/restore', { filename: filename }, function (err) {
      S.busy = false;
      if (err) { L.showErr(err); return; }
      L.toast(t('restoredOk'), true);
      // Everything cached is now stale.
      S.settings = null; S.units = null; S.categories = null;
      S.brands = null; S.warehouses = null; S.banks = null;
      L.go('home');
    });
  };
}());
