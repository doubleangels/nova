const dayjs = require('dayjs');
const fs = require('fs');

function createFsMock(overrides = {}) {
  return {
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    accessSync: jest.fn(),
    statSync: jest.fn().mockReturnValue({ size: 100, mode: 33188, uid: 1, gid: 1 }),
    chmodSync: jest.fn(),
    constants: fs.constants,
    ...overrides
  };
}

function createWritableDbMock(rowValue = null) {
  const getStmt = { get: jest.fn().mockReturnValue(rowValue ? { value: rowValue } : undefined) };
  const runStmt = { run: jest.fn() };
  const mockDb = {
    transaction: jest.fn((fn) => () => fn()),
    prepare: jest.fn((sql) => {
      if (sql.includes('SELECT')) return getStmt;
      return runStmt;
    })
  };
  return { mockDb, getStmt, runStmt };
}

describe('database utils', () => {
  let db;
  let mainKeyvInstance;
  let inviteKeyvInstance;
  let mockLogger;
  let mockFs;
  let mockReadonlyDb;
  let mockWritableDb;
  let getStmt;
  let runStmt;

  function loadDatabase({
    fsOverrides = {},
    sqliteOverrides = {},
    configOverrides = { guildName: 'Test Guild' }
  } = {}) {
    jest.resetModules();
    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => configOverrides);

    mockFs = createFsMock(fsOverrides);
    jest.doMock('fs', () => mockFs);

    const { mockDb, getStmt: gs, runStmt: rs } = createWritableDbMock();
    mockWritableDb = mockDb;
    getStmt = gs;
    runStmt = rs;

    mockReadonlyDb = {
      prepare: jest.fn(() => ({
        all: jest.fn().mockReturnValue([])
      }))
    };

    jest.doMock('../../utils/sqliteStore', () => ({
      dataDir: '/tmp/test-data',
      sqlitePath: '/tmp/test-data/database.sqlite',
      getSharedKeyvStore: jest.fn(() => ({})),
      getReadonlyDb: jest.fn(() => mockReadonlyDb),
      getWritableDb: jest.fn(() => mockWritableDb),
      closeDatabaseConnections: jest.fn(),
      ...sqliteOverrides
    }));

    const MockKeyvClass = require('../../tests/__mocks__/keyv.mock');
    jest.doMock('keyv', () =>
      jest.fn().mockImplementation((opts) => {
        const instance = new MockKeyvClass(opts);
        if (opts && opts.namespace === 'invites') {
          inviteKeyvInstance = instance;
        } else {
          mainKeyvInstance = instance;
        }
        return instance;
      })
    );
    jest.doMock('@keyv/sqlite', () => jest.fn().mockImplementation(() => ({})));

    jest.isolateModules(() => {
      db = require('../../utils/database');
    });
    return db;
  }

  beforeEach(() => {
    loadDatabase();
  });

  describe('module initialization', () => {
    it('should create data directory when missing', () => {
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn((p) => p !== '/tmp/test-data'),
          accessSync: jest.fn()
        }
      });
      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });

    it('should log when data directory is not writable', () => {
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(() => {
            throw new Error('not writable');
          })
        }
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should log when database file does not exist', () => {
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn((p) => p !== '/tmp/test-data/database.sqlite')
        }
      });
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle top-level fs errors', () => {
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn(() => {
            throw new Error('fs fail');
          })
        }
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should warn when chmod fails', () => {
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn().mockReturnValue(true),
          chmodSync: jest.fn(() => {
            throw new Error('chmod fail');
          })
        }
      });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle keyv connection errors', () => {
      const errorCall = mainKeyvInstance.on.mock.calls.find((c) => c[0] === 'error');
      expect(errorCall).toBeDefined();
      const errHandler = errorCall[1];
      errHandler(new Error('keyv err'));
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Keyv connection error occurred.',
        expect.any(Object)
      );
    });

    it('should handle invite keyv connection errors', () => {
      const errorCall = inviteKeyvInstance.on.mock.calls.find((c) => c[0] === 'error');
      expect(errorCall).toBeDefined();
      const errHandler = errorCall[1];
      errHandler(new Error('invite keyv err'));
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invite Keyv connection error occurred.',
        expect.any(Object)
      );
    });
  });

  describe('initializeDatabase', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on valid read/write test', async () => {
      mainKeyvInstance.set.mockResolvedValue(undefined);
      mainKeyvInstance.get.mockResolvedValue('test_value');
      mainKeyvInstance.delete.mockResolvedValue(undefined);
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn().mockReturnValue(true),
          statSync: jest.fn().mockReturnValue({ size: 10, mode: '33188', uid: 1, gid: 1 }),
          chmodSync: jest.fn()
        }
      });
      await db.initializeDatabase();
      expect(mainKeyvInstance.set).toHaveBeenCalled();
    });

    it('should warn when database file missing after successful test', async () => {
      mainKeyvInstance.set.mockResolvedValue(undefined);
      mainKeyvInstance.get.mockResolvedValue('test_value');
      mainKeyvInstance.delete.mockResolvedValue(undefined);
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn((p) => !String(p).includes('database.sqlite')),
          statSync: jest.fn(),
          chmodSync: jest.fn()
        }
      });
      await db.initializeDatabase();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Database file not found after successful test.',
        expect.any(Object)
      );
    });

    it('should log chmod failure during initializeDatabase', async () => {
      mainKeyvInstance.set.mockResolvedValue(undefined);
      mainKeyvInstance.get.mockResolvedValue('test_value');
      mainKeyvInstance.delete.mockResolvedValue(undefined);
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn().mockReturnValue(true),
          statSync: jest.fn().mockReturnValue({ size: 10, mode: '33188', uid: 1, gid: 1 }),
          chmodSync: jest.fn(() => {
            throw new Error('chmod');
          })
        }
      });
      await db.initializeDatabase();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Could not set permissions on database file.',
        expect.any(Object)
      );
    });

    it('should retry and exit when all attempts fail', async () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      loadDatabase();
      mainKeyvInstance.set.mockRejectedValue(new Error('db fail'));
      const promise = db.initializeDatabase();
      await jest.advanceTimersByTimeAsync(10000);
      await promise;
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Final database error occurred.',
        expect.objectContaining({ err: expect.any(Error) })
      );
      exitSpy.mockRestore();
    });

    it('should throw when read/write test returns unexpected value', async () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      loadDatabase({
        fsOverrides: {
          existsSync: jest.fn().mockReturnValue(true),
          statSync: jest.fn().mockReturnValue({ size: 10, mode: '33188', uid: 1, gid: 1 }),
          chmodSync: jest.fn()
        }
      });
      mainKeyvInstance.set.mockResolvedValue(undefined);
      mainKeyvInstance.get.mockResolvedValue('wrong_value');
      mainKeyvInstance.delete.mockResolvedValue(undefined);
      const promise = db.initializeDatabase();
      await jest.advanceTimersByTimeAsync(15000);
      await promise;
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Final database error occurred.',
        expect.objectContaining({ err: expect.any(Error) })
      );
      exitSpy.mockRestore();
    });

  });

  describe('user list helpers', () => {
    it('should not duplicate user ids in tracking lists', async () => {
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return ['existing-u'];
        return null;
      });
      const setCallsBefore = mainKeyvInstance.set.mock.calls.length;
      await db.addSpamModeJoinTime('existing-u');
      const listUpdateCalls = mainKeyvInstance.set.mock.calls
        .slice(setCallsBefore)
        .filter(([key]) => key === 'config:spam_mode_users');
      expect(listUpdateCalls).toHaveLength(0);
    });

    it('should handle addToUserList errors via mute mode add', async () => {
      mockWritableDb.transaction.mockImplementation(() => { throw new Error('list fail'); });
      await db.addMuteModeUser('u', 'name');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should skip debug log when key was not present in removeMuteModeUser', async () => {
      mainKeyvInstance.delete.mockResolvedValueOnce(false);
      mainKeyvInstance.get.mockResolvedValueOnce(['u1']);
      await db.removeMuteModeUser('u1');
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        'Removed user from mute mode tracking.',
        expect.any(Object)
      );
    });

    it('should return empty list when user id list is null in getAllMuteModeUsers', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.getAllMuteModeUsers()).toEqual([]);
    });

    it('should skip missing user records in getAllMuteModeUsers', async () => {
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:mute_mode_users') return ['u1', 'u2'];
        if (key === 'mute_mode:u1') return { userId: 'u1', username: 'a', joinTime: '2025-01-01' };
        if (key === 'mute_mode:u2') return null;
        return null;
      });
      const users = await db.getAllMuteModeUsers();
      expect(users).toHaveLength(1);
    });

    it('should handle removeFromUserList errors via spam remove', async () => {
      mockWritableDb.transaction.mockImplementation(() => { throw new Error('list fail'); });
      await db.removeSpamModeJoinTime('u');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should skip adding user already present in stored Keyv-envelope list', async () => {
      getStmt.get.mockReturnValue({ value: JSON.stringify({ value: ['u1'], expires: null }) });
      await db.addMuteModeUser('u1', 'name');
      expect(runStmt.run).not.toHaveBeenCalled();
    });

    it('should add user when stored list is plain JSON array', async () => {
      getStmt.get.mockReturnValue({ value: JSON.stringify(['u2']) });
      await db.addMuteModeUser('u1', 'name');
      expect(runStmt.run).toHaveBeenCalled();
    });

    it('should start from empty list when stored value is invalid JSON', async () => {
      getStmt.get.mockReturnValue({ value: 'invalid json{' });
      await db.addMuteModeUser('u1', 'name');
      expect(runStmt.run).toHaveBeenCalled();
    });

    it('should start from empty list when stored value is non-array JSON', async () => {
      getStmt.get.mockReturnValue({ value: JSON.stringify({ value: 'not-an-array' }) });
      await db.addMuteModeUser('u1', 'name');
      expect(runStmt.run).toHaveBeenCalled();
    });

    it('should filter user out of non-empty list in removeFromUserList', async () => {
      getStmt.get.mockReturnValue({ value: JSON.stringify({ value: ['u1', 'u2'], expires: null }) });
      await db.removeSpamModeJoinTime('u1');
      expect(runStmt.run).toHaveBeenCalled();
    });
  });

  describe('getValue / setValue / deleteValue', () => {
    it('should return cached config values without hitting keyv', async () => {
      await db.setValue('cached_key', 'cached_value');
      mainKeyvInstance.get.mockClear();
      expect(await db.getValue('cached_key')).toBe('cached_value');
      expect(mainKeyvInstance.get).not.toHaveBeenCalled();
    });

    it('should set a value correctly', async () => {
      await db.setValue('test_key', 'test_value');
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('config:test_key', 'test_value');
    });

    it('should get a value correctly', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce('test_value');
      const val = await db.getValue('test_key');
      expect(val).toBe('test_value');
    });

    it('should return null for undefined values', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(undefined);
      expect(await db.getValue('missing')).toBeNull();
    });

    it('should return cached value on subsequent reads', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce('first');
      expect(await db.getValue('cached-read')).toBe('first');
      mainKeyvInstance.get.mockClear();
      expect(await db.getValue('cached-read')).toBe('first');
      expect(mainKeyvInstance.get).not.toHaveBeenCalled();
    });

    it('should reject on get error', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('get fail'));
      await expect(db.getValue('err_key')).rejects.toThrow('get fail');
    });

    it('should handle set errors', async () => {
      mainKeyvInstance.set.mockRejectedValueOnce(new Error('set fail'));
      await expect(db.setValue('err', 'v')).rejects.toThrow('set fail');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should delete a value correctly', async () => {
      await db.deleteValue('test_key');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('config:test_key');
    });

    it('should handle delete errors', async () => {
      mainKeyvInstance.delete.mockRejectedValueOnce(new Error('del fail'));
      await expect(db.deleteValue('err')).rejects.toThrow('del fail');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should use in-memory cache for subsequent gets', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce('cached_value');
      await db.getValue('cache_key');
      await db.getValue('cache_key');
      expect(mainKeyvInstance.get).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cached config values when requested', async () => {
      await db.setValue('cached_invalidate', 'first');
      expect(await db.getValue('cached_invalidate')).toBe('first');

      db.invalidateConfigCache('cached_invalidate');
      mainKeyvInstance.get.mockResolvedValueOnce('second');
      expect(await db.getValue('cached_invalidate')).toBe('second');
      expect(mainKeyvInstance.get).toHaveBeenCalledWith('config:cached_invalidate');
    });

    it('should clear all cached config values when no key is provided', async () => {
      await db.setValue('cache_a', 'a');
      await db.setValue('cache_b', 'b');
      db.invalidateConfigCache();

      mainKeyvInstance.get.mockResolvedValueOnce('fresh-a');
      mainKeyvInstance.get.mockResolvedValueOnce('fresh-b');
      expect(await db.getValue('cache_a')).toBe('fresh-a');
      expect(await db.getValue('cache_b')).toBe('fresh-b');
      expect(mainKeyvInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('Mute Mode Tracking', () => {
    it('should add mute mode user', async () => {
      await db.addMuteModeUser('user123', 'testuser');
      expect(mainKeyvInstance.set).toHaveBeenCalledWith(
        'mute_mode:user123',
        expect.objectContaining({ userId: 'user123' })
      );
    });

    it('should handle add mute mode errors', async () => {
      mainKeyvInstance.set.mockRejectedValueOnce(new Error('fail'));
      await db.addMuteModeUser('u', 'n');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should remove mute mode user when deleted', async () => {
      mainKeyvInstance.delete.mockResolvedValueOnce(true);
      await db.removeMuteModeUser('user123');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('mute_mode:user123');
    });

    it('should skip list update when user was not in mute mode', async () => {
      mainKeyvInstance.delete.mockResolvedValueOnce(false);
      await db.removeMuteModeUser('user123');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('mute_mode:user123');
    });

    it('should handle remove mute mode errors', async () => {
      mainKeyvInstance.delete.mockRejectedValueOnce(new Error('fail'));
      await expect(db.removeMuteModeUser('u')).rejects.toThrow('fail');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return true when user is tracked in mute mode', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce({ userId: 'u1' });
      expect(await db.isUserInMuteMode('u1')).toBe(true);
    });

    it('should return false when user is not tracked in mute mode', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.isUserInMuteMode('u1')).toBe(false);
    });

    it('should return false when mute mode lookup fails', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.isUserInMuteMode('u1')).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return formatted users in getAllMuteModeUsers', async () => {
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:mute_mode_users') return ['u1'];
        if (key === 'mute_mode:u1') return { userId: 'u1', username: 'a', joinTime: dayjs().toISOString() };
        return null;
      });
      const users = await db.getAllMuteModeUsers();
      expect(users).toHaveLength(1);
      expect(users[0].user_id).toBe('u1');
    });

    it('should return empty on error in getAllMuteModeUsers', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getAllMuteModeUsers()).toEqual([]);
    });

    it('should get user join time', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce({ joinTime: dayjs().toISOString() });
      expect(await db.getUserJoinTime('user123')).toBeInstanceOf(Date);
    });

    it('should return null when no join time', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.getUserJoinTime('user123')).toBeNull();
    });

    it('should handle getUserJoinTime errors', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getUserJoinTime('u')).toBeNull();
    });
  });

  describe('Spam Mode Tracking', () => {
    it('should add spam mode join time', async () => {
      await db.addSpamModeJoinTime('user123', 'testuser', new Date());
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('spam_mode:user123', expect.any(Object));
    });

    it('should handle add spam errors', async () => {
      mainKeyvInstance.set.mockRejectedValueOnce(new Error('fail'));
      await db.addSpamModeJoinTime('u', 'n', new Date());
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return date in getSpamModeJoinTime', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce({ joinTime: dayjs().toISOString() });
      expect(await db.getSpamModeJoinTime('u')).toBeInstanceOf(Date);
    });

    it('should return null without joinTime in getSpamModeJoinTime', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce({ userId: 'u' });
      expect(await db.getSpamModeJoinTime('u')).toBeNull();
    });

    it('should return null on error in getSpamModeJoinTime', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getSpamModeJoinTime('u')).toBeNull();
    });

    it('should remove spam mode join time', async () => {
      mainKeyvInstance.delete.mockResolvedValueOnce(true);
      await db.removeSpamModeJoinTime('user123');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('spam_mode:user123');
    });

    it('should handle remove spam errors', async () => {
      mainKeyvInstance.delete.mockRejectedValueOnce(new Error('fail'));
      await db.removeSpamModeJoinTime('u');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('cleanupOldTrackingUsers', () => {
    it('should keep spam users within tracking window', async () => {
      const recent = dayjs().toISOString();
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return ['s1'];
        if (key === 'spam_mode:s1') return { joinTime: recent };
        if (key === 'config:mute_mode_users') return [];
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.spamModeRemoved).toBe(0);
    });

    it('should remove expired mute users without consulting client when join time expired', async () => {
      const oldTime = dayjs().subtract(10, 'hour').toISOString();
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_kick_time_hours') return '4';
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: oldTime };
        return null;
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.muteModeRemoved).toBe(1);
    });

    it('should handle empty spam and mute user lists from keyv', async () => {
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return null;
        if (key === 'config:mute_mode_users') return null;
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.spamModeRemoved).toBe(0);
      expect(result.muteModeRemoved).toBe(0);
    });

    it('should keep spam users within the tracking window', async () => {
      const recent = dayjs().toISOString();
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_window_hours') return '4';
        if (key === 'config:mute_mode_kick_time_hours') return '4';
        if (key === 'config:spam_mode_users') return ['s1'];
        if (key === 'spam_mode:s1') return { joinTime: recent };
        if (key === 'config:mute_mode_users') return [];
        return null;
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.spamModeRemoved).toBe(0);
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('config:spam_mode_users', ['s1']);
    });

    it('should remove expired spam and mute users', async () => {
      const oldTime = dayjs().subtract(10, 'hour').toISOString();
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_window_hours') return '4';
        if (key === 'config:mute_mode_kick_time_hours') return '4';
        if (key === 'config:spam_mode_users') return ['s1'];
        if (key === 'spam_mode:s1') return { joinTime: oldTime };
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: oldTime };
        return null;
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.spamModeRemoved).toBeGreaterThan(0);
      expect(result.muteModeRemoved).toBeGreaterThan(0);
    });

    it('should remove mute users with missing join data', async () => {
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_users') return ['orphan-m'];
        return null;
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.muteModeRemoved).toBe(1);
    });

    it('should remove orphan spam users without data', async () => {
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return ['orphan'];
        if (key === 'config:mute_mode_users') return [];
        return null;
      });
      const result = await db.cleanupOldTrackingUsers();
      expect(result.spamModeRemoved).toBe(1);
    });

    it('should use client to remove mute users not in guild', async () => {
      const recent = dayjs().toISOString();
      const mockClient = {
        guilds: {
          cache: {
            first: () => ({
              members: { fetch: jest.fn().mockResolvedValue(null) }
            })
          }
        }
      };
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: recent };
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers(mockClient);
      expect(result.muteModeRemoved).toBe(1);
    });

    it('should remove mute user when no guild in client', async () => {
      const recent = dayjs().toISOString();
      const mockClient = { guilds: { cache: { first: () => null } } };
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: recent };
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers(mockClient);
      expect(result.muteModeRemoved).toBe(1);
    });

    it('should keep mute user still in guild when within window', async () => {
      const recent = dayjs().toISOString();
      const mockClient = {
        guilds: {
          cache: {
            first: () => ({
              members: { fetch: jest.fn().mockResolvedValue({ id: 'm1' }) }
            })
          }
        }
      };
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: recent };
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers(mockClient);
      expect(result.muteModeRemoved).toBe(0);
    });

    it('should handle synchronous fetch errors for guild members', async () => {
      const recent = dayjs().toISOString();
      const mockClient = {
        guilds: {
          cache: {
            first: () => ({
              members: {
                fetch: jest.fn().mockImplementation(() => {
                  throw new Error('sync fetch fail');
                })
              }
            })
          }
        }
      };
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: recent };
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers(mockClient);
      expect(result.muteModeRemoved).toBe(1);
    });

    it('should handle fetch errors for guild members', async () => {
      const recent = dayjs().toISOString();
      const mockClient = {
        guilds: {
          cache: {
            first: () => ({
              members: { fetch: jest.fn().mockRejectedValue(new Error('fetch fail')) }
            })
          }
        }
      };
      mainKeyvInstance.get.mockImplementation(async (key) => {
        if (key === 'config:spam_mode_users') return [];
        if (key === 'config:mute_mode_users') return ['m1'];
        if (key === 'mute_mode:m1') return { joinTime: recent };
        return '4';
      });
      const result = await db.cleanupOldTrackingUsers(mockClient);
      expect(result.muteModeRemoved).toBe(1);
    });

    it('should log debug when nothing to remove', async () => {
      mainKeyvInstance.get.mockResolvedValue([]);
      await db.cleanupOldTrackingUsers();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should throw on cleanup error', async () => {
      mainKeyvInstance.get.mockRejectedValue(new Error('cleanup fail'));
      await expect(db.cleanupOldTrackingUsers()).rejects.toThrow('cleanup fail');
    });
  });

  describe('Invite Tracking', () => {
    it('should set invite tag', async () => {
      await db.setInviteTag('MyTag', { code: 'abc' });
      expect(inviteKeyvInstance.set).toHaveBeenCalledWith('tags:mytag', { code: 'abc' });
    });

    it('should throw on set invite tag error', async () => {
      inviteKeyvInstance.set.mockRejectedValueOnce(new Error('fail'));
      await expect(db.setInviteTag('t', {})).rejects.toThrow('DATABASE_WRITE_ERROR');
    });

    it('should get invite tag', async () => {
      inviteKeyvInstance.get.mockResolvedValueOnce({ code: 'x' });
      expect(await db.getInviteTag('MyTag')).toEqual({ code: 'x' });
    });

    it('should return null when invite tag value is undefined', async () => {
      inviteKeyvInstance.get.mockResolvedValueOnce(undefined);
      expect(await db.getInviteTag('missing')).toBeNull();
    });

    it('should return null on get invite tag error', async () => {
      inviteKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getInviteTag('t')).toBeNull();
    });

    it('should delete invite tag', async () => {
      await db.deleteInviteTag('MyTag');
      expect(inviteKeyvInstance.delete).toHaveBeenCalledWith('tags:mytag');
    });

    it('should throw on delete invite tag error', async () => {
      inviteKeyvInstance.delete.mockRejectedValueOnce(new Error('fail'));
      await expect(db.deleteInviteTag('t')).rejects.toThrow('DATABASE_DELETE_ERROR');
    });

    it('should notification channel get/set', async () => {
      await db.setInviteNotificationChannel('ch1');
      mainKeyvInstance.get.mockResolvedValueOnce('ch1');
      expect(await db.getInviteNotificationChannel()).toBe('ch1');
    });

    it('should and getInviteUsage in setInviteUsage', async () => {
      await db.setInviteUsage('g1', { abc: 1 });
      mainKeyvInstance.get.mockResolvedValueOnce({ abc: 1 });
      expect(await db.getInviteUsage('g1')).toEqual({ abc: 1 });
    });

    it('should return stored usage map from keyv in getInviteUsage', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce({ code1: 3, code2: 1 });
      expect(await db.getInviteUsage('guild-usage')).toEqual({ code1: 3, code2: 1 });
    });

    it('should return empty object when keyv returns null in getInviteUsage', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.getInviteUsage('guild-null')).toEqual({});
    });

    it('should handle invite usage errors', async () => {
      mainKeyvInstance.set.mockRejectedValueOnce(new Error('fail'));
      await db.setInviteUsage('g', {});
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getInviteUsage('g')).toEqual({});
    });

    it('should and getInviteCodeToTagMap with cache in setInviteCodeToTagMap', async () => {
      const map = { code1: 'tag1' };
      await db.setInviteCodeToTagMap('g1', map);
      expect(await db.getInviteCodeToTagMap('g1')).toEqual(map);
      expect(mainKeyvInstance.get).not.toHaveBeenCalled();
    });

    it('should return cached map without re-reading keyv in getInviteCodeToTagMap', async () => {
      const map = { cached: 'tag' };
      await db.setInviteCodeToTagMap('g-cache', map);
      mainKeyvInstance.get.mockClear();
      expect(await db.getInviteCodeToTagMap('g-cache')).toEqual(map);
      expect(mainKeyvInstance.get).not.toHaveBeenCalled();
    });

    it('should load from db when cache expired in getInviteCodeToTagMap', async () => {
      jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(999999999999);
      mainKeyvInstance.get.mockResolvedValueOnce({ c: 't' });
      const map = await db.getInviteCodeToTagMap('g2');
      expect(map).toEqual({ c: 't' });
      Date.now.mockRestore?.();
    });

    it('should return empty object when keyv has no map stored in getInviteCodeToTagMap', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.getInviteCodeToTagMap('g-empty-map')).toEqual({});
    });

    it('should return empty object when keyv returns null in getInviteCodeToTagMap', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.getInviteCodeToTagMap('g-null-map')).toEqual({});
    });

    it('should handle code map errors', async () => {
      mainKeyvInstance.set.mockRejectedValueOnce(new Error('fail'));
      await db.setInviteCodeToTagMap('g', {});
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getInviteCodeToTagMap('g')).toEqual({});
    });

    it('should clear cache in invalidateInviteCodeToTagMapCache', async () => {
      await db.setInviteCodeToTagMap('g', { a: 'b' });
      db.invalidateInviteCodeToTagMapCache('g');
      mainKeyvInstance.get.mockResolvedValueOnce({ x: 'y' });
      expect(await db.getInviteCodeToTagMap('g')).toEqual({ x: 'y' });
    });

    it('should clear all when no guildId in invalidateInviteCodeToTagMapCache', async () => {
      await db.setInviteCodeToTagMap('g1', { a: 'b' });
      db.invalidateInviteCodeToTagMapCache();
      mainKeyvInstance.get.mockResolvedValueOnce({});
      await db.getInviteCodeToTagMap('g1');
    });
  });

  describe('getAllInviteTagsData / rebuildCodeToTagMap', () => {
    const tagRow = {
      key: 'invites:tags:disboard',
      value: JSON.stringify({
        value: { code: 'ABC', name: 'Disboard', createdAt: 1, updatedAt: 2 }
      })
    };

    it('should parse invite tags from sqlite', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([tagRow])
            }))
          }))
        }
      });
      const tags = await db.getAllInviteTagsData();
      expect(tags[0].tagName).toBe('disboard');
    });

    it('should parse invite tags stored without keyv value wrapper', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([
                {
                  key: 'invites:tags:raw',
                  value: JSON.stringify({ code: 'RAW1', name: 'Raw Tag' })
                }
              ])
            }))
          }))
        }
      });
      const tags = await db.getAllInviteTagsData();
      expect(tags[0]).toEqual(expect.objectContaining({ tagName: 'raw', code: 'RAW1', name: 'Raw Tag' }));
    });

    it('should parse invite tags stored without keyv value wrapper', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([
                {
                  key: 'invites:tags:rawtag',
                  value: JSON.stringify({ code: 'RAW1', name: 'Raw Tag' })
                }
              ])
            }))
          }))
        }
      });
      const tags = await db.getAllInviteTagsData();
      expect(tags[0]).toMatchObject({ tagName: 'rawtag', code: 'RAW1', name: 'Raw Tag' });
    });

    it('should skip invalid tag rows', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([
                { key: 'invites:tags:bad', value: 'not-json' },
                { key: 'invites:tags:incomplete', value: JSON.stringify({ value: { code: 'x' } }) }
              ])
            }))
          }))
        }
      });
      expect(await db.getAllInviteTagsData()).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse tag data for key.',
        expect.objectContaining({ key: 'invites:tags:bad' })
      );
    });

    it('should return empty on getAllInviteTagsData error', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => {
              throw new Error('db fail');
            })
          }))
        }
      });
      expect(await db.getAllInviteTagsData()).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while getting all invite tags.',
        expect.any(Object)
      );
    });

    it('should rebuild and persists map when tags exist', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([tagRow])
            }))
          }))
        }
      });
      const map = await db.rebuildCodeToTagMap('guild-persist');
      expect(map.abc).toBe('disboard');
      expect(mainKeyvInstance.set).toHaveBeenCalled();
    });

    it('should rebuild code to tag map', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([tagRow])
            }))
          }))
        }
      });
      const map = await db.rebuildCodeToTagMap('guild1');
      expect(map.abc).toBe('disboard');
    });

    it('should rebuild map from tags stored without keyv value wrapper', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([
                {
                  key: 'invites:tags:unwrap',
                  value: JSON.stringify({ code: 'UNWRAP', name: 'Unwrapped' })
                }
              ])
            }))
          }))
        }
      });
      const map = await db.rebuildCodeToTagMap('guild-unwrap');
      expect(map.unwrap).toBe('unwrap');
    });

    it('should return empty map on rebuild error', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => {
              throw new Error('fail');
            })
          }))
        }
      });
      expect(await db.rebuildCodeToTagMap('g')).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while rebuilding code-to-tag mapping for guild.',
        expect.any(Object)
      );
    });

    it('should warn on rebuild parse errors for individual rows', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([
                { key: 'invites:tags:bad', value: 'not-json' },
                tagRow
              ])
            }))
          }))
        }
      });
      const map = await db.rebuildCodeToTagMap('guild1');
      expect(map.abc).toBe('disboard');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse tag data for key.',
        expect.objectContaining({ key: 'invites:tags:bad' })
      );
    });

    it('should return empty map when no valid tag codes are found', async () => {
      loadDatabase({
        sqliteOverrides: {
          getReadonlyDb: jest.fn(() => ({
            prepare: jest.fn(() => ({
              all: jest.fn().mockReturnValue([
                { key: 'invites:tags:empty', value: JSON.stringify({ value: { name: 'No Code' } }) }
              ])
            }))
          }))
        }
      });
      expect(await db.rebuildCodeToTagMap('guild1')).toEqual({});
    });
  });

  describe('members and message counts', () => {
    it('should return config value in getGuildName', async () => {
      loadDatabase({ configOverrides: { guildName: 'My Guild' } });
      expect(await db.getGuildName()).toBe('My Guild');
    });

    it('should fall back when config guildName is missing in getGuildName', async () => {
      loadDatabase({ configOverrides: {} });
      expect(await db.getGuildName()).toBe('Da Frens');
    });

    it('should and isFormerMember in setFormerMember', async () => {
      await db.setFormerMember('u1');
      mainKeyvInstance.get.mockResolvedValueOnce(1);
      expect(await db.isFormerMember('u1')).toBe(true);
    });

    it('should handle former member errors', async () => {
      mainKeyvInstance.set.mockRejectedValueOnce(new Error('fail'));
      await db.setFormerMember('u');
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.isFormerMember('u')).toBe(false);
    });

    it('should start at 1 when no prior count exists in incrementMessageCount', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.incrementMessageCount('new-user')).toBe(1);
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('message_count:new-user', 1);
    });

    it('should increment from stored count in incrementMessageCount', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(5);
      expect(await db.incrementMessageCount('u1')).toBe(6);
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('message_count:u1', 6);
    });

    it('should return null on error in incrementMessageCount', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('keyv fail'));
      expect(await db.incrementMessageCount('u')).toBeNull();
    });

    it('should return zero when stored count is zero in getMessageCount', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(0);
      expect(await db.getMessageCount('u-zero')).toBe(0);
    });

    it('should return zero when no count is stored in getMessageCount', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(null);
      expect(await db.getMessageCount('u-missing')).toBe(0);
    });

    it('should and deleteMessageCount in getMessageCount', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(10);
      expect(await db.getMessageCount('u')).toBe(10);
      await db.deleteMessageCount('u');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('message_count:u');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Deleted message count for user successfully.',
        expect.objectContaining({ userId: 'u' })
      );
    });

    it('should return true for stored marker values in isFormerMember', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce(0);
      expect(await db.isFormerMember('u0')).toBe(true);
    });

    it('should handle message count errors', async () => {
      mainKeyvInstance.get.mockRejectedValueOnce(new Error('fail'));
      expect(await db.getMessageCount('u')).toBe(0);
      mainKeyvInstance.delete.mockRejectedValueOnce(new Error('fail'));
      await db.deleteMessageCount('u');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  it('should re-export in closeDatabaseConnections', () => {
    expect(db.closeDatabaseConnections).toBeDefined();
  });
});
