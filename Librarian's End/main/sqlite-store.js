'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const TABLES = { books: 'books', students: 'students', transactions: 'transactions', finePayments: 'fine_payments', settings: 'settings' };
const KEYS = { books: 'access_no', students: 'adm_no', transactions: 'transaction_id', finePayments: 'payment_id' };
const INDEXED_FIELDS = {
  books: ['access_no', 'status'], students: ['adm_no', 'email'],
  transactions: ['transaction_id', 'book_access_no', 'student_adm_no', 'status'],
  finePayments: ['payment_id', 'transaction_id'], settings: [],
};
const DEFAULT_SETTINGS = { fine_per_day: 2, loan_days: 14 };
const SCHEMA_VERSION = 3;
const clean = row => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Every database row must be an object.');
  const { $loki, meta, ...data } = row;
  return data;
};

class SqliteStore {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.directory = directory;
    this.database = new Database(path.join(directory, 'tomeva.sqlite3'));
    const existingVersion = this.database.pragma('user_version', { simple: true });
    if (existingVersion > SCHEMA_VERSION) {
      this.database.close();
      throw new Error(`Database schema ${existingVersion} is newer than supported schema ${SCHEMA_VERSION}. Open it with a newer Tomeva; do not downgrade this profile.`);
    }
    // SQLite NOCASE only folds ASCII. Use the same Unicode lowercase mapping as
    // imports and circulation, including for legacy references and unique loans.
    this.database.function('tomeva_fold', { deterministic: true }, value => typeof value === 'string' ? value.toLowerCase() : value);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = FULL');
    this.database.pragma('busy_timeout = 5000');
    this.database.pragma('foreign_keys = ON');
    try { this.schemaMigration = require('./schema-migrations').migrateSchema(this.database, directory, [
      { version: 1, up: () => { this.database.exec(`
      CREATE TABLE IF NOT EXISTS books (
        _id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)),
        access_no TEXT GENERATED ALWAYS AS (json_extract(data, '$.access_no')) STORED NOT NULL UNIQUE,
        status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED
      );
      CREATE TABLE IF NOT EXISTS students (
        _id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)),
        adm_no TEXT GENERATED ALWAYS AS (json_extract(data, '$.adm_no')) STORED NOT NULL UNIQUE,
        email TEXT GENERATED ALWAYS AS (json_extract(data, '$.email')) STORED
      );
      CREATE TABLE IF NOT EXISTS transactions (
        _id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)),
        transaction_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.transaction_id')) STORED NOT NULL UNIQUE,
        book_access_no TEXT GENERATED ALWAYS AS (json_extract(data, '$.book_access_no')) STORED,
        student_adm_no TEXT GENERATED ALWAYS AS (json_extract(data, '$.student_adm_no')) STORED,
        status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED
      );
      CREATE TABLE IF NOT EXISTS fine_payments (
        _id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)),
        payment_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.payment_id')) STORED NOT NULL UNIQUE,
        transaction_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.transaction_id')) STORED
      );
      CREATE TABLE IF NOT EXISTS settings (
        _id INTEGER PRIMARY KEY CHECK(_id = 1), data TEXT NOT NULL CHECK(json_valid(data))
      );
      CREATE TABLE IF NOT EXISTS migration_state (
        name TEXT PRIMARY KEY, source_hash TEXT, backup_path TEXT,
        row_counts TEXT NOT NULL, committed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, line TEXT NOT NULL, created_at TEXT NOT NULL,
        exported INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS books_status ON books(status);
      CREATE INDEX IF NOT EXISTS students_email ON students(email);
      CREATE INDEX IF NOT EXISTS transactions_book_status ON transactions(book_access_no, status);
      CREATE INDEX IF NOT EXISTS transactions_student ON transactions(student_adm_no);
      CREATE INDEX IF NOT EXISTS payments_transaction ON fine_payments(transaction_id);
      CREATE UNIQUE INDEX IF NOT EXISTS books_access_nocase ON books(access_no COLLATE NOCASE);
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_active_book ON transactions(book_access_no COLLATE NOCASE) WHERE status = 'Active';
      CREATE UNIQUE INDEX IF NOT EXISTS books_access_fold ON books(tomeva_fold(access_no));
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_active_fold ON transactions(tomeva_fold(book_access_no)) WHERE status = 'Active';
      CREATE INDEX IF NOT EXISTS transactions_book_fold_status ON transactions(tomeva_fold(book_access_no), status);
      CREATE INDEX IF NOT EXISTS transactions_overdue ON transactions(status, json_extract(data, '$.due_date'));
      CREATE INDEX IF NOT EXISTS transactions_student_status ON transactions(student_adm_no, status, json_extract(data, '$.due_date'));
    `); } },
      { version: 2, up: () => { for (const [name, code, title, details] of [['books', 'access_no', 'document', "coalesce(json_extract(data,'$.author'),'') || ' ' || coalesce(json_extract(data,'$.publisher'),'')"], ['students', 'adm_no', 'name', "coalesce(json_extract(data,'$.email'),'') || ' ' || coalesce(json_extract(data,'$.class'),'') || ' ' || coalesce(json_extract(data,'$.roll_no'),'')"]]) {
      const values = prefix => `${prefix}._id, json_extract(${prefix}.data,'$.${code}'), json_extract(${prefix}.data,'$.${title}'), ${details.replaceAll('data', prefix + '.data')}`;
      this.database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${name}_fts USING fts5(code, title, details, tokenize='unicode61');
        CREATE TRIGGER IF NOT EXISTS ${name}_fts_insert AFTER INSERT ON ${name} BEGIN INSERT INTO ${name}_fts(rowid, code, title, details) VALUES (${values('new')}); END;
        CREATE TRIGGER IF NOT EXISTS ${name}_fts_delete AFTER DELETE ON ${name} BEGIN DELETE FROM ${name}_fts WHERE rowid=old._id; END;
        CREATE TRIGGER IF NOT EXISTS ${name}_fts_update AFTER UPDATE OF data ON ${name} BEGIN DELETE FROM ${name}_fts WHERE rowid=old._id; INSERT INTO ${name}_fts(rowid, code, title, details) VALUES (${values('new')}); END;
        INSERT INTO ${name}_fts(rowid,code,title,details) SELECT _id,json_extract(data,'$.${code}'),json_extract(data,'$.${title}'),${details} FROM ${name} WHERE _id NOT IN (SELECT rowid FROM ${name}_fts);
      `);
    } } },
      { version: 3, up: database => database.exec('CREATE INDEX IF NOT EXISTS students_adm_page ON students(adm_no COLLATE NOCASE)') },
    ]); } catch (error) { this.database.close(); throw error; }
    this.collections = Object.fromEntries(Object.keys(TABLES).map(name => [name, this.collection(name)]));
  }

  collection(name) {
    const table = TABLES[name];
    const decode = row => row ? { ...JSON.parse(row.data), $loki: row._id } : null;
    const all = this.database.prepare(`SELECT _id, data FROM ${table} ORDER BY _id`);
    const insert = this.database.prepare(`INSERT INTO ${table}(data) VALUES (?)`);
    const update = this.database.prepare(`UPDATE ${table} SET data = ? WHERE _id = ?`);
    const remove = this.database.prepare(`DELETE FROM ${table} WHERE _id = ?`);
    const count = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`);
    const find = (criteria = {}) => {
      const entries = Object.entries(criteria);
      if (!entries.length) return all.all().map(decode);
      const params = [];
      const where = entries.map(([key, value]) => {
        if (key !== '$loki' && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) throw new Error('Invalid query field.');
        let field = key === '$loki' ? '_id' : INDEXED_FIELDS[name].includes(key) ? key : `json_extract(data, '$.${key}')`;
        const folded = key === 'access_no' || key === 'book_access_no';
        const parameter = item => folded && typeof item === 'string' ? item.toLowerCase() : item;
        if (folded) field = `tomeva_fold(${field})`;
        if (value && typeof value === 'object' && Array.isArray(value.$in)) {
          if (!value.$in.length) return '0';
          params.push(...value.$in.map(parameter)); return `${field} IN (${value.$in.map(() => '?').join(',')})`;
        }
        params.push(value === undefined ? null : parameter(value));
        return `${field} IS ?`;
      }).join(' AND ');
      return this.database.prepare(`SELECT _id, data FROM ${table} WHERE ${where} ORDER BY _id`).all(...params).map(decode);
    };
    return {
      find, findOne: criteria => find(criteria)[0] || null,
      where: predicate => all.all().map(decode).filter(predicate),
      insert: row => {
        const data = clean(row);
        const key = KEYS[name];
        if (key && (typeof data[key] !== 'string' || !data[key].trim())) throw new Error(`${name}: ${key} is required.`);
        if (name === 'settings' && count.get().count) throw new Error('Only one settings row is allowed.');
        const result = insert.run(JSON.stringify(data));
        return { ...data, $loki: Number(result.lastInsertRowid) };
      },
      update: row => {
        if (!update.run(JSON.stringify(clean(row)), row.$loki).changes) throw new Error('Row no longer exists.');
      },
      remove: row => remove.run(row.$loki),
      clear: () => this.database.prepare(`DELETE FROM ${table}`).run(),
      count: () => count.get().count,
    };
  }

  transaction(fn) { return this.database.transaction(fn).immediate(); }
  bookIdentity(value) {
    return this.database.prepare('SELECT access_no FROM books WHERE tomeva_fold(access_no) = ?').get(value.toLowerCase())?.access_no || value;
  }
  pageRows(name, options = {}) {
    if (!['books', 'students', 'transactions', 'finePayments'].includes(name) || !options || typeof options !== 'object') throw new Error('Invalid table view.');
    const page = options.page ?? 0, size = options.pageSize ?? 25, query = options.query ?? '';
    if (!Number.isInteger(page) || page < 0 || page > 100000 || !Number.isInteger(size) || size < 1 || size > 50 || typeof query !== 'string' || query.length > 128) throw new Error('Invalid table page or search.');
    const table = TABLES[name], where = [], args = [];
    if (query && ['books', 'students'].includes(name)) {
      const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 16) || [];
      if (!tokens.length) return { rows: [], total: 0, page: 0, pageSize: size };
      where.push(`_id IN (SELECT rowid FROM ${name}_fts WHERE ${name}_fts MATCH ?)`);
      args.push(tokens.map(token => '"' + token + '"*').join(' AND '));
    }
    if (options.status && options.status !== 'all') {
      const allowed = name === 'books' ? ['Available', 'Issued', 'Damaged', 'Under Repair', 'Lost'] : name === 'transactions' ? ['Active', 'Returned', 'FinePending', 'FinePaid', 'Restored'] : [];
      if (!allowed.includes(options.status)) throw new Error('Invalid row status.');
      where.push('status = ?'); args.push(options.status);
    }
    const filter = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}${filter}`).get(...args).count;
    const actualPage = Math.min(page, Math.max(0, Math.ceil(total / size) - 1));
    const order = name === 'books' ? 'access_no COLLATE NOCASE' : name === 'students' ? 'adm_no COLLATE NOCASE' : '_id DESC';
    const rows = this.database.prepare(`SELECT data FROM ${table}${filter} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, size, actualPage * size).map(row => JSON.parse(row.data));
    if (name === 'students') {
      const counts = this.database.prepare("SELECT COUNT(*) AS active, SUM(CASE WHEN json_extract(data,'$.due_date') < ? THEN 1 ELSE 0 END) AS overdue FROM transactions WHERE student_adm_no = ? AND status='Active'");
      for (const row of rows) row.loanCounts = counts.get(require('./calendar').localDate(), row.adm_no);
    }
    return { rows, total, page: actualPage, pageSize: size };
  }
  overdue(today) { return this.database.prepare("SELECT data FROM transactions WHERE status='Active' AND json_extract(data,'$.due_date') < ? ORDER BY json_extract(data,'$.due_date')").all(today).map(row => JSON.parse(row.data)); }
  fineSummary() {
    return { ...this.database.prepare("SELECT COUNT(*) AS pendingCount, coalesce(SUM(json_extract(data,'$.fine')),0) AS pendingAmount FROM transactions WHERE status='FinePending'").get(), ...this.database.prepare("SELECT COUNT(*) AS collectedCount, coalesce(SUM(json_extract(data,'$.amount')),0) AS collectedAmount FROM fine_payments").get() };
  }
  counts() { return Object.fromEntries(Object.entries(this.collections).map(([name, c]) => [name, c.count()])); }
  migrationState() { return this.database.prepare("SELECT * FROM migration_state WHERE name = 'localStorage-v1'").get(); }

  backupLegacy(raw) {
    const directory = path.join(this.directory, 'migration-backups');
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, `legacy-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    const handle = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(handle, raw, 'utf8'); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    if (fs.readFileSync(filename, 'utf8') !== raw) throw new Error('Legacy backup verification failed.');
    return filename;
  }

  initializeLegacy(raw) {
    if (raw !== null && typeof raw !== 'string') throw new Error('Legacy data must be a JSON string or null.');
    const hash = raw === null ? null : createHash('sha256').update(raw).digest('hex');
    const existing = this.migrationState();
    if (existing) {
      if (raw !== null && existing.source_hash !== hash) {
        const backup = this.backupLegacy(raw);
        throw new Error(`Legacy data differs from the completed migration. It was preserved at ${backup}. SQLite has not been overwritten.`);
      }
      return { ok: true, verified: true, migrated: false, cleanupAllowed: raw !== null, backupPath: existing.backup_path, counts: JSON.parse(existing.row_counts) };
    }
    // Durably back up the exact original bytes before parsing or changing rows.
    const backupPath = raw === null ? null : this.backupLegacy(raw);
    let payload = Object.fromEntries(Object.keys(TABLES).map(name => [name, []]));
    if (raw !== null) {
      const legacy = JSON.parse(raw);
      if (!legacy || !Array.isArray(legacy.collections)) throw new Error('Unrecognized legacy database; the original data and backup were retained.');
      const seen = new Set();
      for (const collection of legacy.collections) {
        if (!collection || !Array.isArray(collection.data)) throw new Error('Invalid legacy collection.');
        if (!Object.hasOwn(TABLES, collection.name)) {
          if (collection.data.length) throw new Error(`Unknown nonempty collection: ${collection.name}`);
          continue;
        }
        if (seen.has(collection.name)) throw new Error(`Duplicate legacy collection: ${collection.name}`);
        seen.add(collection.name);
        payload[collection.name] = collection.data.map(clean);
      }
    }
    const counts = this.transaction(() => {
      if (Object.values(this.counts()).some(n => n !== 0)) throw new Error('SQLite already contains data. Automatic migration will not overwrite it.');
      for (const [name, rows] of Object.entries(payload)) {
        for (const row of rows) this.collections[name].insert(row);
        if (this.collections[name].count() !== rows.length) throw new Error(`Migration row-count mismatch in ${name}.`);
      }
      // Compare row contents as well as counts before the commit marker.
      for (const [name, rows] of Object.entries(payload)) {
        if (JSON.stringify(this.collections[name].find().map(clean)) !== JSON.stringify(rows)) throw new Error(`Migration verification failed for ${name}.`);
      }
      if (!payload.settings.length) this.collections.settings.insert(DEFAULT_SETTINGS);
      const verifiedCounts = this.counts();
      this.database.prepare('INSERT INTO migration_state VALUES (?, ?, ?, ?, ?)')
        .run('localStorage-v1', hash, backupPath, JSON.stringify(verifiedCounts), new Date().toISOString());
      return verifiedCounts;
    });
    return { ok: true, verified: true, migrated: raw !== null, cleanupAllowed: raw !== null, backupPath, counts };
  }

  close() { if (this.database.open) this.database.close(); }
}

module.exports = { SqliteStore, SCHEMA_VERSION };
