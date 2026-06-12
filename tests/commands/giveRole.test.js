const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('giveRole command', () => {
  let giveRoleCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    giveRoleCommand = require('../../commands/giveRole');
  });

  describe('execute', () => {
    it('should successfully assign a role to a cached user', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Super Role',
        color: 0x00ff00,
        hexColor: '#00ff00',
        position: 10,
        managed: false
      };

      const mockTargetUser = {
        id: 'target-user-id',
        tag: 'target#1234'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: {
          roles: { highest: { position: 20 } }
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          highest: { position: 5 },
          add: jest.fn().mockResolvedValue()
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockTargetMember)
          },
          fetch: jest.fn(),
          me: {
            roles: {
              highest: { position: 15 } // position (15) > role position (10)
            }
          }
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.cache.get).toHaveBeenCalledWith('target-user-id');
      expect(mockInteraction.guild.members.fetch).not.toHaveBeenCalled();
      expect(mockTargetMember.roles.add).toHaveBeenCalledWith(
        'role-id-1',
        expect.stringContaining('using giverole command')
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Role Assigned');
      expect(embed.data.color).toBe(0x00ff00);
      expect(embed.data.description).toContain('<@target-user-id>');
      expect(embed.data.description).toContain('role-id-1');
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Role',
        value: '<@&role-id-1>'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Role Color',
        value: '`#00ff00`'
      }));
    });

    it('should successfully assign role after fetching member if not cached', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Super Role',
        color: 0x00ff00,
        hexColor: '#00ff00',
        position: 10,
        managed: false
      };

      const mockTargetUser = {
        id: 'target-user-id',
        tag: 'target#1234'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: {
          roles: { highest: { position: 20 } }
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          highest: { position: 5 },
          add: jest.fn().mockResolvedValue()
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(undefined) // not cached
          },
          fetch: jest.fn().mockResolvedValue(mockTargetMember),
          me: {
            roles: {
              highest: { position: 15 }
            }
          }
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('target-user-id');
      expect(mockTargetMember.roles.add).toHaveBeenCalled();
    });

    it('should catch and handle errors during execution (triggers outer catch and line 109)', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Super Role',
        color: 0x00ff00,
        hexColor: '#00ff00',
        position: 10,
        managed: false
      };

      const mockTargetUser = {
        id: 'target-user-id',
        tag: 'target#1234'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: {
          roles: { highest: { position: 20 } }
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          highest: { position: 5 },
          add: jest.fn().mockRejectedValue(new Error('INSUFFICIENT_PERMISSIONS'))
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockTargetMember)
          },
          me: {
            roles: {
              highest: { position: 15 }
            }
          }
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles."
      }));
    });

    it('should reply with error if validation fails (role is null)', async () => {
      const mockTargetUser = { id: 'target-user-id' };
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(null),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        }
      });

      await giveRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid role provided.');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please provide a valid role.'
      }));
    });

    it('should reply with error if validation fails (user is null)', async () => {
      const mockRole = { id: 'role-id' };
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(null)
        }
      });

      await giveRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid user provided.');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please provide a valid user.'
      }));
    });

    it('should reply with error if target user cannot be found in server', async () => {
      const mockRole = { id: 'role-id-1' };
      const mockTargetUser = { id: 'nonexistent-id', tag: 'target#1234' };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: {
          roles: { highest: { position: 20 } }
        }
      });

      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockRejectedValue(new Error('Fetch failed'))
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith('Target user not found in guild.', { targetUserId: 'nonexistent-id' });
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The specified user could not be found in this server.'
      }));
    });

    it('should reply with error if bot highest role position is below or equal to target role position', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Super Role',
        position: 15
      };

      const mockTargetUser = {
        id: 'target-user-id',
        tag: 'target#1234'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: {
          roles: { highest: { position: 20 } }
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          highest: { position: 5 }
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockTargetMember)
          },
          me: {
            roles: {
              highest: { position: 10 } // bot position (10) <= role position (15)
            }
          }
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Bot's highest role is not high enough to assign the specified role.",
        expect.any(Object)
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage this role."
      }));
    });

    it('should reply with error if invoker cannot manage the role', async () => {
      const mockRole = {
        id: 'role-id-1',
        name: 'Super Role',
        position: 25,
        managed: false
      };

      const mockTargetUser = {
        id: 'target-user-id',
        tag: 'target#1234'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: {
          roles: { highest: { position: 20 } }
        }
      });

      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: {
          highest: { position: 5 }
        }
      };

      mockInteraction.guild = {
        ownerId: 'owner-id',
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockTargetMember)
          },
          me: {
            roles: {
              highest: { position: 30 }
            }
          }
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        "Bot's highest role is not high enough to assign the specified role.",
        expect.any(Object)
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ You cannot manage a role that is above or equal to your highest role.'
      }));
    });

    it('should handle INSUFFICIENT_PERMISSIONS error', async () => {
      const mockInteraction = createMockInteraction();
      await giveRoleCommand.handleError(mockInteraction, new Error('INSUFFICIENT_PERMISSIONS'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles."
      }));
    });

    it('should handle INVALID_ROLE error', async () => {
      const mockInteraction = createMockInteraction();
      await giveRoleCommand.handleError(mockInteraction, new Error('INVALID_ROLE'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ The specified role is invalid or doesn't exist."
      }));
    });

    it('should handle INVALID_USER error', async () => {
      const mockInteraction = createMockInteraction();
      await giveRoleCommand.handleError(mockInteraction, new Error('INVALID_USER'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ The specified user is invalid or doesn't exist."
      }));
    });

    it('should handle USER_NOT_FOUND error', async () => {
      const mockInteraction = createMockInteraction();
      await giveRoleCommand.handleError(mockInteraction, new Error('USER_NOT_FOUND'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ Could not find the specified user."
      }));
    });

    it('should handle unexpected error', async () => {
      const mockInteraction = createMockInteraction();
      await giveRoleCommand.handleError(mockInteraction, new Error('Simulated random failure'));
      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in giveRole command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while giving the role. Please try again later.'
      }));
    });

    it('should fallback to followUp if editReply fails and interaction is deferred/replied', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.deferred = true;
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await giveRoleCommand.handleError(mockInteraction, new Error('INSUFFICIENT_PERMISSIONS'));

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error message.', expect.any(Object));
      expect(mockInteraction.followUp).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles."
      }));
    });

    it('should reply when invoker member is missing', async () => {
      const mockRole = { id: 'role-id-1', name: 'Super Role', position: 5, managed: false };
      const mockTargetUser = { id: 'target-user-id', tag: 'target#1234' };
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getUser: jest.fn().mockReturnValue(mockTargetUser)
        },
        member: null
      });
      const mockTargetMember = {
        id: 'target-user-id',
        user: { tag: 'target#1234' },
        roles: { highest: { position: 1 } }
      };
      mockInteraction.guild = {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) },
          me: { roles: { highest: { position: 10 } } }
        }
      };

      await giveRoleCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Could not verify your member permissions in this server.'
      }));
    });

    it('should fallback to reply if editReply fails and interaction is not deferred/replied', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.deferred = false;
      mockInteraction.replied = false;
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await giveRoleCommand.handleError(mockInteraction, new Error('INSUFFICIENT_PERMISSIONS'));

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles."
      }));
    });

    it('should log error if fallback followUp also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.deferred = true;
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));
      mockInteraction.followUp.mockRejectedValue(new Error('followUp failed'));

      await expect(giveRoleCommand.handleError(mockInteraction, new Error('INSUFFICIENT_PERMISSIONS'))).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error follow-up.', expect.any(Object));
    });
  });
});
