const { createMockInteraction } = require('../testUtils');
const { PermissionFlagsBits } = require('discord.js');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

let mockConfig = {
  baseEmbedColor: 0x223344
};
jest.mock('../../config', () => mockConfig);

const mockSearchUtils = {
  createPaginatedResults: jest.fn()
};
jest.mock('../../utils/searchUtils', () => mockSearchUtils);

describe('audit command', () => {
  let auditCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.baseEmbedColor = 0x223344;
    auditCommand = require('../../commands/audit');
  });

  describe('execute', () => {
    it('should reply with error if used outside a server (guild is null)', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.guild = null;

      await auditCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command can only be used in a server.'
      }));
    });

    it('should audit admins successfully (subcommand admin) including bots, and render a single page', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true), // include-bots
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      // Mock members
      const mockAdminUser = { id: 'admin-id', username: 'adminuser', bot: false };
      const mockAdminBot = { id: 'bot-id', username: 'adminbot', bot: true };
      const mockNormalUser = { id: 'normal-id', username: 'normaluser', bot: false };

      const mockAdminMember = {
        displayName: 'Admin Nick',
        user: mockAdminUser,
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
          any: jest.fn().mockReturnValue(false)
        }
      };

      const mockAdminBotMember = {
        displayName: 'Admin Bot Nick',
        user: mockAdminBot,
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
          any: jest.fn().mockReturnValue(false)
        }
      };

      const mockNormalMember = {
        displayName: null,
        user: mockNormalUser,
        permissions: {
          has: jest.fn().mockReturnValue(false),
          any: jest.fn().mockReturnValue(false)
        }
      };

      const mockMembers = new Map([
        ['admin-id', mockAdminMember],
        ['bot-id', mockAdminBotMember],
        ['normal-id', mockNormalMember]
      ]);

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalled();
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Permission Audit - Admins (2)');
      expect(embed.data.description).toBe('Members with the Administrator permission.');
      expect(embed.data.fields[0].value).toContain('**Admin Bot Nick**');
      expect(embed.data.fields[0].value).toContain('**Admin Nick**');
      expect(embed.data.color).toBe(0x223344);
    });

    it('should audit admins successfully but exclude bots by default (include-bots = false)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(undefined), // default to false
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      const mockAdminUser = { id: 'admin-id', username: 'adminuser', bot: false };
      const mockAdminBot = { id: 'bot-id', username: 'adminbot', bot: true };

      const mockAdminMember = {
        displayName: 'Admin Nick',
        user: mockAdminUser,
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
          any: jest.fn().mockReturnValue(false)
        }
      };

      const mockAdminBotMember = {
        displayName: 'Admin Bot Nick',
        user: mockAdminBot,
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
          any: jest.fn().mockReturnValue(false)
        }
      };

      const mockMembers = new Map([
        ['admin-id', mockAdminMember],
        ['bot-id', mockAdminBotMember]
      ]);

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields[0].value).toContain('**Admin Nick**');
      expect(embed.data.fields[0].value).not.toContain('**Admin Bot Nick**');
    });

    it('should audit moderators successfully (subcommand moderator) showing individual non-power mod permissions', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('moderator')
        }
      });

      // Mod with Administrator (should be filtered out from targetMembers in moderator subcommand)
      const mockAdminMember = {
        displayName: 'Admin Nick',
        user: { id: 'admin-id', username: 'adminuser', bot: false },
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
          any: jest.fn().mockReturnValue(true)
        }
      };

      // Mod with ManageMessages (non-power permission, should be listed)
      const mockModMember = {
        displayName: null, // should fall back to username
        user: { id: 'mod-id', username: 'moduser', bot: false },
        permissions: {
          has: jest.fn().mockImplementation((perm) => {
            if (perm === PermissionFlagsBits.Administrator) return false;
            if (perm === PermissionFlagsBits.ManageMessages) return true;
            return false;
          }),
          any: jest.fn().mockReturnValue(true)
        }
      };

      // Mod with ONLY BanMembers power permission (should be filtered out by buildPages because of excludePowerPerms)
      const mockPowerModMember = {
        displayName: 'Power Mod Nick',
        user: { id: 'power-id', username: 'powermod', bot: false },
        permissions: {
          has: jest.fn().mockImplementation((perm) => {
            if (perm === PermissionFlagsBits.Administrator) return false;
            if (perm === PermissionFlagsBits.BanMembers) return true;
            return false;
          }),
          any: jest.fn().mockReturnValue(true)
        }
      };

      const mockMembers = new Map([
        ['admin-id', mockAdminMember],
        ['mod-id', mockModMember],
        ['power-id', mockPowerModMember]
      ]);

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Permission Audit - Moderators (2)'); // mod-id and power-id are targetMembers
      expect(embed.data.fields[0].value).toContain('**moduser** — Manage Messages');
      expect(embed.data.fields[0].value).not.toContain('**Power Mod Nick**'); // power-id got filtered out of buildPages output
    });

    it('should list None if effectiveMembers in buildPages is empty', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('moderator')
        }
      });

      const mockMembers = new Map(); // empty

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields[0].value).toBe('None');
    });

    it('should audit kick permission successfully (subcommand kick)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('kick')
        }
      });

      const mockKickMember = {
        displayName: 'Kick Nick',
        user: { id: 'kick-id', username: 'kickuser', bot: false },
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.KickMembers),
          any: jest.fn().mockReturnValue(true)
        }
      };

      const mockMembers = new Map([['kick-id', mockKickMember]]);

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Permission Audit - Members who can kick (1)');
      expect(embed.data.fields[0].value).toBe('**Kick Nick**');
    });

    it('should audit ban permission successfully (subcommand ban)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('ban')
        }
      });

      const mockBanMember = {
        displayName: 'Ban Nick',
        user: { id: 'ban-id', username: 'banuser', bot: false },
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.BanMembers),
          any: jest.fn().mockReturnValue(true)
        }
      };

      const mockMembers = new Map([['ban-id', mockBanMember]]);

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Permission Audit - Members who can ban (1)');
      expect(embed.data.fields[0].value).toBe('**Ban Nick**');
    });

    it('should handle unknown subcommand correctly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('invalid-subcommand')
        }
      });

      mockInteraction.guild = {
        members: { fetch: jest.fn().mockResolvedValue(new Map()) }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Unknown subcommand.'
      }));
    });

    it('should use default embed color 0 if baseEmbedColor is missing', async () => {
      mockConfig.baseEmbedColor = undefined;

      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      mockInteraction.guild = {
        members: { fetch: jest.fn().mockResolvedValue(new Map()) }
      };

      await auditCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should split members into multiple pages if counts exceed 25 members or 900 character limit, calling createPaginatedResults', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      // Generate 26 members to trigger pagination page splits
      const mockMembers = new Map();
      for (let i = 1; i <= 26; i++) {
        const userId = `user-${i}`;
        const mockMember = {
          displayName: `Member ${i}`,
          user: { id: userId, username: `user_${i}`, bot: false },
          permissions: {
            has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
            any: jest.fn().mockReturnValue(false)
          }
        };
        mockMembers.set(userId, mockMember);
      }

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      // Verify that createPaginatedResults was called instead of simple editReply
      expect(mockSearchUtils.createPaginatedResults).toHaveBeenCalled();
      const pagesArg = mockSearchUtils.createPaginatedResults.mock.calls[0][1];
      expect(pagesArg.length).toBe(2); // Page 1 (25 members), Page 2 (1 member)
    });

    it('should split members into multiple pages if page length exceeds 900 characters', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      // Generate 5 members with extremely long names to trigger 900 character limit page split
      const mockMembers = new Map();
      for (let i = 1; i <= 5; i++) {
        const userId = `user-${i}`;
        const mockMember = {
          displayName: `SuperLongDisplayNameThatWillExceedSafePaginationLimitsAndTriggerPageSplitting`.repeat(4) + ` ${i}`,
          user: { id: userId, username: `user_${i}`, bot: false },
          permissions: {
            has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.Administrator),
            any: jest.fn().mockReturnValue(false)
          }
        };
        mockMembers.set(userId, mockMember);
      }

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMembers)
        }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockSearchUtils.createPaginatedResults).toHaveBeenCalled();
      const pagesArg = mockSearchUtils.createPaginatedResults.mock.calls[0][1];
      expect(pagesArg.length).toBeGreaterThan(1);
    });

    it('should catch GatewayRateLimitError and reply with custom retry time', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      const rateLimitError = new Error('Gateway rate limit exceeded');
      rateLimitError.name = 'GatewayRateLimitError';
      rateLimitError.data = { retry_after: 42.5 };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockRejectedValue(rateLimitError)
        }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Discord is temporarily rate limiting member lookups. Please try again in about 43 seconds.'
      }));
    });

    it('should catch GatewayRateLimitError and reply with custom retry time from retry_after field directly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      const rateLimitError = new Error('Gateway rate limit exceeded');
      rateLimitError.name = 'GatewayRateLimitError';
      rateLimitError.retry_after = 15.2; // directly on error object, no .data

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockRejectedValue(rateLimitError)
        }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Discord is temporarily rate limiting member lookups. Please try again in about 16 seconds.'
      }));
    });

    it('should catch GatewayRateLimitError and fallback to 10 seconds if no retry_after information is provided', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      const rateLimitError = new Error('Gateway rate limit exceeded');
      rateLimitError.name = 'GatewayRateLimitError';

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockRejectedValue(rateLimitError)
        }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Discord is temporarily rate limiting member lookups. Please try again in about 10 seconds.'
      }));
    });

    it('should catch generic error and reply with generic error message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockRejectedValue(new Error('Generic failure'))
        }
      };

      await auditCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in audit command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while auditing permissions. Please try again later.'
      }));
    });

    it('should catch error and log if editReply inside catch block fails', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getSubcommand: jest.fn().mockReturnValue('admin')
        }
      });

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockRejectedValue(new Error('Generic failure'))
        }
      };
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await expect(auditCommand.execute(mockInteraction)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply for audit command.', expect.any(Object));
    });
  });
});
