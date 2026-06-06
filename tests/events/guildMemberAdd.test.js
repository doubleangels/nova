const { Collection, EmbedBuilder } = require('discord.js');

describe('guildMemberAdd event', () => {
  let guildMemberAddEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;
  let mockMuteModeUtils;
  let mockTrollModeUtils;
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

    mockInstrument = {
      captureError: jest.fn()
    };
    jest.doMock('../../instrument', () => mockInstrument);

    mockDatabase = {
      getValue: jest.fn(),
      addMuteModeUser: jest.fn(),
      addSpamModeJoinTime: jest.fn(),
      getInviteUsage: jest.fn(),
      setInviteUsage: jest.fn().mockResolvedValue(),
      getInviteNotificationChannel: jest.fn(),
      getInviteTag: jest.fn(),
      getInviteCodeToTagMap: jest.fn(),
      rebuildCodeToTagMap: jest.fn(),
      isFormerMember: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockMuteModeUtils = {
      scheduleMuteKick: jest.fn()
    };
    jest.doMock('../../utils/muteModeUtils', () => mockMuteModeUtils);

    mockTrollModeUtils = {
      checkAccountAge: jest.fn(),
      performKick: jest.fn()
    };
    jest.doMock('../../utils/trollModeUtils', () => mockTrollModeUtils);

    mockConfig = {
      returningMemberRoleId: 'returning-role',
      newMemberRoleId: 'noobie-role',
      memberFrenRoleId: 'fren-role',
      baseEmbedColor: 0xff0000
    };
    jest.doMock('../../config', () => mockConfig);

    jest.doMock('../../utils/inviteInitGate', () => ({
      waitForInviteInit: jest.fn().mockResolvedValue()
    }));

    guildMemberAddEvent = require('../../events/guildMemberAdd');
  });

  describe('execute', () => {
    it('should ignore early if the joining member is a bot', async () => {
      const mockMember = {
        user: { bot: true, tag: 'Bot#1234' }
      };

      await guildMemberAddEvent.execute(mockMember);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Bot joined the guild, skipping mute mode tracking.'),
        expect.any(Object)
      );
      expect(mockTrollModeUtils.checkAccountAge).not.toHaveBeenCalled();
    });

    it('should kick member if trollMode account age requirement is not met', async () => {
      const mockMember = {
        user: { bot: false, tag: 'User#1234' }
      };
      mockTrollModeUtils.checkAccountAge.mockResolvedValue(false);
      mockTrollModeUtils.performKick.mockResolvedValue();

      await guildMemberAddEvent.execute(mockMember);

      expect(mockTrollModeUtils.performKick).toHaveBeenCalledWith(mockMember);
      expect(mockDatabase.addMuteModeUser).not.toHaveBeenCalled();
    });

    it('should process new member joins, add to database, and schedule mute kick', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return true;
        if (key === 'mute_mode_kick_time_hours') return '6';
        return null;
      });
      mockMuteModeUtils.scheduleMuteKick.mockResolvedValue();
      mockDatabase.isFormerMember.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null); // skip invite check

      await guildMemberAddEvent.execute(mockMember);

      expect(mockDatabase.addMuteModeUser).toHaveBeenCalledWith('user-123', 'User#1234');
      expect(mockDatabase.addSpamModeJoinTime).toHaveBeenCalledWith('user-123', 'User#1234', mockMember.joinedAt);
      expect(mockMuteModeUtils.scheduleMuteKick).toHaveBeenCalledWith(
        'user-123',
        mockMember.joinedAt,
        6,
        'mock-client',
        'guild-123'
      );
      expect(mockMember.roles.add).toHaveBeenCalledWith('noobie-role', expect.any(String));
    });

    it('should not add mute mode tracking when mute mode is disabled', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return false;
        return null;
      });
      mockDatabase.isFormerMember.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      expect(mockDatabase.addMuteModeUser).not.toHaveBeenCalled();
      expect(mockMuteModeUtils.scheduleMuteKick).not.toHaveBeenCalled();
      expect(mockDatabase.addSpamModeJoinTime).toHaveBeenCalledWith(
        'user-123',
        'User#1234',
        mockMember.joinedAt
      );
    });

    it('should warn and continue if Noobies role addition fails', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockRejectedValue(new Error('Discord role permissions error'))
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockResolvedValue(false);
      mockDatabase.isFormerMember.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      // Cover line 88
      expect(mockLogger.warn).toHaveBeenCalledWith('Could not add Noobies role on join.', expect.any(Object));
    });

    it('should add returning member role if user is former member', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockResolvedValue(false);
      mockDatabase.isFormerMember.mockResolvedValue(true);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      expect(mockMember.roles.add).toHaveBeenCalledWith('returning-role');
    });

    it('should warn and continue if returning member role addition fails', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockRejectedValue(new Error('Discord role permissions error'))
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockResolvedValue(false);
      mockDatabase.isFormerMember.mockResolvedValue(true);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      // Cover line 72
      expect(mockLogger.warn).toHaveBeenCalledWith('Could not add been-in-server-before role on re-join.', expect.any(Object));
    });

    it('should catch error and log without throwing', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' }
      };

      mockTrollModeUtils.checkAccountAge.mockRejectedValue(new Error('Age check crash'));

      await expect(guildMemberAddEvent.execute(mockMember)).resolves.not.toThrow();

      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred while processing new member.', expect.any(Object));
    });

    it('should fallback to 4 hours if mute_mode_kick_time_hours is falsy', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return true;
        if (key === 'mute_mode_kick_time_hours') return null; // falsy
        return null;
      });
      mockMuteModeUtils.scheduleMuteKick.mockResolvedValue();
      mockDatabase.isFormerMember.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      expect(mockMuteModeUtils.scheduleMuteKick).toHaveBeenCalledWith(
        'user-123',
        mockMember.joinedAt,
        4, // fallback
        'mock-client',
        'guild-123'
      );
    });

    it('should skip beenInServerBefore role check if returningMemberRoleId config is falsy', async () => {
      mockConfig.returningMemberRoleId = null;

      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      expect(mockDatabase.isFormerMember).not.toHaveBeenCalled();
    });

    it('should skip Noobies role assignment if roles config are missing', async () => {
      mockConfig.newMemberRoleId = null;

      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection(),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      expect(mockMember.roles.add).not.toHaveBeenCalled();
    });

    it('should skip Noobies role assignment if joining member already has Fren role', async () => {
      const mockMember = {
        id: 'user-123',
        user: { bot: false, tag: 'User#1234' },
        joinedAt: new Date(),
        client: 'mock-client',
        guild: { id: 'guild-123' },
        roles: {
          cache: new Collection([['fren-role', { id: 'fren-role' }]]),
          add: jest.fn().mockResolvedValue()
        }
      };

      mockTrollModeUtils.checkAccountAge.mockResolvedValue(true);
      mockDatabase.addMuteModeUser.mockResolvedValue();
      mockDatabase.addSpamModeJoinTime.mockResolvedValue();
      mockDatabase.getValue.mockResolvedValue(false);
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.execute(mockMember);

      expect(mockMember.roles.add).not.toHaveBeenCalled();
    });
  });

  describe('checkTaggedInvite', () => {
    beforeEach(() => {
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ code123: 'mytag' });
      mockDatabase.rebuildCodeToTagMap.mockResolvedValue({ code123: 'mytag' });
    });

    it('should skip when tagged invite map stays empty after rebuild', async () => {
      const mockMember = {
        guild: { id: 'guild-123' },
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({});
      mockDatabase.rebuildCodeToTagMap.mockResolvedValue({});

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockDatabase.rebuildCodeToTagMap).toHaveBeenCalledWith('guild-123');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No tagged invites configured, skipping invite check.'
      );
    });

    it('should return if no invite notification channel is configured', async () => {
      const mockMember = {
        user: { tag: 'User#1234', id: 'user-123' }
      };
      mockDatabase.getInviteNotificationChannel.mockResolvedValue(null);

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No invite notification channel configured, skipping invite check.')
      );
    });

    it('should warn and return if member has no guild', async () => {
      const mockMember = {
        guild: null,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Member has no guild, skipping invite check.',
        { userId: 'user-123' }
      );
      expect(mockDatabase.getInviteCodeToTagMap).not.toHaveBeenCalled();
    });

    it('should log an error if notification channel API fetch fails', async () => {
      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection(),
          fetch: jest.fn().mockRejectedValue(new Error('API disconnect'))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 148-152
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch notification channel from API.', expect.any(Object));
    });

    it('should warn and return if notification channel resolved to null/undefined', async () => {
      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection(),
          fetch: jest.fn().mockResolvedValue(false) // use false to prevent accessing .name of null/undefined
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 157-161
      expect(mockLogger.warn).toHaveBeenCalledWith('Invite notification channel not found in guild.', expect.any(Object));
    });

    it('should log an error and return if bot member is not found in guild', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications'
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: null
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 172-175
      expect(mockLogger.error).toHaveBeenCalledWith('Bot member not found in guild.', expect.any(Object));
    });

    it('should log an error and return if permission check lacks SendMessages', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockImplementation((perm) => perm !== 'SendMessages')
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            id: 'bot-123'
          }
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.error).toHaveBeenCalledWith('Bot does not have SendMessages permission in notification channel.', expect.any(Object));
    });

    it('should log an error and return if permission check lacks EmbedLinks', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockImplementation((perm) => perm !== 'EmbedLinks')
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            id: 'bot-123'
          }
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 188-192
      expect(mockLogger.error).toHaveBeenCalledWith('Bot does not have EmbedLinks permission in notification channel.', expect.any(Object));
    });

    it('should log debug and return if bot lacks ManageGuild permission', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            id: 'bot-123',
            permissions: {
              has: jest.fn().mockImplementation((perm) => perm !== 'ManageGuild')
            }
          }
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 197-198
      expect(mockLogger.debug).toHaveBeenCalledWith('Bot does not have ManageGuild permission, cannot check invites.');
    });

    it('should log an error and return if guild invites fetch fails', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            id: 'bot-123',
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockRejectedValue(new Error('Discord API error'))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 209-213
      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch invites from guild.', expect.any(Object));
    });

    it('should still update invite usage when previous usage is empty', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 2 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ code123: 'tag1' });
      mockDatabase.getInviteUsage.mockResolvedValue({});
      mockDatabase.setInviteUsage.mockRejectedValue(new Error('DB write failure'));

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to update invite usage tracking.', expect.any(Object));
    });

    it('should acquire lock sequentially when called concurrently', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection())
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 2 });

      // Run twice concurrently to trigger line 253 wait lock logic
      const p1 = guildMemberAddEvent.checkTaggedInvite(mockMember);
      const p2 = guildMemberAddEvent.checkTaggedInvite(mockMember);
      await Promise.all([p1, p2]);

      // Cover line 253
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Built current invite usage data.'), expect.any(Object));
    });

    it('should rebuild codeToTagMap if it is empty/null', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 3 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        displayName: 'UserDisplayName',
        user: {
          tag: 'User#1234',
          id: 'user-123',
          username: 'user123',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
        }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 2 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({}); // empty map triggers rebuild
      mockDatabase.rebuildCodeToTagMap.mockResolvedValue({ 'code123': 'mytag' });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'code123',
        name: 'My Special Tag'
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover line 271
      expect(mockDatabase.rebuildCodeToTagMap).toHaveBeenCalledWith('guild-123');
    });

    it('should skip invite codes that are not in codeToTagMap', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['non-tagged-code', { code: 'non-tagged-code', uses: 5 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'non-tagged-code': 2 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'tagged-code': 'mytag' });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover line 290
      expect(mockLogger.debug).toHaveBeenCalledWith('Detected used invite code.', { inviteCode: 'NONE' });
    });

    it('should detect when a new tagged invite is used (not present in previous usage)', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        }),
        send: jest.fn().mockResolvedValue({ id: 'msg-123' })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['newcode', { code: 'newcode', uses: 1 }] // new tagged code
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        displayName: 'UserDisplayName',
        user: {
          tag: 'User#1234',
          id: 'user-123',
          username: 'user123',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
        }
      };

      // Set up Prototype pollution/getter to intercept 'newcode' in previous usage:
      // We check that 'this' has 'oldcode' property (own property of normalizedPreviousUsage)
      // to avoid polluting any other object creations.
      let callCount = 0;
      Object.defineProperty(Object.prototype, 'newcode', {
        configurable: true,
        get() {
          if (this && Object.prototype.hasOwnProperty.call(this, 'oldcode')) {
            callCount++;
            if (callCount === 1) {
              return 2;
            }
          }
          return undefined;
        },
        set(value) {
          Object.defineProperty(this, 'newcode', {
            value,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      });

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'oldcode': 2 }); // 'newcode' not in own properties
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'newcode': 'newtag' });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'newcode',
        name: 'New Tag'
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Clean up Object prototype injection
      delete Object.prototype.newcode;

      // Cover lines 317-322
      expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-123', { 'newcode': 1 });
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('should log an error if updating setInviteUsage fails inside the lock', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection())
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 2 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({});
      mockDatabase.setInviteUsage.mockRejectedValue(new Error('Lock update DB write fail'));

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover line 334
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to update invite usage tracking.', expect.any(Object));
    });

    it('should log error if channel.send throws an exception', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        }),
        send: jest.fn().mockRejectedValue(new Error('Discord API HTTP error'))
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 3 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        displayName: 'UserDisplayName',
        user: {
          tag: 'User#1234',
          id: 'user-123',
          username: 'user123',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
        }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 2 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'mytag' });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'code123',
        name: 'My Special Tag'
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // Cover lines 387-392
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send notification to channel.', expect.any(Object));
    });

    it('should catch error and log if checkTaggedInvite fails globally', async () => {
      const mockMember = {
        guild: {
          id: 'guild-123',
          get channels() {
            throw new Error('channels error');
          }
        },
        user: { tag: 'User#1234', id: 'user-123' }
      };

      // Mock getInviteNotificationChannel to return truthy to pass early return and force guild null dereference error
      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');

      await expect(guildMemberAddEvent.checkTaggedInvite(mockMember)).resolves.not.toThrow();

      // Cover lines 414-415
      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred while checking tagged invite.', expect.any(Object));
    });

    it('should handle undefined invite.uses in currentUsage check and skip notification if increase is not positive', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123' }] // uses is undefined/falsy
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 0 }); // increase = 0 - 0 = 0
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'mytag' });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Comparing tagged invite usage counts.'),
        expect.objectContaining({ increase: 0 })
      );
    });

    it('should skip invite notification if increase is less than maxIncrease', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 2 }],
            ['code456', { code: 'code456', uses: 3 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 1, 'code456': 1 }); // increase for 123 is 1, for 456 is 2
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'tag1', 'code456': 'tag2' });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      // code456 has larger increase (2 > 1), so usedInviteCode will be code456
      expect(mockLogger.debug).toHaveBeenCalledWith('Detected used invite code.', { inviteCode: 'code456' });
    });

    it('should skip invite notification if getInviteTag returns null or code mismatch', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 2 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 1 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'mytag' });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'mismatch-code', // mismatch!
        name: 'My Special Tag'
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Detected used invite code.',
        { inviteCode: 'code123' }
      );
    });

    it('should fallback to baseEmbedColor 0 if baseEmbedColor config is falsy', async () => {
      mockConfig.baseEmbedColor = null;

      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        }),
        send: jest.fn().mockResolvedValue({ id: 'msg-123' })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 2 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        displayName: 'UserDisplayName',
        user: {
          tag: 'User#1234',
          id: 'user-123',
          username: 'user123',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
        }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 1 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'mytag' });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'code123',
        name: 'My Special Tag'
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockChannel.send).toHaveBeenCalled();
      const sendCallArg = mockChannel.send.mock.calls[0][0];
      expect(sendCallArg.embeds[0].data.color).toBe(0);
    });

    it('should skip code if increase is not greater than maxIncrease', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 3 }],
            ['code456', { code: 'code456', uses: 2 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 1, 'code456': 1 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'tag1', 'code456': 'tag2' });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockLogger.debug).toHaveBeenCalledWith('Detected used invite code.', { inviteCode: 'code123' });
    });

    it('should handle falsy tagName when resolved via codeToTagMap dynamically', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 2 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-123' }
      };

      let accessCount = 0;
      const codeToTagMap = {
        get code123() {
          accessCount++;
          return accessCount === 1 ? 'mytag' : undefined;
        }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 1 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue(codeToTagMap);

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockDatabase.getInviteTag).not.toHaveBeenCalled();
    });

    it('should fallback to tagName if inviteTag.name is falsy', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        }),
        send: jest.fn().mockResolvedValue({ id: 'msg-123' })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(new Collection([
            ['code123', { code: 'code123', uses: 2 }]
          ]))
        }
      };

      const mockMember = {
        guild: mockGuild,
        displayName: 'UserDisplayName',
        user: {
          tag: 'User#1234',
          id: 'user-123',
          username: 'user123',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.link')
        }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteUsage.mockResolvedValue({ 'code123': 1 });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code123': 'mytag' });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'code123',
        name: '' // empty/falsy
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockChannel.send).toHaveBeenCalled();
      const sendCallArg = mockChannel.send.mock.calls[0][0];
      const inviteTagField = sendCallArg.embeds[0].data.fields.find(f => f.name === 'Invite Tag');
      expect(inviteTagField.value).toBe('mytag');
    });

    it('should export inviteCheckLocks helper in test environment', () => {
      expect(guildMemberAddEvent.__test__.inviteCheckLocks).toBeInstanceOf(Map);
    });

    it('should skip resolve when resolveLock is not a function in releaseInviteCheckLock', () => {
      const locks = guildMemberAddEvent.__test__.inviteCheckLocks;
      const guildId = 'guild-non-fn-lock';
      const stalePromise = Promise.resolve();
      locks.set(guildId, stalePromise);

      expect(() => {
        guildMemberAddEvent.__test__.releaseInviteCheckLock(guildId, null, stalePromise);
      }).not.toThrow();
      expect(locks.has(guildId)).toBe(false);
    });

    it('should not export __test__ helpers outside test environment', () => {
      jest.isolateModules(() => {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const mod = require('../../events/guildMemberAdd');
        expect(mod.__test__).toBeUndefined();
        process.env.NODE_ENV = previousEnv;
      });
    });

    it('should not delete invite lock when a newer lock replaced it during fetch', async () => {
      const locks = guildMemberAddEvent.__test__.inviteCheckLocks;
      const guildId = 'guild-stale-lock';

      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockGuild = {
        id: guildId,
        channels: {
          cache: new Collection([['chan-123', mockChannel]])
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockImplementation(async () => {
            locks.set(guildId, Promise.resolve());
            return new Collection();
          })
        }
      };

      const mockMember = {
        guild: mockGuild,
        user: { tag: 'User#1234', id: 'user-stale' }
      };

      mockDatabase.getInviteNotificationChannel.mockResolvedValue('chan-123');
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ code123: 'tag' });
      mockDatabase.getInviteUsage.mockResolvedValue({ code123: 1 });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(locks.has(guildId)).toBe(true);
      locks.delete(guildId);
    });
  });
});
