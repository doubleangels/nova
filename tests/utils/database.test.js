const dayjs = require('dayjs');

describe('database utils', () => {
  let db;
  let mainKeyvInstance;
  let inviteKeyvInstance;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    
    // Mock the logger
    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);

    // Create tracking references for the Keyv instances
    const MockKeyvClass = require('../../tests/__mocks__/keyv.mock');
    
    let keyvInstances = [];
    
    // Mock keyv and @keyv/sqlite
    jest.doMock('keyv', () => {
      return jest.fn().mockImplementation((opts) => {
        const instance = new MockKeyvClass(opts);
        keyvInstances.push(instance);
        if (opts && opts.namespace === 'invites') {
          inviteKeyvInstance = instance;
        } else {
          mainKeyvInstance = instance;
        }
        return instance;
      });
    });
    
    jest.doMock('@keyv/sqlite', () => {
      return jest.fn().mockImplementation(() => ({}));
    });
    
    jest.doMock('../../config', () => ({}));

    jest.isolateModules(() => {
      db = require('../../utils/database');
    });
  });

  describe('getValue / setValue / deleteValue', () => {
    it('should set a value correctly', async () => {
      await db.setValue('test_key', 'test_value');
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('config:test_key', 'test_value');
    });

    it('should get a value correctly', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce('test_value');
      const val = await db.getValue('test_key');
      expect(mainKeyvInstance.get).toHaveBeenCalledWith('config:test_key');
      expect(val).toBe('test_value');
    });

    it('should delete a value correctly', async () => {
      await db.deleteValue('test_key');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('config:test_key');
    });
    
    it('should use in-memory cache for subsequent gets', async () => {
      mainKeyvInstance.get.mockResolvedValueOnce('cached_value');
      
      const val1 = await db.getValue('cache_key');
      expect(mainKeyvInstance.get).toHaveBeenCalledTimes(1);
      expect(val1).toBe('cached_value');
      
      const val2 = await db.getValue('cache_key');
      expect(mainKeyvInstance.get).toHaveBeenCalledTimes(1); // Should not be called again
      expect(val2).toBe('cached_value');
    });
  });

  describe('Mute Mode Tracking', () => {
    it('should add mute mode user', async () => {
      await db.addMuteModeUser('user123', 'testuser');
      expect(mainKeyvInstance.set).toHaveBeenCalledWith(
        'mute_mode:user123', 
        expect.objectContaining({
          userId: 'user123',
          username: 'testuser'
        })
      );
      // also adds to list
      expect(mainKeyvInstance.set).toHaveBeenCalledWith(
        'config:mute_mode_users',
        expect.arrayContaining(['user123'])
      );
    });

    it('should remove mute mode user', async () => {
      await db.removeMuteModeUser('user123');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('mute_mode:user123');
    });

    it('should get user join time', async () => {
      const now = dayjs().toISOString();
      mainKeyvInstance.get.mockResolvedValueOnce({ joinTime: now });
      const joinTime = await db.getUserJoinTime('user123');
      expect(joinTime).toBeInstanceOf(Date);
    });
  });

  describe('Spam Mode Tracking', () => {
    it('should add spam mode join time', async () => {
      const date = new Date();
      await db.addSpamModeJoinTime('user123', 'testuser', date);
      expect(mainKeyvInstance.set).toHaveBeenCalledWith(
        'spam_mode:user123',
        expect.objectContaining({
          userId: 'user123',
          username: 'testuser'
        })
      );
    });

    it('should remove spam mode join time', async () => {
      await db.removeSpamModeJoinTime('user123');
      expect(mainKeyvInstance.delete).toHaveBeenCalledWith('spam_mode:user123');
    });
  });

  describe('Invite Tracking', () => {
    it('should set invite tag', async () => {
      await db.setInviteTag('MyTag', { code: 'abc' });
      // should lowercase the tag
      expect(inviteKeyvInstance.set).toHaveBeenCalledWith('tags:mytag', { code: 'abc' });
    });

    it('should get invite tag', async () => {
      await db.getInviteTag('MyTag');
      expect(inviteKeyvInstance.get).toHaveBeenCalledWith('tags:mytag');
    });

    it('should get and set invite notification channel', async () => {
      await db.setInviteNotificationChannel('channel123');
      expect(mainKeyvInstance.set).toHaveBeenCalledWith('config:invite_notification_channel', 'channel123');

      mainKeyvInstance.get.mockResolvedValueOnce('channel123');
      const channel = await db.getInviteNotificationChannel();
      expect(channel).toBe('channel123');
    });
  });
});
