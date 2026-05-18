const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('takeRole command', () => {
  let takeRoleCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    takeRoleCommand = require('../../commands/takeRole');
  });

  describe('execute', () => {
    it('should successfully remove a role from a user without reason', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Admin Role',
        color: 0xff0000,
        hexColor: '#ff0000',
        position: 10,
        managed: false
      };

      const mockTargetUser = {
        id: 'target-user-id'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue(undefined) // reason is undefined
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          cache: {
            has: jest.fn().mockReturnValue(true) // member has the role
          },
          remove: jest.fn().mockResolvedValue()
        }
      };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember),
          me: {
            roles: {
              highest: { position: 15 } // bot position (15) > role position (10)
            }
          }
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('target-user-id');
      expect(mockTargetMember.roles.remove).toHaveBeenCalledWith(mockRole, undefined);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Role Removed');
      expect(embed.data.color).toBe(0xff0000);
      expect(embed.data.description).toContain('<@target-user-id>');
      expect(embed.data.description).toContain('role-id-1');
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Role',
        value: '<@&role-id-1>'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Role Color',
        value: '`#ff0000`'
      }));
      expect(embed.data.fields.find(f => f.name === 'Reason')).toBeUndefined();
    });

    it('should successfully remove a role from a user with a reason', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Admin Role',
        color: 0xff0000,
        hexColor: '#ff0000',
        position: 10,
        managed: false
      };

      const mockTargetUser = {
        id: 'target-user-id'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('Demoted')
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          cache: {
            has: jest.fn().mockReturnValue(true)
          },
          remove: jest.fn().mockResolvedValue()
        }
      };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember),
          me: {
            roles: {
              highest: { position: 15 }
            }
          }
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockTargetMember.roles.remove).toHaveBeenCalledWith(mockRole, 'Demoted');
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Reason',
        value: 'Demoted'
      }));
    });

    it('should handle USER_NOT_FOUND error if guild member fetch rejects/fails', async () => {
      const mockRole = { id: 'role-id-1' };
      const mockTargetUser = { id: 'nonexistent-id' };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue(undefined)
        }
      });

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockRejectedValue(new Error('Fetch failed'))
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith('Target user not found in guild:', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The specified user could not be found in this server.'
      }));
    });

    it('should handle ROLE_NOT_ASSIGNED error if member does not possess the target role', async () => {
      const mockRole = { id: 'role-id-1', name: 'Admin Role' };
      const mockTargetUser = { id: 'target-user-id' };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue(undefined)
        }
      });

      const mockTargetMember = {
        roles: {
          cache: {
            has: jest.fn().mockReturnValue(false) // does not have role
          }
        }
      };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember)
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ The user doesn't have this role."
      }));
    });

    it('should handle MANAGED_ROLE error if the role is managed by an integration', async () => {
      const mockRole = { id: 'role-id-1', name: 'Admin Role', managed: true };
      const mockTargetUser = { id: 'target-user-id' };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue(undefined)
        }
      });

      const mockTargetMember = {
        roles: {
          cache: {
            has: jest.fn().mockReturnValue(true)
          }
        }
      };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember)
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This role is managed by an integration and cannot be removed.'
      }));
    });

    it('should handle INSUFFICIENT_PERMISSIONS error if bot highest role is below or equal to target role', async () => {
      const mockRole = { id: 'role-id-1', name: 'Admin Role', managed: false, position: 15 };
      const mockTargetUser = { id: 'target-user-id' };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue(undefined)
        }
      });

      const mockTargetMember = {
        roles: {
          cache: {
            has: jest.fn().mockReturnValue(true)
          }
        }
      };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember),
          me: {
            roles: {
              highest: { position: 10 } // bot position (10) <= role position (15)
            }
          }
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Bot's highest role is not high enough to remove the specified role.",
        expect.any(Object)
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles."
      }));
    });

    it('should handle unexpected generic error during execution', async () => {
      const mockRole = { id: 'role-id-1', name: 'Admin Role', managed: false, position: 5 };
      const mockTargetUser = { id: 'target-user-id' };

      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue(mockTargetUser),
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue(undefined)
        }
      });

      const mockTargetMember = {
        roles: {
          cache: {
            has: jest.fn().mockReturnValue(true)
          },
          remove: jest.fn().mockRejectedValue(new Error('Discord API error offline'))
        }
      };

      mockInteraction.guild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember),
          me: {
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await takeRoleCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in takeRole command', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while taking the role. Please try again later.'
      }));
    });

    it('should catch error and log if editReply inside handleError fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await expect(takeRoleCommand.handleError(mockInteraction, new Error('ROLE_NOT_ASSIGNED'))).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error message.', expect.any(Object));
    });
  });
});
