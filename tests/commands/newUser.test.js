const { createMockInteraction, createMockMember } = require('../testUtils');

describe('newUser command', () => {
  let newUserCommand;
  let mockDatabase;
  let mockLogger;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockConfig = {
      permissionBenchmarkRoleId: 'diff-role-123',
      baseEmbedColor: '#c03728'
    };
    jest.doMock('../../config', () => mockConfig);

    mockDatabase = {
      isFormerMember: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    newUserCommand = require('../../commands/newUser');
  });

  describe('execute', () => {
    it('should show user profile details and fetch member from cache', async () => {
      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        globalName: 'Target User',
        bot: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      const mockMember = createMockMember({
        displayName: 'Target Display Name',
        joinedAt: new Date('2025-02-01T00:00:00Z'),
        communicationDisabledUntilTimestamp: null,
        premiumSince: null,
        permissions: {
          toArray: jest.fn().mockReturnValue(['KickMembers', 'BanMembers'])
        },
        guild: {
          roles: {
            cache: {
              get: jest.fn().mockReturnValue({
                permissions: {
                  has: jest.fn().mockReturnValue(false)
                }
              })
            }
          }
        }
      });

      mockInteraction.guild.members.cache.set(targetUser.id, mockMember);
      mockDatabase.isFormerMember.mockResolvedValue(true);

      await newUserCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      expect(mockInteraction.editReply).toHaveBeenCalled();

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Target Display Name');
      expect(embed.data.image.url).toBe('http://avatar.link');

      const returningField = embed.data.fields.find(f => f.name === 'Returning');
      expect(returningField.value).toBe('Yes');

      const permField = embed.data.fields.find(f => f.name === 'Permissions');
      expect(permField.value).toBe('**Extra:** Ban Members, Kick Members');
    });

    it('should show Bot Yes and skip extra permissions when member matches benchmark role', async () => {
      const targetUser = {
        id: 'bot-123',
        username: 'botuser',
        bot: true,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      const mockMember = createMockMember({
        permissions: {
          toArray: jest.fn().mockReturnValue(['KickMembers'])
        },
        guild: {
          roles: {
            cache: {
              get: jest.fn().mockReturnValue({
                permissions: {
                  has: jest.fn().mockReturnValue(true)
                }
              })
            }
          }
        }
      });

      mockInteraction.guild.members.cache.set(targetUser.id, mockMember);
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await newUserCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields.find(f => f.name === 'Bot').value).toBe('Yes');
      expect(embed.data.fields.find(f => f.name === 'Permissions')).toBeUndefined();
    });

    it('should omit permissions field when benchmark role is not configured', async () => {
      mockConfig.permissionBenchmarkRoleId = null;
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => mockConfig);
      jest.doMock('../../utils/database', () => mockDatabase);
      const cmd = require('../../commands/newUser');

      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        bot: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      const mockMember = createMockMember({
        permissions: { toArray: jest.fn().mockReturnValue(['KickMembers']) },
        guild: { roles: { cache: { get: jest.fn() } } }
      });

      mockInteraction.guild.members.cache.set(targetUser.id, mockMember);
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await cmd.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields.find(f => f.name === 'Permissions')).toBeUndefined();
    });

    it('should fetch target member when not in cache', async () => {
      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        bot: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      const mockMember = createMockMember({
        avatar: 'server-avatar-hash',
        displayAvatarURL: jest.fn().mockReturnValue('http://server-avatar.link'),
        joinedAt: null,
        communicationDisabledUntilTimestamp: Date.now() + 50000,
        premiumSince: new Date('2025-03-01T00:00:00Z'),
        permissions: {
          toArray: jest.fn().mockReturnValue([])
        },
        guild: {
          roles: {
            cache: {
              get: jest.fn().mockReturnValue(null)
            }
          }
        }
      });

      mockInteraction.guild.members.cache.clear();
      mockInteraction.guild.members.fetch = jest.fn().mockResolvedValue(mockMember);
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await newUserCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith(targetUser.id);
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const returningField = embed.data.fields.find(f => f.name === 'Returning');
      expect(returningField.value).toBe('No');
    });

    it('should use default embed color when baseEmbedColor is unset', async () => {
      mockConfig.baseEmbedColor = undefined;
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => mockConfig);
      jest.doMock('../../utils/database', () => mockDatabase);
      const cmd = require('../../commands/newUser');

      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        bot: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        options: { getUser: jest.fn().mockReturnValue(targetUser) }
      });

      mockInteraction.guild.members.cache.set(
        targetUser.id,
        createMockMember({ guild: { roles: { cache: { get: jest.fn() } } } })
      );
      mockDatabase.isFormerMember.mockResolvedValue(false);

      await cmd.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should work when guild is null', async () => {
      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        globalName: 'Target User',
        bot: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        guild: null,
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      mockDatabase.isFormerMember.mockResolvedValue(null);

      await newUserCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.author.name).toBe('Target User');
      const returningField = embed.data.fields.find(f => f.name === 'Returning');
      expect(returningField.value).toBe('—');
    });

    it('should handle database errors gracefully and set Returning to —', async () => {
      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      mockInteraction.guild.members.cache.clear();
      mockInteraction.guild.members.fetch = jest.fn().mockRejectedValue(new Error('no member'));
      mockDatabase.isFormerMember.mockRejectedValue(new Error('db error'));

      await newUserCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const returningField = embed.data.fields.find(f => f.name === 'Returning');
      expect(returningField.value).toBe('—');
    });

    it('should catch errors and call editReply with error message', async () => {
      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockImplementation(() => {
          throw new Error('Some execution error');
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });

      await newUserCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should log an error if editReply throws an error inside execute catch block', async () => {
      const targetUser = {
        id: 'target-123',
        username: 'targetuser',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        displayAvatarURL: jest.fn().mockImplementation(() => {
          throw new Error('Some execution error');
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(targetUser)
        }
      });
      mockInteraction.editReply.mockRejectedValue(new Error('Discord connection dropped'));

      await newUserCommand.execute(mockInteraction);

      // Cover lines 168-174
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply.', expect.any(Object));
    });
  });
});
