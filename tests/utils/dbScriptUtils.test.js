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
      accessSync: jest.fn()
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
  });
});
