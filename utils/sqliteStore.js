const requireDefault = (m) => (require(m).default || require(m));
const KeyvSqlite = requireDefault('@keyv/sqlite');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

// Assign each module instance a unique ID using a global counter that survives
// jest.resetModules(). In production the module is loaded once so the counter
// stays at 1 and the path is the conventional "database.sqlite". In tests,
// repeated jest.resetModules() calls produce new instances (counter → 2, 3, …)
// each pointing to their own file, so orphaned instances from nested beforeEach
// hooks cannot hold WAL locks that corrupt active connections.
global.__sqliteStoreInstanceId = (global.__sqliteStoreInstanceId ?? 0) + 1;
const _instanceId = global.__sqliteStoreInstanceId;
const sqliteBasename = _instanceId === 1 ? 'database.sqlite' : `database-${_instanceId}.sqlite`;
const sqlitePath = path.join(dataDir, sqliteBasename);

let sharedStore = null;
let readonlyDb = null;
let writableDb = null;

/**
 * Shared Keyv SQLite store — one connection pool for all namespaces.
 * @returns {import('@keyv/sqlite').KeyvSqlite}
 */
function getSharedKeyvStore() {
  if (!sharedStore) {
    sharedStore = new KeyvSqlite(`sqlite://${sqlitePath}`, {
      table: 'keyv',
      busyTimeout: 10000
    });
  }
  return sharedStore;
}

function getReadonlyDb() {
  if (!readonlyDb) {
    const Database = require('better-sqlite3');
    readonlyDb = new Database(sqlitePath, { readonly: true });
    readonlyDb.pragma('busy_timeout = 10000');
  }
  return readonlyDb;
}

function getWritableDb() {
  if (!writableDb) {
    const Database = require('better-sqlite3');
    writableDb = new Database(sqlitePath);
    writableDb.pragma('busy_timeout = 10000');
    writableDb.pragma('journal_mode = WAL');
    
    // Ensure the keyv table exists synchronously so that direct better-sqlite3 
    // queries in tests don't fail with "no such table: keyv" before @keyv/sqlite
    // has had a chance to asynchronously create it upon connection.
    writableDb.exec('CREATE TABLE IF NOT EXISTS keyv (key VARCHAR(255) PRIMARY KEY, value TEXT)');
  }
  return writableDb;
}

function closeDatabaseConnections() {
  if (readonlyDb) {
    readonlyDb.close();
    readonlyDb = null;
  }
  if (writableDb) {
    writableDb.close();
    writableDb = null;
  }
  if (sharedStore && typeof sharedStore.close === 'function') {
    try {
      sharedStore.close();
    } catch {
      // Swallow errors from the adapter close — a stale or already-closed
      // handle must not crash the Jest worker process.
    }
  }
  sharedStore = null;
}

module.exports = {
  dataDir,
  sqlitePath,
  getSharedKeyvStore,
  getReadonlyDb,
  getWritableDb,
  closeDatabaseConnections
};
