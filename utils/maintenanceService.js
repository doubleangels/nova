/**
 * Server-side helpers for dashboard Maintenance (SQLite, Keyv, reports).
 */

const fs = require('fs');
const path = require('path');

function getSqlitePath() {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'database.sqlite');
}

/**
 * @returns {{ filePath: string, fileBytes: number, totalRows: number, byNamespace: Array<{ns: string, rowCount: number, valueBytes: number}>, largestKeys: Array<{key: string, bytes: number}> }}
 */
function getStorageReport() {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    return {
      filePath: sqlitePath,
      fileBytes: 0,
      totalRows: 0,
      byNamespace: [],
      largestKeys: [],
      error: 'Database file not found.'
    };
  }
  const stat = fs.statSync(sqlitePath);
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const totals = db
      .prepare(
        `SELECT
          CASE WHEN instr(key, ':') > 0 THEN substr(key, 1, instr(key, ':') - 1) ELSE 'main' END AS ns,
          COUNT(*) AS rowCount,
          SUM(length(value)) AS valueBytes
        FROM keyv
        GROUP BY ns
        ORDER BY valueBytes DESC`
      )
      .all();
    const topKeys = db
      .prepare(
        `SELECT key, length(value) AS bytes FROM keyv ORDER BY bytes DESC LIMIT 15`
      )
      .all();
    const totalRows = db.prepare('SELECT COUNT(*) AS c FROM keyv').get().c;
    return {
      filePath: sqlitePath,
      fileBytes: stat.size,
      totalRows,
      byNamespace: totals.map((r) => ({
        ns: r.ns,
        rowCount: r.rowCount,
        valueBytes: Number(r.valueBytes || 0)
      })),
      largestKeys: topKeys.map((r) => ({ key: r.key, bytes: r.bytes }))
    };
  } finally {
    db.close();
  }
}

/**
 * @param {'analyze' | 'vacuum' | 'optimize'} operation
 * @returns {{ ok: boolean, operation: string, message?: string, fileBytesBefore?: number, fileBytesAfter?: number }}
 */
function runSqliteMaintenance(operation) {
  const allowed = new Set(['analyze', 'vacuum', 'optimize']);
  if (!allowed.has(operation)) {
    return { ok: false, error: 'Invalid operation. Use analyze, vacuum, or optimize.' };
  }
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    return { ok: false, error: 'Database file not found.' };
  }
  const before = fs.statSync(sqlitePath).size;
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath);
  try {
    if (operation === 'analyze') {
      db.exec('ANALYZE');
    } else if (operation === 'optimize') {
      db.exec('PRAGMA optimize');
    } else {
      db.exec('VACUUM');
    }
  } catch (err) {
    db.close();
    return {
      ok: false,
      operation,
      error: err && err.message ? String(err.message) : String(err)
    };
  }
  db.close();
  const after = fs.existsSync(sqlitePath) ? fs.statSync(sqlitePath).size : before;
  return {
    ok: true,
    operation,
    fileBytesBefore: before,
    fileBytesAfter: after
  };
}

/**
 * @returns {{ ok: boolean, result?: string, error?: string }}
 */
function sqliteIntegrityCheck() {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    return { ok: false, error: 'Database file not found.' };
  }
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    const result = row && row.integrity_check != null ? String(row.integrity_check) : '';
    return { ok: result === 'ok', result };
  } finally {
    db.close();
  }
}

/**
 * Delete Keyv rows for sessions:* whose wrapped `expires` is in the past.
 * @param {boolean} dryRun
 * @returns {{ scanned: number, expiredFound: number, deleted: number, dryRun: boolean }}
 */
function cleanupExpiredSessions(dryRun) {
  const sqlitePath = getSqlitePath();
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath);
  const now = Date.now();
  const rows = db.prepare("SELECT key, value FROM keyv WHERE key LIKE 'sessions:%'").all();
  const toDelete = [];
  for (const row of rows) {
    try {
      const p = JSON.parse(row.value);
      const exp = p.expires;
      if (exp != null && typeof exp === 'number' && exp < now) {
        toDelete.push(row.key);
      }
    } catch {
      /* skip malformed */
    }
  }
  let deleted = 0;
  if (!dryRun && toDelete.length > 0) {
    const del = db.prepare('DELETE FROM keyv WHERE key = ?');
    for (const k of toDelete) {
      deleted += del.run(k).changes;
    }
  }
  db.close();
  return {
    dryRun,
    scanned: rows.length,
    expiredFound: toDelete.length,
    deleted: dryRun ? 0 : deleted
  };
}

/**
 * Remove all dashboard session rows (forces re-login for everyone).
 * @returns {{ deleted: number }}
 */
function clearAllSessionRows() {
  const sqlitePath = getSqlitePath();
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath);
  const r = db.prepare("DELETE FROM keyv WHERE key LIKE 'sessions:%'").run();
  db.close();
  return { deleted: r.changes };
}

/**
 * Quick read/write probe on SQLite (separate short connection).
 * @returns {{ readable: boolean, writable: boolean }}
 */
function sqliteRwProbe() {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    return { readable: false, writable: false };
  }
  const Database = require('better-sqlite3');
  try {
    const db = new Database(sqlitePath, { readonly: true });
    db.prepare('SELECT 1').get();
    db.close();
  } catch {
    return { readable: false, writable: false };
  }
  try {
    const dbw = new Database(sqlitePath);
    dbw.prepare('SELECT 1').get();
    dbw.close();
    return { readable: true, writable: true };
  } catch {
    return { readable: true, writable: false };
  }
}

module.exports = {
  getSqlitePath,
  getStorageReport,
  runSqliteMaintenance,
  sqliteIntegrityCheck,
  cleanupExpiredSessions,
  clearAllSessionRows,
  sqliteRwProbe
};
