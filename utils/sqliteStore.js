const requireDefault = (m) => (require(m).default || require(m));
const KeyvSqlite = requireDefault('@keyv/sqlite');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'database.sqlite');

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
    sharedStore.close();
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
