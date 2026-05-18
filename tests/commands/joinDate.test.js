const { createMockInteraction, createMockMember } = require('../testUtils');

describe('joinDate command', () => {
  let joinDateCommand;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({ baseEmbedColor: 0x123456 }));

    joinDateCommand = require('../../commands/joinDate');
  });

  describe('execute', () => {
    it('should show join date for self if no target user is provided', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.options.getUser.mockReturnValue(null); // falls back to interaction.user
      
      const mockTargetMember = createMockMember({
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        displayName: 'Test User Display',
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url')
      });
      mockInteraction.guild.members.cache.get = jest.fn().mockReturnValue(mockTargetMember);
      mockInteraction.user.createdAt = new Date('2025-01-01T00:00:00Z');

      await joinDateCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Test User Display');
      expect(embed.data.footer.text).toBe(`User ID: ${mockInteraction.user.id}`);
      expect(embed.data.color).toBe(0x123456);
    });

    it('should fetch user from API if not in cache', async () => {
      const mockInteraction = createMockInteraction();
      const mockUser = { id: 'target-456', username: 'target', createdAt: new Date('2025-01-01T00:00:00Z') };
      mockInteraction.options.getUser.mockReturnValue(mockUser);

      mockInteraction.guild.members.cache.get = jest.fn().mockReturnValue(null);
      const mockTargetMember = createMockMember({
        id: 'target-456',
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        displayName: 'Fetched Target User',
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url')
      });
      mockInteraction.guild.members.fetch = jest.fn().mockResolvedValue(mockTargetMember);

      await joinDateCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('target-456');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should return error message if target member cannot be found', async () => {
      const mockInteraction = createMockInteraction();
      const mockUser = { id: 'target-456', username: 'target' };
      mockInteraction.options.getUser.mockReturnValue(mockUser);

      mockInteraction.guild.members.cache.get = jest.fn().mockReturnValue(null);
      mockInteraction.guild.members.fetch = jest.fn().mockRejectedValue(new Error('not found'));

      await joinDateCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The specified user could not be found in this server.'
      }));
    });

    it('should return error message if joinedAt date is missing', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.options.getUser.mockReturnValue(null);

      const mockTargetMember = createMockMember({
        joinedAt: null,
        displayName: 'No Join Date User',
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url')
      });
      mockInteraction.guild.members.cache.get = jest.fn().mockReturnValue(mockTargetMember);

      await joinDateCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ Join date for this member isn't available."
      }));
    });

    it('should catch errors, log them, and send an unexpected error reply', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.options.getUser.mockReturnValue(null);
      mockInteraction.guild.members.cache.get = jest.fn().mockImplementation(() => {
        throw new Error('Simulation of unexpected failure');
      });

      await joinDateCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in joinDate command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should handle editReply rejection in error catch block without throwing', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.options.getUser.mockReturnValue(null);
      mockInteraction.guild.members.cache.get = jest.fn().mockImplementation(() => {
        throw new Error('Simulation of unexpected failure');
      });
      mockInteraction.editReply.mockRejectedValue(new Error('Cannot send response'));

      await expect(joinDateCommand.execute(mockInteraction)).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply.', expect.any(Object));
    });

    it('should fall back to username and default embed color if displayName and config color are missing', async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => ({ baseEmbedColor: undefined }));
      const newJoinDateCommand = require('../../commands/joinDate');

      const mockInteraction = createMockInteraction();
      mockInteraction.options.getUser.mockReturnValue(null);
      mockInteraction.user.username = 'target_username';
      
      const mockTargetMember = createMockMember({
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        displayName: null,
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url')
      });
      mockInteraction.guild.members.cache.get = jest.fn().mockReturnValue(mockTargetMember);
      mockInteraction.user.createdAt = new Date('2025-01-01T00:00:00Z');

      await newJoinDateCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('target_username');
      expect(embed.data.color).toBe(0);
    });
  });
});
