describe('sqliteStore', () => {
  let mockReadonlyDb;
  let mockWritableDb;
  let mockKeyvSqlite;
  let sqliteStore;

  beforeEach(() => {
    jest.resetModules();
    mockReadonlyDb = { pragma: jest.fn(), close: jest.fn(), exec: jest.fn() };
    mockWritableDb = { pragma: jest.fn(), close: jest.fn(), exec: jest.fn() };
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

  it('should export data paths', () => {
    expect(sqliteStore.dataDir).toBeDefined();
    expect(sqliteStore.sqlitePath).toMatch(/database(-\d+)?\.sqlite$/);
  });

  it('should default dataDir to project data folder when DATA_DIR is unset', () => {
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

  it('should return singleton shared Keyv store', () => {
    const store1 = sqliteStore.getSharedKeyvStore();
    const store2 = sqliteStore.getSharedKeyvStore();
    expect(store1).toBe(store2);
    expect(mockKeyvSqlite).toHaveBeenCalledTimes(1);
  });

  it('should return singleton readonly db', () => {
    const db1 = sqliteStore.getReadonlyDb();
    const db2 = sqliteStore.getReadonlyDb();
    expect(db1).toBe(mockReadonlyDb);
    expect(db2).toBe(mockReadonlyDb);
    expect(mockReadonlyDb.pragma).toHaveBeenCalledWith('busy_timeout = 10000');
  });

  it('should return singleton writable db', () => {
    const db1 = sqliteStore.getWritableDb();
    const db2 = sqliteStore.getWritableDb();
    expect(db1).toBe(mockWritableDb);
    expect(db2).toBe(mockWritableDb);
    expect(mockWritableDb.pragma).toHaveBeenCalledWith('busy_timeout = 10000');
    expect(mockWritableDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
  });

  it('should close only readonly connection when writable was never opened', async () => {
    sqliteStore.getReadonlyDb();
    await sqliteStore.closeDatabaseConnections();
    expect(mockReadonlyDb.close).toHaveBeenCalled();
    expect(mockWritableDb.close).not.toHaveBeenCalled();
  });

  it('should close only writable connection when readonly was never opened', async () => {
    jest.resetModules();
    jest.doMock('better-sqlite3', () =>
      jest.fn((path, opts) => (opts?.readonly ? mockReadonlyDb : mockWritableDb))
    );
    jest.doMock('@keyv/sqlite', () => mockKeyvSqlite);
    const fresh = require('../../utils/sqliteStore');
    fresh.getWritableDb();
    await fresh.closeDatabaseConnections();
    expect(mockWritableDb.close).toHaveBeenCalled();
    expect(mockReadonlyDb.close).not.toHaveBeenCalled();
  });

  it('should close database connections and clears singletons', async () => {
    sqliteStore.getReadonlyDb();
    sqliteStore.getWritableDb();
    await sqliteStore.closeDatabaseConnections();
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

  it('should call close on shared store when it exposes a close method', async () => {
    const mockClose = jest.fn();
    jest.resetModules();
    jest.doMock('better-sqlite3', () =>
      jest.fn((filePath, opts) => (opts?.readonly ? mockReadonlyDb : mockWritableDb))
    );
    // Return a KeyvSqlite-like object with a close() method
    jest.doMock('@keyv/sqlite', () =>
      jest.fn(() => ({ close: mockClose }))
    );
    const fresh = require('../../utils/sqliteStore');
    fresh.getSharedKeyvStore();
    await fresh.closeDatabaseConnections();
    expect(mockClose).toHaveBeenCalled();
  });

  it('should not throw when shared store has no close method', async () => {
    jest.resetModules();
    jest.doMock('better-sqlite3', () =>
      jest.fn((filePath, opts) => (opts?.readonly ? mockReadonlyDb : mockWritableDb))
    );
    // Return an object WITHOUT a close method
    jest.doMock('@keyv/sqlite', () => jest.fn(() => ({})));
    const fresh = require('../../utils/sqliteStore');
    fresh.getSharedKeyvStore();
    await expect(fresh.closeDatabaseConnections()).resolves.not.toThrow();
  });
});
