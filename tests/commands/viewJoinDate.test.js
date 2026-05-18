const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

let mockConfig = {
  baseEmbedColor: 0xffaacc
};
jest.mock('../../config', () => mockConfig);

describe('viewJoinDate command', () => {
  let viewJoinDateCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.baseEmbedColor = 0xffaacc;
    viewJoinDateCommand = require('../../commands/viewJoinDate');
  });

  describe('execute', () => {
    it('should view join date successfully using cached member', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-1',
        username: 'targetuser',
        createdAt: new Date('2026-05-18T10:00:00Z')
      };

      const mockMember = {
        displayName: 'Target Nickname',
        joinedAt: new Date('2026-05-18T12:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/cached')
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockMember)
          },
          fetch: jest.fn()
        }
      };

      await viewJoinDateCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
      expect(mockInteraction.guild.members.cache.get).toHaveBeenCalledWith('user-1');
      expect(mockInteraction.guild.members.fetch).not.toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Target Nickname');
      expect(embed.data.author.icon_url).toBe('http://avatar.url/cached');
      expect(embed.data.color).toBe(0xffaacc);
      expect(embed.data.description).toBe('Join date for **Target Nickname**.');
      expect(embed.data.footer.text).toBe('User ID: user-1');
    });

    it('should fall back to fetching member if not in cache', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-2',
        username: 'targetuser',
        createdAt: new Date('2026-05-18T10:00:00Z')
      };

      const mockMember = {
        displayName: null,
        joinedAt: new Date('2026-05-18T12:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/fetched')
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(undefined)
          },
          fetch: jest.fn().mockResolvedValue(mockMember)
        }
      };

      await viewJoinDateCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('user-2');
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('targetuser'); // displayName fallback
    });

    it('should use default embed color 0 if baseEmbedColor is missing', async () => {
      mockConfig.baseEmbedColor = undefined;

      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-3',
        username: 'targetuser3',
        createdAt: new Date()
      };
      const mockMember = {
        displayName: 'Target Nickname 3',
        joinedAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/fetched3')
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember }
        }
      };

      await viewJoinDateCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should return error if member is not found in cache and fetch fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-4',
        createdAt: new Date()
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockRejectedValue(new Error('fetch failed'))
        }
      };

      await viewJoinDateCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The specified user could not be found in this server.'
      }));
    });

    it('should return error if member has no joinedAt date', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-5',
        createdAt: new Date()
      };
      const mockMember = {
        joinedAt: null,
        displayAvatarURL: jest.fn()
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember }
        }
      };

      await viewJoinDateCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ Join date for this member isn't available."
      }));
    });

    it('should catch error and send unexpected error reply', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-6',
        createdAt: new Date()
      };
      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockImplementation(() => {
              throw new Error('Simulated cache error');
            })
          }
        }
      };

      await viewJoinDateCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in View Join Date context menu command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should catch error and log to logger if editReply inside catch also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-7',
        createdAt: new Date()
      };
      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockImplementation(() => {
              throw new Error('Simulated cache error');
            })
          }
        }
      };
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await expect(viewJoinDateCommand.execute(mockInteraction)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply.', expect.any(Object));
    });
  });
});
