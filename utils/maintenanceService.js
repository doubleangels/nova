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
        WHERE key NOT LIKE 'sessions:%'
        GROUP BY ns
        ORDER BY valueBytes DESC`
      )
      .all();
    const topKeys = db
      .prepare(
        `SELECT key, length(value) AS bytes FROM keyv WHERE key NOT LIKE 'sessions:%' ORDER BY bytes DESC LIMIT 15`
      )
      .all();
    const totalRows = db.prepare("SELECT COUNT(*) AS c FROM keyv WHERE key NOT LIKE 'sessions:%'").get().c;
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

/**
 * Builds an internal diagnostics payload for support/troubleshooting exports.
 * Sensitive auth/session data must be filtered by the caller before passing in.
 * @param {object} input
 * @param {object} [input.deepHealth]
 * @param {object} [input.storageReport]
 * @param {object} [input.activeJob]
 * @param {string[]} [input.cacheKeys]
 * @param {object} [input.safeSettings]
 * @param {object} [input.idSettings]
 * @returns {object}
 */
function buildDiagnosticsBundle({
  deepHealth = null,
  storageReport = null,
  activeJob = null,
  cacheKeys = [],
  safeSettings = {},
  idSettings = {}
} = {}) {
  const pkg = require('../package.json');
  const sqlitePath = getSqlitePath();
  const sqliteBase = path.basename(sqlitePath);
  const sourceHealth = deepHealth || {};
  const sourceStorage = storageReport || getStorageReport();

  return {
    format: 'nova-diagnostics-bundle',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    app: { name: pkg.name, version: pkg.version },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      uptimeSeconds: Math.floor(process.uptime())
    },
    health: {
      process: sourceHealth.process || null,
      memory: sourceHealth.memory || null,
      discord: sourceHealth.discord || null,
      sqlite: {
        path: `<DATA_DIR>/${sqliteBase}`,
        fileBytes: sourceHealth.sqlite?.fileBytes ?? sourceStorage.fileBytes ?? 0,
        integrityOk: sourceHealth.sqlite?.integrityOk ?? null,
        integrityResult: sourceHealth.sqlite?.integrityCheck ?? null,
        readable: sourceHealth.sqlite?.readable ?? null,
        writable: sourceHealth.sqlite?.writable ?? null
      }
    },
    storage: {
      totalRows: sourceStorage.totalRows ?? 0,
      byNamespace: sourceStorage.byNamespace || [],
      largestKeys: sourceStorage.largestKeys || []
    },
    maintenance: {
      activeCacheKeys: cacheKeys,
      activeSeedJob: activeJob || null
    },
    config: {
      safeSettings,
      idSettings
    }
  };
}

/**
 * Checks if any legacy keys exist in the 'main' namespace that need migration.
 * @returns {{ migrationRequired: boolean, legacyKeyCount: number, details: Record<string, number> }}
 */
function getMigrationStatus() {
  const sqlitePath = getSqlitePath();
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const legacyPrefixes = [
      'main:message_count:',
      'main:last_message:',
      'main:last_message_channel:',
      'main:invite_usage:',
      'main:invite_join_history:',
      'main:invite_code_to_tag_map:'
    ];

    const details = {};
    let total = 0;

    for (const prefix of legacyPrefixes) {
      const count = db.prepare("SELECT COUNT(*) AS c FROM keyv WHERE key LIKE ?").get(`${prefix}%`).c;
      if (count > 0) {
        details[prefix] = count;
        total += count;
      }
    }

    return {
      migrationRequired: total > 0,
      legacyKeyCount: total,
      details
    };
  } finally {
    db.close();
  }
}

/**
 * Moves legacy keys from 'main' to their new namespaces.
 * @returns {{ migrated: number, errors: string[] }}
 */
function runNamespaceMigration() {
  const sqlitePath = getSqlitePath();
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath);

  const migrationMap = {
    'main:message_count:': 'messages:count:',
    'main:last_message:': 'messages:time:',
    'main:last_message_channel:': 'messages:channel:',
    'main:invite_usage:': 'invites:usage:',
    'main:invite_join_history:': 'invites:join_history:',
    'main:invite_code_to_tag_map:': 'invites:code_to_tag_map:'
  };

  const results = { migrated: 0, errors: [] };

  try {
    const runMigration = db.transaction(() => {
      for (const [oldPrefix, newPrefix] of Object.entries(migrationMap)) {
        const rows = db.prepare("SELECT key, value FROM keyv WHERE key LIKE ?").all(`${oldPrefix}%`);
        for (const row of rows) {
          const newKey = row.key.replace(oldPrefix, newPrefix);
          // Insert into new namespace (UPSERT)
          db.prepare(`
            INSERT INTO keyv (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run(newKey, row.value);
          // Delete old key
          db.prepare("DELETE FROM keyv WHERE key = ?").run(row.key);
          results.migrated++;
        }
      }
    });

    runMigration();
    return results;
  } catch (err) {
    return { migrated: results.migrated, error: String(err) };
  } finally {
    db.close();
  }
}

module.exports = {
  getSqlitePath,
  getStorageReport,
  runSqliteMaintenance,
  sqliteIntegrityCheck,
  cleanupExpiredSessions,
  clearAllSessionRows,
  sqliteRwProbe,
  buildDiagnosticsBundle,
  getMigrationStatus,
  runNamespaceMigration
};
