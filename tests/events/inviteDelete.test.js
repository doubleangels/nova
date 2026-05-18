const { createMockGuild } = require('../testUtils');

describe('inviteDelete event', () => {
  let inviteDeleteEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockInstrument = {
      captureError: jest.fn()
    };
    jest.doMock('../../instrument', () => mockInstrument);

    mockDatabase = {
      getInviteUsage: jest.fn(),
      setInviteUsage: jest.fn(),
      getInviteCodeToTagMap: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    inviteDeleteEvent = require('../../events/inviteDelete');
  });

  it('should skip invite tracking cleanup if bot lacks ManageGuild permission', async () => {
    const mockGuild = createMockGuild({ id: 'guild-1' });
    mockGuild.members = {
      me: {
        permissions: {
          has: jest.fn().mockReturnValue(false)
        }
      }
    };

    const mockInvite = {
      code: 'code123',
      guild: mockGuild
    };

    await inviteDeleteEvent.execute(mockInvite);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Bot does not have ManageGuild permission, skipping invite tracking cleanup.'
    );
    expect(mockDatabase.getInviteCodeToTagMap).not.toHaveBeenCalled();
  });

  it('should skip invite tracking cleanup if deleted invite is not tagged', async () => {
    const mockGuild = createMockGuild({ id: 'guild-1' });
    mockGuild.members = {
      me: {
        permissions: {
          has: jest.fn().mockReturnValue(true)
        }
      }
    };

    const mockInvite = {
      code: 'unrelated',
      guild: mockGuild
    };

    mockDatabase.getInviteCodeToTagMap.mockResolvedValue({});

    await inviteDeleteEvent.execute(mockInvite);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Deleted invite is not tagged, skipping cleanup.'),
      expect.any(Object)
    );
    expect(mockDatabase.getInviteUsage).not.toHaveBeenCalled();
  });

  it('should delete tagged invite from usage tracking if found', async () => {
    const mockGuild = createMockGuild({ id: 'guild-1' });
    mockGuild.members = {
      me: {
        permissions: {
          has: jest.fn().mockReturnValue(true)
        }
      }
    };

    const mockInvite = {
      code: 'mycode',
      guild: mockGuild
    };

    mockDatabase.getInviteCodeToTagMap.mockResolvedValue({
      'mycode': 'mytag'
    });
    mockDatabase.getInviteUsage.mockResolvedValue({
      'oldcode': 1,
      'mycode': 3
    });

    await inviteDeleteEvent.execute(mockInvite);

    expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-1', {
      'oldcode': 1
    });
  });

  it('should log debug if deleted tagged invite was not found in usage tracking', async () => {
    const mockGuild = createMockGuild({ id: 'guild-1' });
    mockGuild.members = {
      me: {
        permissions: {
          has: jest.fn().mockReturnValue(true)
        }
      }
    };

    const mockInvite = {
      code: 'mycode',
      guild: mockGuild
    };

    mockDatabase.getInviteCodeToTagMap.mockResolvedValue({
      'mycode': 'mytag'
    });
    mockDatabase.getInviteUsage.mockResolvedValue({
      'oldcode': 1
    });

    await inviteDeleteEvent.execute(mockInvite);

    expect(mockDatabase.setInviteUsage).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Deleted tagged invite was not in usage tracking'),
      expect.any(Object)
    );
  });

  it('should capture errors and not throw', async () => {
    const mockGuild = createMockGuild({ id: 'guild-1' });
    mockGuild.members = {
      me: {
        permissions: {
          has: jest.fn().mockReturnValue(true)
        }
      }
    };

    const mockInvite = {
      code: 'mycode',
      guild: mockGuild
    };

    mockDatabase.getInviteCodeToTagMap.mockRejectedValue(new Error('DB failure'));

    await expect(inviteDeleteEvent.execute(mockInvite)).resolves.not.toThrow();

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
