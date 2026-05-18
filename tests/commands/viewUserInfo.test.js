const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

let mockConfig = {
  baseEmbedColor: 0x112233,
  permissionBenchmarkRoleId: 'diff-role-id'
};
jest.mock('../../config', () => mockConfig);

let mockDatabase = {
  isFormerMember: jest.fn()
};
jest.mock('../../utils/database', () => mockDatabase);

describe('viewUserInfo command', () => {
  let viewUserInfoCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.baseEmbedColor = 0x112233;
    mockConfig.permissionBenchmarkRoleId = 'diff-role-id';
    viewUserInfoCommand = require('../../commands/viewUserInfo');
  });

  describe('execute', () => {
    it('should show user info successfully with cached member, returning status, timeout, booster, and extra permissions', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-1',
        username: 'targetuser1',
        globalName: 'Target User 1 Global',
        bot: false,
        createdAt: new Date('2026-05-18T10:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global')
      };

      const mockMember = {
        displayName: 'Target Server Nick',
        avatar: 'server-avatar-hash',
        joinedAt: new Date('2026-05-18T12:00:00Z'),
        communicationDisabledUntilTimestamp: Date.now() + 60000,
        premiumSince: new Date('2026-05-18T13:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/server'),
        permissions: {
          toArray: jest.fn().mockReturnValue(['KickMembers', 'BanMembers', 'ManageMessages'])
        },
        guild: {
          roles: {
            cache: {
              get: jest.fn().mockReturnValue({
                permissions: {
                  has: jest.fn().mockImplementation((perm) => perm === 'ManageMessages')
                }
              })
            }
          }
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockMember)
          },
          fetch: jest.fn()
        }
      };

      mockDatabase.isFormerMember.mockResolvedValue(true);

      await viewUserInfoCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
      expect(mockInteraction.guild.members.cache.get).toHaveBeenCalledWith('user-id-1');
      expect(mockInteraction.guild.members.fetch).not.toHaveBeenCalled();
      expect(mockDatabase.isFormerMember).toHaveBeenCalledWith('user-id-1');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Target Server Nick');
      expect(embed.data.author.icon_url).toBe('http://avatar.url/server');
      expect(embed.data.image.url).toBe('http://avatar.url/server');
      expect(embed.data.color).toBe(0x112233);

      // Check fields
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Returning', value: 'Yes' }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Bot', value: 'No' }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Timeout' }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Booster' }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Permissions',
        value: '**Extra:** Ban Members, Kick Members'
      }));
    });

    it('should fall back to fetching member if not cached, and handle returning = false, no timeout/booster/diffRole', async () => {
      mockConfig.permissionBenchmarkRoleId = null;
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-2',
        username: 'targetuser2',
        globalName: null,
        bot: true,
        createdAt: new Date('2026-05-18T10:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global2')
      };

      const mockMember = {
        displayName: 'Target Nick 2',
        avatar: null, // no server avatar
        joinedAt: new Date('2026-05-18T12:00:00Z'),
        communicationDisabledUntilTimestamp: null,
        premiumSince: null,
        displayAvatarURL: jest.fn()
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(undefined)
          },
          fetch: jest.fn().mockResolvedValue(mockMember)
        }
      };

      mockDatabase.isFormerMember.mockResolvedValue(false);

      await viewUserInfoCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('user-id-2');
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Target Nick 2');
      expect(embed.data.author.icon_url).toBe('http://avatar.url/global2'); // server avatar is null, fall back to global
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Returning', value: 'No' }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Bot', value: 'Yes' }));
      expect(embed.data.fields.some(f => f.name === 'Timeout')).toBe(false);
      expect(embed.data.fields.some(f => f.name === 'Booster')).toBe(false);
      expect(embed.data.fields.some(f => f.name === 'Permissions')).toBe(false);
    });

    it('should handle member fetch failure (rejection) correctly to cover .catch(() => null) and null member branch', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-9',
        username: 'targetuser9',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global9')
      };

      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockRejectedValue(new Error('Fetch failed'))
        }
      };
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await viewUserInfoCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('user-id-9');
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields.some(f => f.name === 'Joined')).toBe(false);
    });

    it('should handle when extra permissions list is empty (extraPermissions.length === 0) to cover line 111 false branch', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-10',
        username: 'targetuser10',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global10')
      };

      const mockMember = {
        displayName: 'Target Nick 10',
        joinedAt: new Date(),
        displayAvatarURL: jest.fn(),
        permissions: {
          toArray: jest.fn().mockReturnValue(['ManageMessages'])
        },
        guild: {
          roles: {
            cache: {
              get: jest.fn().mockReturnValue({
                permissions: {
                  has: jest.fn().mockImplementation((perm) => perm === 'ManageMessages')
                }
              })
            }
          }
        }
      };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember }
        }
      };
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await viewUserInfoCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields.some(f => f.name === 'Permissions')).toBe(false);
    });

    it('should handle isFormerMember returning non-boolean value', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-3',
        username: 'targetuser3',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global3')
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockResolvedValue(null)
        }
      };

      mockDatabase.isFormerMember.mockResolvedValue(null);

      await viewUserInfoCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Returning', value: '—' }));
    });

    it('should handle isFormerMember database exceptions gracefully', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-4',
        username: 'targetuser4',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global4')
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockResolvedValue(null)
        }
      };

      mockDatabase.isFormerMember.mockRejectedValue(new Error('Database offline'));

      await viewUserInfoCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to check returning status from database in View User Information.',
        expect.any(Object)
      );
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields).toContainEqual(expect.objectContaining({ name: 'Returning', value: '—' }));
    });

    it('should use default embed color 0 if baseEmbedColor is missing', async () => {
      mockConfig.baseEmbedColor = undefined;

      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-5',
        username: 'targetuser5',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global5')
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockResolvedValue(null)
        }
      };
      mockDatabase.isFormerMember.mockResolvedValue(true);

      await viewUserInfoCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should handle when targetUser globalName is used when displayName is missing', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-6',
        username: 'targetuser6',
        globalName: 'Global Tag 6',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global6')
      };
      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockResolvedValue(null)
        }
      };
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await viewUserInfoCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Global Tag 6');
    });

    it('should catch error and send unexpected error reply', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-7',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global7')
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

      await viewUserInfoCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in View User Information context menu command.',
        expect.any(Object)
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should catch error and log to logger if editReply inside catch also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetUser = {
        id: 'user-id-8',
        createdAt: new Date(),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/global8')
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

      await expect(viewUserInfoCommand.execute(mockInteraction)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply.', expect.any(Object));
    });
  });
});
