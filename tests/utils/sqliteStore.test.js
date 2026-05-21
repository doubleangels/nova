describe('sqliteStore', () => {
  let mockReadonlyDb;
  let mockWritableDb;
  let mockKeyvSqlite;
  let sqliteStore;

  beforeEach(() => {
    jest.resetModules();
    mockReadonlyDb = { pragma: jest.fn(), close: jest.fn() };
    mockWritableDb = { pragma: jest.fn(), close: jest.fn() };
    mockKeyvSqlite = jest.fn();

    jest.doMock('better-sqlite3', () =>
      jest.fn((path, opts) => {
        if (opts?.readonly) return mockReadonlyDb;
        return mockWritableDb;
      })
    );
    jest.doMock('@keyv/sqlite', () => mockKeyvSqlite);

    sqliteStore = require('../../utils/sqliteStore');
  });

  it('exports data paths', () => {
    expect(sqliteStore.dataDir).toBeDefined();
    expect(sqliteStore.sqlitePath).toContain('database.sqlite');
  });

  it('defaults dataDir to project data folder when DATA_DIR is unset', () => {
    const savedDataDir = process.env.DATA_DIR;
    delete process.env.DATA_DIR;

    jest.isolateModules(() => {
      jest.doMock('better-sqlite3', () =>
        jest.fn((filePath, opts) => (opts?.readonly ? mockReadonlyDb : mockWritableDb))
      );
      jest.doMock('@keyv/sqlite', () => mockKeyvSqlite);
      const path = require('path');
      const fresh = require('../../utils/sqliteStore');
      expect(fresh.dataDir).toBe(path.resolve(process.cwd(), 'data'));
    });

    process.env.DATA_DIR = savedDataDir;
  });

  it('returns singleton shared Keyv store', () => {
    const store1 = sqliteStore.getSharedKeyvStore();
    const store2 = sqliteStore.getSharedKeyvStore();
    expect(store1).toBe(store2);
    expect(mockKeyvSqlite).toHaveBeenCalledTimes(1);
  });

  it('returns singleton readonly db', () => {
    const db1 = sqliteStore.getReadonlyDb();
    const db2 = sqliteStore.getReadonlyDb();
    expect(db1).toBe(mockReadonlyDb);
    expect(db2).toBe(mockReadonlyDb);
    expect(mockReadonlyDb.pragma).toHaveBeenCalledWith('busy_timeout = 10000');
  });

  it('returns singleton writable db', () => {
    const db1 = sqliteStore.getWritableDb();
    const db2 = sqliteStore.getWritableDb();
    expect(db1).toBe(mockWritableDb);
    expect(db2).toBe(mockWritableDb);
    expect(mockWritableDb.pragma).toHaveBeenCalledWith('busy_timeout = 10000');
  });

  it('closes only readonly connection when writable was never opened', () => {
    sqliteStore.getReadonlyDb();
    sqliteStore.closeDatabaseConnections();
    expect(mockReadonlyDb.close).toHaveBeenCalled();
    expect(mockWritableDb.close).not.toHaveBeenCalled();
  });

  it('closes only writable connection when readonly was never opened', () => {
    jest.resetModules();
    jest.doMock('better-sqlite3', () =>
      jest.fn((path, opts) => (opts?.readonly ? mockReadonlyDb : mockWritableDb))
    );
    jest.doMock('@keyv/sqlite', () => mockKeyvSqlite);
    const fresh = require('../../utils/sqliteStore');
    fresh.getWritableDb();
    fresh.closeDatabaseConnections();
    expect(mockWritableDb.close).toHaveBeenCalled();
    expect(mockReadonlyDb.close).not.toHaveBeenCalled();
  });

  it('closes database connections and clears singletons', () => {
    sqliteStore.getReadonlyDb();
    sqliteStore.getWritableDb();
    sqliteStore.closeDatabaseConnections();
    expect(mockReadonlyDb.close).toHaveBeenCalled();
    expect(mockWritableDb.close).toHaveBeenCalled();

    jest.resetModules();
    jest.doMock('better-sqlite3', () =>
      jest.fn((path, opts) => (opts?.readonly ? mockReadonlyDb : mockWritableDb))
    );
    jest.doMock('@keyv/sqlite', () => mockKeyvSqlite);
    const fresh = require('../../utils/sqliteStore');
    fresh.getReadonlyDb();
    expect(mockReadonlyDb.close).toHaveBeenCalledTimes(1);
  });
});
