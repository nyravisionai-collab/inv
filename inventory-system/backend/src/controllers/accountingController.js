const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { pageParams } = require('../utils/validate');
const { today, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const partyService = require('../services/partyService');

// Bank Accounts
function listBanks(req, res) {
  try {
    return success(res, db.prepare('SELECT * FROM bank_accounts WHERE is_active = 1 ORDER BY account_type, account_name').all());
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createBank(req, res) {
  try {
    const { account_name, bank_name, account_number, ifsc, branch, account_type, opening_balance, is_default } = req.body;
    if (!account_name) return error(res, 'Account name required');
    if (is_default) db.prepare('UPDATE bank_accounts SET is_default = 0').run();
    const bal = Number(opening_balance) || 0;
    const result = db.prepare(`
      INSERT INTO bank_accounts (account_name, bank_name, account_number, ifsc, branch, account_type, opening_balance, current_balance, is_default)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(account_name, bank_name || null, account_number || null, ifsc || null, branch || null, account_type || 'bank', bal, bal, is_default ? 1 : 0);
    return success(res, db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(result.lastInsertRowid), 'Account created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function updateBank(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    const b = req.body;
    if (b.is_default) db.prepare('UPDATE bank_accounts SET is_default = 0').run();
    db.prepare(`
      UPDATE bank_accounts SET account_name=?, bank_name=?, account_number=?, ifsc=?, branch=?, account_type=?, is_default=?, is_active=?
      WHERE id=?
    `).run(
      b.account_name ?? existing.account_name, b.bank_name !== undefined ? b.bank_name : existing.bank_name,
      b.account_number !== undefined ? b.account_number : existing.account_number,
      b.ifsc !== undefined ? b.ifsc : existing.ifsc, b.branch !== undefined ? b.branch : existing.branch,
      b.account_type || existing.account_type, b.is_default !== undefined ? (b.is_default ? 1 : 0) : existing.is_default,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active, req.params.id
    );
    return success(res, db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id), 'Updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Expenses
function listExpenses(req, res) {
  try {
    const { page = 1, limit = 20, from_date, to_date, category, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) { where += ' AND e.expense_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND e.expense_date <= ?'; params.push(to_date); }
    if (category) { where += ' AND e.category = ?'; params.push(category); }
    if (search) { where += ' AND (e.description LIKE ? ESCAPE \'!\' OR e.expense_number LIKE ? ESCAPE \'!\')'; const s = `%${sanitizeLike(search)}%`; params.push(s, s); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM expenses e ${where}`).get(...params).c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });
    const rows = db.prepare(`
      SELECT e.*, ba.account_name as bank_account_name FROM expenses e
      LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id
      ${where} ORDER BY e.expense_date DESC LIMIT ? OFFSET ?
    `).all(...params, lim, offset);
    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createExpense(req, res) {
  try {
    const { category, expense_date, amount, payment_mode, bank_account_id, description, reference_number } = req.body;
    if (!category || !amount) return error(res, 'Category and amount required');

    const num = numberService.nextExpenseNumber();
    let baId = bank_account_id;
    if (!baId) {
      const cash = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' LIMIT 1").get();
      baId = cash?.id;
    }

    const result = db.prepare(`
      INSERT INTO expenses (expense_number, category, expense_date, amount, payment_mode, bank_account_id, description, reference_number, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(num, category, expense_date || today(), Number(amount), payment_mode || 'cash', baId || null, description || null, reference_number || null, req.user.id);

    if (baId) partyService.updateBankBalance(baId, amount, 'debit');

    return success(res, db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid), 'Expense recorded', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function deleteExpense(req, res) {
  try {
    const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    if (!exp) return error(res, 'Not found', 404);
    if (exp.bank_account_id) partyService.updateBankBalance(exp.bank_account_id, exp.amount, 'credit');
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    return success(res, null, 'Expense deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Incomes
function listIncomes(req, res) {
  try {
    const { page = 1, limit = 20, from_date, to_date, category } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) { where += ' AND i.income_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND i.income_date <= ?'; params.push(to_date); }
    if (category) { where += ' AND i.category = ?'; params.push(category); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM incomes i ${where}`).get(...params).c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });
    const rows = db.prepare(`
      SELECT i.*, ba.account_name as bank_account_name FROM incomes i
      LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id
      ${where} ORDER BY i.income_date DESC LIMIT ? OFFSET ?
    `).all(...params, lim, offset);
    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createIncome(req, res) {
  try {
    const { category, income_date, amount, payment_mode, bank_account_id, description, reference_number } = req.body;
    if (!category || !amount) return error(res, 'Category and amount required');

    const num = numberService.nextIncomeNumber();
    let baId = bank_account_id;
    if (!baId) {
      const cash = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' LIMIT 1").get();
      baId = cash?.id;
    }

    const result = db.prepare(`
      INSERT INTO incomes (income_number, category, income_date, amount, payment_mode, bank_account_id, description, reference_number, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(num, category, income_date || today(), Number(amount), payment_mode || 'cash', baId || null, description || null, reference_number || null, req.user.id);

    if (baId) partyService.updateBankBalance(baId, amount, 'credit');

    return success(res, db.prepare('SELECT * FROM incomes WHERE id = ?').get(result.lastInsertRowid), 'Income recorded', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Journal Entries
function listJournals(req, res) {
  try {
    const rows = db.prepare(`
      SELECT j.*, u.full_name as created_by_name FROM journal_entries j
      LEFT JOIN users u ON u.id = j.created_by
      ORDER BY j.entry_date DESC
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getJournal(req, res) {
  try {
    const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
    if (!j) return error(res, 'Not found', 404);
    j.lines = db.prepare('SELECT * FROM journal_entry_lines WHERE journal_id = ?').all(j.id);
    return success(res, j);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createJournal(req, res) {
  try {
    const { entry_date, entry_type = 'journal', narration, lines = [] } = req.body;
    if (lines.length < 2) return error(res, 'At least 2 lines required');

    const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) return error(res, 'Debit and Credit must be equal');

    const num = numberService.nextJournalNumber();
    const result = db.prepare(`
      INSERT INTO journal_entries (entry_number, entry_date, entry_type, narration, total_debit, total_credit, created_by)
      VALUES (?,?,?,?,?,?,?)
    `).run(num, entry_date || today(), entry_type, narration || null, totalDebit, totalCredit, req.user.id);

    const jid = result.lastInsertRowid;
    const insert = db.prepare('INSERT INTO journal_entry_lines (journal_id, account_name, bank_account_id, debit, credit, description) VALUES (?,?,?,?,?,?)');
    for (const line of lines) {
      insert.run(jid, line.account_name, line.bank_account_id || null, Number(line.debit) || 0, Number(line.credit) || 0, line.description || null);
      if (line.bank_account_id) {
        if (line.debit) partyService.updateBankBalance(line.bank_account_id, line.debit, 'debit');
        if (line.credit) partyService.updateBankBalance(line.bank_account_id, line.credit, 'credit');
      }
    }

    const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(jid);
    j.lines = db.prepare('SELECT * FROM journal_entry_lines WHERE journal_id = ?').all(jid);
    return success(res, j, 'Journal entry created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Cash Book
function cashBook(req, res) {
  try {
    const { from_date, to_date, bank_account_id } = req.query;
    const from = from_date || today().slice(0, 8) + '01';
    const to = to_date || today();

    let baFilter = '';
    const params = [from, to];
    if (bank_account_id) { baFilter = ' AND bank_account_id = ?'; params.push(bank_account_id); }

    const payments = db.prepare(`
      SELECT payment_date as date, payment_number as ref,
        CASE payment_type WHEN 'payment_in' THEN 'Receipt' ELSE 'Payment' END as type,
        COALESCE(notes, payment_mode) as particular,
        CASE WHEN payment_type = 'payment_in' THEN amount ELSE 0 END as debit,
        CASE WHEN payment_type = 'payment_out' THEN amount ELSE 0 END as credit,
        bank_account_id
      FROM payments WHERE payment_date BETWEEN ? AND ? ${baFilter}
      ORDER BY payment_date
    `).all(...params);

    const expenses = db.prepare(`
      SELECT expense_date as date, expense_number as ref, 'Expense' as type,
        COALESCE(description, category) as particular, 0 as debit, amount as credit, bank_account_id
      FROM expenses WHERE expense_date BETWEEN ? AND ? ${bank_account_id ? 'AND bank_account_id = ?' : ''}
      ORDER BY expense_date
    `).all(...params);

    const incomes = db.prepare(`
      SELECT income_date as date, income_number as ref, 'Income' as type,
        COALESCE(description, category) as particular, amount as debit, 0 as credit, bank_account_id
      FROM incomes WHERE income_date BETWEEN ? AND ? ${bank_account_id ? 'AND bank_account_id = ?' : ''}
      ORDER BY income_date
    `).all(...params);

    const all = [...payments, ...expenses, ...incomes].sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    if (bank_account_id) {
      const acc = db.prepare('SELECT opening_balance FROM bank_accounts WHERE id = ?').get(bank_account_id);
      const priorPayments = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN payment_type = 'payment_in' THEN amount ELSE 0 END), 0) as debit,
          COALESCE(SUM(CASE WHEN payment_type = 'payment_out' THEN amount ELSE 0 END), 0) as credit
        FROM payments WHERE bank_account_id = ? AND payment_date < ?
      `).get(bank_account_id, from);
      const priorExpenses = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE bank_account_id = ? AND expense_date < ?').get(bank_account_id, from);
      const priorIncomes = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM incomes WHERE bank_account_id = ? AND income_date < ?').get(bank_account_id, from);
      balance = (acc?.opening_balance || 0)
        + Number(priorPayments.debit) - Number(priorPayments.credit)
        + Number(priorIncomes.total) - Number(priorExpenses.total);
    }

    const entries = all.map((e) => {
      balance += (e.debit || 0) - (e.credit || 0);
      balance = Math.round(balance * 100) / 100;
      return { ...e, balance };
    });

    return success(res, { from, to, entries, closing_balance: Math.round(balance * 100) / 100 });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = {
  listBanks, createBank, updateBank,
  listExpenses, createExpense, deleteExpense,
  listIncomes, createIncome,
  listJournals, getJournal, createJournal,
  cashBook,
};
