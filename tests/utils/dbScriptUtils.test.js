const fs = require('fs');

describe('dbScriptUtils', () => {
  let dbScriptUtils;
  let mockFs;
  let mockKeyv;
  let mockKeyvSqlite;

  beforeEach(() => {
    jest.resetModules();
    
    // We mock fs functions we care about
    mockFs = {
      existsSync: jest.fn(),
      mkdirSync: jest.fn(),
      statSync: jest.fn(),
      accessSync: jest.fn(),
      constants: fs.constants
    };
    jest.doMock('fs', () => mockFs);

    mockKeyv = jest.fn();
    mockKeyv.prototype.disconnect = jest.fn();
    jest.doMock('keyv', () => mockKeyv);
    
    mockKeyvSqlite = jest.fn();
    jest.doMock('@keyv/sqlite', () => mockKeyvSqlite);

    dbScriptUtils = require('../../utils/dbScriptUtils');
  });

  describe('ensureDataDir', () => {
    it('should create directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      dbScriptUtils.ensureDataDir();
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should not create directory if it exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      dbScriptUtils.ensureDataDir();
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('parseKey', () => {
    it('should throw on empty key', () => {
      expect(() => dbScriptUtils.parseKey('')).toThrow();
    });

    it('should parse key without namespace', () => {
      const result = dbScriptUtils.parseKey('my_key');
      expect(result).toEqual({ namespace: 'main', section: null, actualKey: 'my_key', fullKey: 'my_key' });
    });

    it('should parse key with namespace', () => {
      const result = dbScriptUtils.parseKey('invites:my_key');
      expect(result).toEqual({ namespace: 'invites', section: null, actualKey: 'my_key', fullKey: 'my_key' });
    });

    it('should parse key with namespace and section', () => {
      const result = dbScriptUtils.parseKey('main:config:my_key');
      expect(result).toEqual({ namespace: 'main', section: 'config:', actualKey: 'my_key', fullKey: 'config:my_key' });
    });

    it('should parse key without namespace but known section', () => {
      const result = dbScriptUtils.parseKey('config:my_key');
      expect(result).toEqual({ namespace: 'main', section: 'config:', actualKey: 'my_key', fullKey: 'config:my_key' });
    });
  });

  describe('parseDatabaseKey', () => {
    it('should parse standard db key', () => {
      const result = dbScriptUtils.parseDatabaseKey('main:config:my_key');
      expect(result).toEqual({ namespace: 'main', section: 'config:', actualKey: 'my_key', fullKey: 'config:my_key' });
    });

    it('should handle db key with unknown section', () => {
      const result = dbScriptUtils.parseDatabaseKey('main:custom:my_key');
      expect(result).toEqual({ namespace: 'main', section: 'custom:', actualKey: 'my_key', fullKey: 'custom:my_key' });
    });
  });

  describe('parseValue', () => {
    it('should parse booleans', () => {
      expect(dbScriptUtils.parseValue('true')).toBe(true);
      expect(dbScriptUtils.parseValue('false')).toBe(false);
    });

    it('should parse null', () => {
      expect(dbScriptUtils.parseValue('null')).toBeNull();
    });

    it('should parse numbers', () => {
      expect(dbScriptUtils.parseValue('123')).toBe(123);
      expect(dbScriptUtils.parseValue('123.45')).toBe(123.45);
    });

    it('should preserve discord IDs as strings', () => {
      const bigId = '905183818318233600';
      expect(dbScriptUtils.parseValue(bigId)).toBe(bigId);
    });

    it('should parse JSON', () => {
      expect(dbScriptUtils.parseValue('{"key": "value"}')).toEqual({ key: 'value' });
      expect(dbScriptUtils.parseValue('["a", "b"]')).toEqual(['a', 'b']);
    });

    it('should fallback to string', () => {
      expect(dbScriptUtils.parseValue('hello world')).toBe('hello world');
      expect(dbScriptUtils.parseValue('{invalid json}')).toBe('{invalid json}');
    });
  });

  describe('withKeyv', () => {
    it('should execute fn and disconnect', async () => {
      const mockKeyvInstance = { disconnect: jest.fn() };
      const fn = jest.fn().mockResolvedValue('result');
      
      const result = await dbScriptUtils.withKeyv(mockKeyvInstance, fn);
      
      expect(fn).toHaveBeenCalledWith(mockKeyvInstance);
      expect(mockKeyvInstance.disconnect).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should disconnect even if fn throws', async () => {
      const mockKeyvInstance = { disconnect: jest.fn() };
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await expect(dbScriptUtils.withKeyv(mockKeyvInstance, fn)).rejects.toThrow('Test error');
      expect(mockKeyvInstance.disconnect).toHaveBeenCalled();
    });
  });

  describe('getKeyvForNamespace', () => {
    it('should throw on invalid namespace', () => {
      expect(() => dbScriptUtils.getKeyvForNamespace('invalid')).toThrow('Invalid namespace');
    });

    it('should create Keyv instance', () => {
      mockFs.existsSync.mockReturnValue(true);
      dbScriptUtils.getKeyvForNamespace('main');
      expect(mockKeyv).toHaveBeenCalled();
      expect(mockKeyvSqlite).toHaveBeenCalled();
    });

    it('should return cached Keyv instance for same namespace', () => {
      mockFs.existsSync.mockReturnValue(true);
      const first = dbScriptUtils.getKeyvForNamespace('invites');
      const second = dbScriptUtils.getKeyvForNamespace('invites');
      expect(first).toBe(second);
      expect(mockKeyv).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkDatabaseAccess', () => {
    beforeEach(() => {
      process.getuid = () => 1000;
      process.getgid = () => 1000;
    });

    it('should handle platforms without getuid/getgid', () => {
      delete process.getuid;
      delete process.getgid;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ uid: 0, gid: 0 });
      mockFs.accessSync.mockImplementation(() => {});
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.currentUser.uid).toBeNull();
      expect(result.accessible).toBe(true);
      process.getuid = () => 1000;
      process.getgid = () => 1000;
    });

    it('should return early when database file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.accessible).toBe(false);
      expect(result.fileExists).toBe(false);
    });

    it('should mark accessible when file is readable', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ uid: 1000, gid: 1000 });
      mockFs.accessSync.mockImplementation(() => {});
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.accessible).toBe(true);
    });

    it('should provide root guidance when access denied as root', () => {
      process.getuid = () => 0;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ uid: 1000, gid: 1000 });
      mockFs.accessSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.recommendation).toContain('gosu');
    });

    it('should provide guidance for non-root wrong owner', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ uid: 999, gid: 999 });
      mockFs.accessSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.recommendation).toContain('different user');
    });

    it('should suggest ls when access denied for same owner', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ uid: 1000, gid: 1000 });
      mockFs.accessSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.recommendation).toContain('ls -l');
    });

    it('should handle stat errors', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('stat fail');
      });
      const result = dbScriptUtils.checkDatabaseAccess();
      expect(result.error).toBe('stat fail');
    });
  });

  describe('getDatabasePathInfo', () => {
    it('should return path debug info', () => {
      mockFs.existsSync.mockReturnValue(true);
      const info = dbScriptUtils.getDatabasePathInfo();
      expect(info.dataDir).toBeDefined();
      expect(info.sqlitePath).toContain('database.sqlite');
      expect(info.dataDirExists).toBe(true);
      expect(info.databaseExists).toBe(true);
    });
  });

  describe('formatSectionName', () => {
    it('should strip trailing colon from section', () => {
      expect(dbScriptUtils.formatSectionName('config:')).toBe('config');
      expect(dbScriptUtils.formatSectionName(null)).toBe('');
    });
  });

  describe('parseKey edge cases', () => {
    it('should parse namespace without section colon', () => {
      const result = dbScriptUtils.parseKey('invites:tagname');
      expect(result).toEqual({
        namespace: 'invites',
        section: null,
        actualKey: 'tagname',
        fullKey: 'tagname'
      });
    });
  });

  describe('parseDatabaseKey edge cases', () => {
    it('should handle empty rest of key', () => {
      expect(dbScriptUtils.parseDatabaseKey('main:')).toEqual({
        namespace: 'main',
        section: null,
        actualKey: '',
        fullKey: ''
      });
    });

    it('should default unknown namespace to main', () => {
      expect(dbScriptUtils.parseDatabaseKey('unknown:config:my_key')).toEqual({
        namespace: 'main',
        section: 'config:',
        actualKey: 'my_key',
        fullKey: 'config:my_key'
      });
    });

    it('should build fullKey without section prefix when section is null', () => {
      expect(dbScriptUtils.parseDatabaseKey('invites:tagname')).toEqual({
        namespace: 'invites',
        section: null,
        actualKey: 'tagname',
        fullKey: 'tagname'
      });
    });
  });

  describe('parseValue edge cases', () => {
    it('should return non-string values unchanged', () => {
      expect(dbScriptUtils.parseValue(42)).toBe(42);
    });
  });

  describe('withKeyv without disconnect', () => {
    it('should skip disconnect when not available', async () => {
      const instance = {};
      const result = await dbScriptUtils.withKeyv(instance, async (k) => k);
      expect(result).toBe(instance);
    });
  });
});
