const { createMockInteraction } = require('../testUtils');
const { PermissionFlagsBits } = require('discord.js');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('changeRoleName command', () => {
  let changeRoleNameCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    changeRoleNameCommand = require('../../commands/changeRoleName');
  });

  describe('execute', () => {
    it('should successfully rename a role', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 10,
            managed: false,
            color: 0x00ff00,
            hexColor: '#00ff00',
            setName: jest.fn().mockResolvedValue()
          }),
          getString: jest.fn().mockReturnValue('  New Role Name  ')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.ManageRoles)
            },
            roles: {
              highest: { position: 15 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      const targetRole = mockInteraction.options.getRole('role');
      expect(targetRole.setName).toHaveBeenCalledWith(
        'New Role Name',
        expect.stringContaining('via /changerolename')
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0x00ff00);
      expect(embed.data.title).toBe('Role renamed');
      expect(embed.data.description).toBe('Renamed role from **Old Role** to **New Role Name**.');
    });

    it('should reply with error if bot does not have ManageRoles permission', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({ id: 'role-id', name: 'Old Role', position: 10 }),
          getString: jest.fn().mockReturnValue('New Role')
        }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(false)
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles."
      }));
    });

    it('should reply with error if role is above or equal to bot\'s highest role position', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({ id: 'role-id', name: 'Old Role', position: 15 }),
          getString: jest.fn().mockReturnValue('New Role')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 } // bot position (10) <= role position (15)
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage this role."
      }));
    });

    it('should reply with error if the role is managed by an integration', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({ id: 'role-id', name: 'Old Role', position: 5, managed: true }),
          getString: jest.fn().mockReturnValue('New Role')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ This role is managed by an integration and cannot be modified."
      }));
    });

    it('should reply with error if the trimmed name is empty or exceeds 100 characters', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({ id: 'role-id', name: 'Old Role', position: 5, managed: false }),
          getString: jest.fn().mockReturnValue('   ') // Trimmed length is 0
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Role name must be between 1 and 100 characters.'
      }));
    });

    it('should use default color 0 if role color is 0/falsy', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 5,
            managed: false,
            color: 0,
            hexColor: '#000000',
            setName: jest.fn().mockResolvedValue()
          }),
          getString: jest.fn().mockReturnValue('New Name')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should handle Discord error code 50013 (Missing Permissions)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 5,
            managed: false,
            setName: jest.fn().mockRejectedValue({ code: 50013 })
          }),
          getString: jest.fn().mockReturnValue('New Name')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to edit that role, or it's above my highest role."
      }));
    });

    it('should handle Discord error code 50035 (Invalid role name)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 5,
            managed: false,
            setName: jest.fn().mockRejectedValue({
              code: 50035,
              rawError: { errors: { name: 'Invalid name' } }
            })
          }),
          getString: jest.fn().mockReturnValue('New Name')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ Invalid role name. It must be 1–100 characters and follow Discord's rules."
      }));
    });

    it('should handle unexpected errors with generic error message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 5,
            managed: false,
            setName: jest.fn().mockRejectedValue(new Error('Discord offline'))
          }),
          getString: jest.fn().mockReturnValue('New Name')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in changeRoleName command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while renaming the role. Please try again later.'
      }));
    });

    it('should catch error and log if editReply inside handleError fails', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 5,
            managed: false,
            setName: jest.fn().mockRejectedValue(new Error('Discord offline'))
          }),
          getString: jest.fn().mockReturnValue('New Name')
        }
      });

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            },
            roles: {
              highest: { position: 10 }
            }
          }
        }
      };

      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await expect(changeRoleNameCommand.execute(mockInteraction)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply.', expect.any(Object));
    });

    it('should fall back to fetchMe if me is null', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue({
            id: 'role-id',
            name: 'Old Role',
            position: 10,
            managed: false,
            color: 0x00ff00,
            hexColor: '#00ff00',
            setName: jest.fn().mockResolvedValue()
          }),
          getString: jest.fn().mockReturnValue('New Role Name')
        },
        member: { roles: { highest: { position: 50 } } }
      });

      const mockBotMember = {
        permissions: {
          has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.ManageRoles)
        },
        roles: {
          highest: { position: 15 }
        }
      };

      mockInteraction.guild = {
        ownerId: 'owner-123',
        members: {
          me: null,
          fetchMe: jest.fn().mockResolvedValue(mockBotMember)
        }
      };

      await changeRoleNameCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetchMe).toHaveBeenCalled();
      const targetRole = mockInteraction.options.getRole('role');
      expect(targetRole.setName).toHaveBeenCalledWith(
        'New Role Name',
        expect.stringContaining('via /changerolename')
      );
    });
  });
});
