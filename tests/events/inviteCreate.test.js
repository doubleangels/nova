const { createMockGuild } = require('../testUtils');

describe('inviteCreate event', () => {
  let inviteCreateEvent;
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

    inviteCreateEvent = require('../../events/inviteCreate');
  });

  it('should skip invite tracking if bot lacks ManageGuild permission', async () => {
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
      guild: mockGuild,
      inviter: { id: 'user-1' },
      maxUses: 0,
      maxAge: 0,
      uses: 0
    };

    await inviteCreateEvent.execute(mockInvite);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Bot does not have ManageGuild permission, skipping invite tracking update.'
    );
    expect(mockDatabase.getInviteCodeToTagMap).not.toHaveBeenCalled();
  });

  it('should skip invite tracking if invite is not in code-to-tag map', async () => {
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
      guild: mockGuild,
      inviter: { id: 'user-1' },
      maxUses: 0,
      maxAge: 0,
      uses: 0
    };

    mockDatabase.getInviteCodeToTagMap.mockResolvedValue({});

    await inviteCreateEvent.execute(mockInvite);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Invite is not tagged, skipping tracking.'),
      expect.any(Object)
    );
    expect(mockDatabase.getInviteUsage).not.toHaveBeenCalled();
  });

  it('should add tagged invite to usage tracking', async () => {
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
      guild: mockGuild,
      inviter: { id: 'user-1' },
      maxUses: 5,
      maxAge: 3600,
      uses: 2
    };

    mockDatabase.getInviteCodeToTagMap.mockResolvedValue({
      'mycode': 'mytag'
    });
    mockDatabase.getInviteUsage.mockResolvedValue({
      'oldcode': 1
    });

    await inviteCreateEvent.execute(mockInvite);

    expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-1', {
      'oldcode': 1,
      'mycode': 2
    });
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
      guild: mockGuild,
      inviter: { id: 'user-1' }
    };

    mockDatabase.getInviteCodeToTagMap.mockRejectedValue(new Error('DB failure'));

    await expect(inviteCreateEvent.execute(mockInvite)).resolves.not.toThrow();

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
