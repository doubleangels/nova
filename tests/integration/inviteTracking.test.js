const { Collection } = require('discord.js');

describe('Invite Tracking Integration Flow', () => {
  let guildMemberAddEvent;
  let mockLogger;
  let mockDatabase;
  let mockConfig;
  let mockTrollModeUtils;

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
      newUserBeenInServerBeforeRoleId: 'returning-role',
      noobiesRoleId: 'noobie-role',
      givePermsFrenRoleId: 'fren-role',
      baseEmbedColor: 0x00ff00
    };
    jest.doMock('../../config', () => mockConfig);

    // Memory database state for invite usage
    let inviteUsageStore = {};
    mockDatabase = {
      getValue: jest.fn(async (key) => {
        if (key === 'mute_mode_enabled') return false;
        return null;
      }),
      addMuteModeUser: jest.fn().mockResolvedValue(),
      addSpamModeJoinTime: jest.fn().mockResolvedValue(),
      isFormerMember: jest.fn().mockResolvedValue(false),
      getInviteNotificationChannel: jest.fn().mockResolvedValue('invite-logs-channel-123'),
      getInviteUsage: jest.fn(async () => inviteUsageStore),
      setInviteUsage: jest.fn(async (guildId, usage) => {
        inviteUsageStore = usage;
      }),
      getInviteCodeToTagMap: jest.fn().mockResolvedValue({
        'abc': 'campaign-tag'
      }),
      getInviteTag: jest.fn().mockResolvedValue({
        name: 'Marketing Campaign 2026',
        code: 'abc'
      }),
      rebuildCodeToTagMap: jest.fn().mockResolvedValue({
        'abc': 'campaign-tag'
      })
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    // Mock trollModeUtils to pass age verification
    mockTrollModeUtils = {
      checkAccountAge: jest.fn().mockResolvedValue(true),
      performKick: jest.fn().mockResolvedValue()
    };
    jest.doMock('../../utils/trollModeUtils', () => mockTrollModeUtils);

    guildMemberAddEvent = require('../../events/guildMemberAdd');
  });

  it('should successfully detect which tagged invite was used and log it to notification channel E2E', async () => {
    // Initialize invite usage store with 0 uses for 'abc'
    await mockDatabase.setInviteUsage('guild-123', {
      'abc': 0
    });

    const mockNotificationChannel = {
      id: 'invite-logs-channel-123',
      name: 'invite-logs',
      type: 0, // GuildText
      permissionsFor: jest.fn(() => ({
        has: jest.fn().mockReturnValue(true) // Has SendMessages, EmbedLinks
      })),
      send: jest.fn().mockResolvedValue({ id: 'notification-msg-123' })
    };

    const mockInvite = {
      code: 'abc', // Keep original case
      uses: 1
    };
    const mockInvitesCollection = new Collection();
    mockInvitesCollection.set('abc', mockInvite);

    const mockMember = {
      id: 'new-user-111',
      user: {
        id: 'new-user-111',
        tag: 'NewUser#9999',
        username: 'NewUser',
        bot: false,
        displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url')
      },
      displayName: 'NewUser',
      joinedAt: new Date(),
      roles: {
        cache: new Collection(),
        add: jest.fn().mockResolvedValue()
      },
      guild: {
        id: 'guild-123',
        channels: {
          cache: {
            get: jest.fn().mockReturnValue(mockNotificationChannel)
          }
        },
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true) // Has ManageGuild
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue(mockInvitesCollection)
        }
      }
    };

    // Trigger execution
    await guildMemberAddEvent.execute(mockMember);

    // Verify invite check resolves that 'abc' was used
    expect(mockDatabase.getInviteCodeToTagMap).toHaveBeenCalled();
    expect(mockDatabase.getInviteTag).toHaveBeenCalledWith('campaign-tag');
    expect(mockNotificationChannel.send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.objectContaining({
        data: expect.objectContaining({
          title: '🎉 New Member Joined via Tagged Invite',
          description: expect.stringContaining('joined the server using a tagged invite')
        })
      })]
    }));
  });
});
