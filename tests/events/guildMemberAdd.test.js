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
      newUserBeenInServerBeforeRoleId: 'returning-role',
      noobiesRoleId: 'noobie-role',
      givePermsFrenRoleId: 'fren-role',
      baseEmbedColor: 0xff0000
    };
    jest.doMock('../../config', () => mockConfig);

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

    it('should process new member joins and add to database and schedule mute kick', async () => {
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
  });

  describe('checkTaggedInvite', () => {
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

    it('should fetch channel from guild and return if permission check fails', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(false) // lacks SendMessages
        })
      };

      const mockGuild = {
        id: 'guild-123',
        channels: {
          cache: new Collection(),
          fetch: jest.fn().mockResolvedValue(mockChannel)
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

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Bot does not have SendMessages permission in notification channel.'),
        expect.any(Object)
      );
    });

    it('should initialize invite usage tracking and skip notification on first run', async () => {
      const mockChannel = {
        id: 'chan-123',
        name: 'notifications',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true) // Has all permissions
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
      mockDatabase.getInviteUsage.mockResolvedValue({}); // Empty for first run

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-123', {
        'code123': 2
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No previous invite usage data found, initializing with current state.')
      );
    });

    it('should detect when a tagged invite is used, update database and send notification', async () => {
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
            ['code123', { code: 'code123', uses: 3 }] // Increased from 2
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
      mockDatabase.getInviteUsage.mockResolvedValue({
        'code123': 2
      });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({
        'code123': 'mytag'
      });
      mockDatabase.getInviteTag.mockResolvedValue({
        code: 'code123',
        name: 'My Special Tag'
      });

      await guildMemberAddEvent.checkTaggedInvite(mockMember);

      expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-123', {
        'code123': 3
      });
      expect(mockChannel.send).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: '🎉 New Member Joined via Tagged Invite'
          })
        })]
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sent invite notification for member using tagged invite.'),
        expect.any(Object)
      );
    });
  });
});
