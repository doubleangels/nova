const { Collection } = require('discord.js');

describe('Permission and Role Assignment Flow Integration', () => {
  let givePermsCommand;
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
      customRolePositioningAnchorId: 'ref-role-id',
      memberFrenRoleId: 'fren-role-id',
      newMemberRoleId: 'noobie-role-id'
    };
    jest.doMock('../../config', () => mockConfig);

    givePermsCommand = require('../../commands/givePerms');
  });

  it('should successfully create and assign custom roles when permission hierarchy check passes', async () => {
    const mockCreatedRole = { id: 'new-role-999', name: 'Elite Member', position: 6 };
    const mockRefRole = { id: 'ref-role-id', position: 5 };
    const mockFrenRole = { id: 'fren-role-id', position: 4 };

    const mockTargetMember = {
      id: 'target-user-id',
      user: { tag: 'Member#1234' },
      roles: {
        add: jest.fn().mockResolvedValue()
      }
    };

    const mockInteraction = {
      user: { id: 'admin-user-id', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite Member';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'target-user-id', tag: 'Member#1234' }))
      },
      guild: {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockTargetMember)
          },
          me: {
            roles: {
              highest: { position: 10 } // Higher than reference role position + 1 (5 + 1 = 6)
            }
          }
        },
        roles: {
          fetch: jest.fn().mockImplementation(async (id) => {
            if (id === 'ref-role-id') return mockRefRole;
            if (id === 'fren-role-id') return mockFrenRole;
            return null;
          }),
          create: jest.fn().mockResolvedValue(mockCreatedRole)
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);

    // Verify role creation and assignment succeeded
    expect(mockInteraction.guild.roles.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Elite Member',
      color: 16711680, // Decimal for #FF0000
      position: 6
    }));
    expect(mockTargetMember.roles.add).toHaveBeenCalledWith(['new-role-999', 'fren-role-id'], expect.any(String));
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.any(Object)]
    }));
  });

  it('should return hierarchy error when bot highest role is below position reference role', async () => {
    const mockRefRole = { id: 'ref-role-id', position: 5 };
    const mockFrenRole = { id: 'fren-role-id', position: 4 };

    const mockTargetMember = {
      id: 'target-user-id',
      user: { tag: 'Member#1234' }
    };

    const mockInteraction = {
      user: { id: 'admin-user-id', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite Member';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'target-user-id', tag: 'Member#1234' }))
      },
      guild: {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockTargetMember)
          },
          me: {
            roles: {
              highest: { position: 4 } // Below reference role position + 1 (5 + 1 = 6)
            }
          }
        },
        roles: {
          fetch: jest.fn().mockImplementation(async (id) => {
            if (id === 'ref-role-id') return mockRefRole;
            if (id === 'fren-role-id') return mockFrenRole;
            return null;
          })
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);

    // Verify hierarchy warning returned
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('highest role must be above the reference role')
    }));
  });
});
