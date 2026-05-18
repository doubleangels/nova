describe('guildMemberRemove event', () => {
  let guildMemberRemoveEvent;
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
      removeMuteModeUser: jest.fn(),
      removeSpamModeJoinTime: jest.fn(),
      setFormerMember: jest.fn(),
      deleteMessageCount: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    guildMemberRemoveEvent = require('../../events/guildMemberRemove');
  });

  it('should skip tracking removal if leaving member is a bot', async () => {
    const mockMember = {
      id: 'bot-123',
      user: {
        bot: true,
        tag: 'SomeBot#9999'
      }
    };

    await guildMemberRemoveEvent.execute(mockMember);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Bot member left the guild, skipping tracking removal.',
      expect.any(Object)
    );
    expect(mockDatabase.removeMuteModeUser).not.toHaveBeenCalled();
  });

  it('should successfully process member departure', async () => {
    const mockMember = {
      id: 'user-123',
      user: {
        bot: false,
        tag: 'User#1234'
      }
    };

    mockDatabase.removeMuteModeUser.mockResolvedValue();
    mockDatabase.removeSpamModeJoinTime.mockResolvedValue();
    mockDatabase.setFormerMember.mockResolvedValue();
    mockDatabase.deleteMessageCount.mockResolvedValue();

    await guildMemberRemoveEvent.execute(mockMember);

    expect(mockDatabase.removeMuteModeUser).toHaveBeenCalledWith('user-123');
    expect(mockDatabase.removeSpamModeJoinTime).toHaveBeenCalledWith('user-123');
    expect(mockDatabase.setFormerMember).toHaveBeenCalledWith('user-123');
    expect(mockDatabase.deleteMessageCount).toHaveBeenCalledWith('user-123');

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Successfully processed member departure.',
      expect.any(Object)
    );
  });

  it('should catch database errors and not throw', async () => {
    const mockMember = {
      id: 'user-123',
      user: {
        bot: false,
        tag: 'User#1234'
      }
    };

    mockDatabase.removeMuteModeUser.mockRejectedValue(new Error('DB fail'));

    await expect(guildMemberRemoveEvent.execute(mockMember)).resolves.not.toThrow();

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
