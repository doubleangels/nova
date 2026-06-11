const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('predictionRemoveUserCommand', () => {
  let removeUserCommand;
  let mockLogger;
  let removeFromGames;

  const emptySummary = {
    hadData: false,
    wasRegistered: false,
    predictionCount: 0,
    pendingCount: 0,
    points: 0
  };

  beforeEach(() => {
    jest.resetModules();
    mockLogger = { info: jest.fn(), error: jest.fn() };
    removeFromGames = jest.fn().mockResolvedValue({
      worldcup: { ...emptySummary, hadData: true, wasRegistered: true, predictionCount: 2, points: 5 },
      football: { ...emptySummary, hadData: true, predictionCount: 1, points: 3 }
    });
    removeUserCommand = require('../../utils/predictionRemoveUserCommand');
  });

  it('should require a guild', async () => {
    const interaction = createMockInteraction({
      guild: null,
      memberPermissions: {
        has: jest.fn(p => p === PermissionFlagsBits.Administrator)
      },
      options: {
        getString: jest.fn().mockReturnValue('123456789012345678')
      }
    });

    await removeUserCommand.handleRemoveUserSubcommand(interaction, {
      removeFromGames,
      logger: mockLogger
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('server')
    }));
    expect(removeFromGames).not.toHaveBeenCalled();
  });

  it('should deny non-administrators', async () => {
    const interaction = createMockInteraction({
      guild: { id: 'guild-1' },
      memberPermissions: { has: jest.fn().mockReturnValue(false) },
      options: {
        getString: jest.fn().mockReturnValue('123456789012345678')
      }
    });

    await removeUserCommand.handleRemoveUserSubcommand(interaction, {
      removeFromGames,
      logger: mockLogger
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('administrators')
    }));
    expect(removeFromGames).not.toHaveBeenCalled();
  });

  it('should reject invalid user IDs', async () => {
    const interaction = createMockInteraction({
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(p => p === PermissionFlagsBits.Administrator)
      },
      options: {
        getString: jest.fn().mockReturnValue('not-a-snowflake')
      }
    });

    await removeUserCommand.handleRemoveUserSubcommand(interaction, {
      removeFromGames,
      logger: mockLogger
    });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('valid Discord user ID')
    }));
    expect(removeFromGames).not.toHaveBeenCalled();
  });

  it('should reply when no prediction data exists for the user', async () => {
    removeFromGames.mockResolvedValue({
      worldcup: emptySummary,
      football: emptySummary
    });

    const interaction = createMockInteraction({
      guild: { id: 'guild-1' },
      user: { id: 'admin-1' },
      memberPermissions: {
        has: jest.fn(p => p === PermissionFlagsBits.Administrator)
      },
      options: {
        getString: jest.fn().mockReturnValue('123456789012345678')
      }
    });

    await removeUserCommand.handleRemoveUserSubcommand(interaction, {
      removeFromGames,
      logger: mockLogger
    });

    expect(removeFromGames).toHaveBeenCalledWith('123456789012345678');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No World Cup or club football prediction data found')
    }));
  });

  it('should remove user data and reply with a summary embed', async () => {
    const interaction = createMockInteraction({
      guild: { id: 'guild-1' },
      user: { id: 'admin-1' },
      memberPermissions: {
        has: jest.fn(p => p === PermissionFlagsBits.Administrator)
      },
      options: {
        getString: jest.fn().mockReturnValue('123456789012345678')
      }
    });

    await removeUserCommand.handleRemoveUserSubcommand(interaction, {
      removeFromGames,
      logger: mockLogger
    });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(removeFromGames).toHaveBeenCalledWith('123456789012345678');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Prediction User Removed' })
        })
      ])
    }));
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Prediction user removed by administrator.',
      expect.objectContaining({
        adminUserId: 'admin-1',
        targetUserId: '123456789012345678'
      })
    );
  });
});
