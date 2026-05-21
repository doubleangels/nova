const { MessageFlags } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('giveperms command unit tests', () => {
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
      memberFrenRoleId: 'fren-role-id'
    };
    jest.doMock('../../config', () => mockConfig);

    givePermsCommand = require('../../commands/givePerms');
  });

  it('serializes slash command options', () => {
    const json = givePermsCommand.data.toJSON();
    expect(json.options).toHaveLength(3);
  });

  it('validateInputs returns success for valid configuration', () => {
    const mockInteraction = {
      guild: {
        members: { me: { roles: { highest: { position: 10 } } } },
        roles: { fetch: jest.fn().mockResolvedValue({ position: 5 }) }
      }
    };
    const result = givePermsCommand.validateInputs(
      mockInteraction,
      'Role',
      '#FF0000',
      { id: 'user-1' }
    );
    expect(result.success).toBe(true);
  });

  it('should successfully run happy path and grant permissions', async () => {
    const mockNewRole = { id: 'new-role-id', name: 'Elite' };
    const mockTargetMember = {
      id: 'user-123',
      user: { tag: 'Member#1234' },
      roles: {
        add: jest.fn().mockResolvedValue()
      }
    };

    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) },
          me: { roles: { highest: { position: 10 } } }
        },
        roles: {
          fetch: jest.fn().mockImplementation(async (id) => {
            if (id === 'ref-role-id') return { id: 'ref-role-id', position: 5 };
            if (id === 'fren-role-id') return { id: 'fren-role-id', position: 4 };
            return null;
          }),
          create: jest.fn().mockResolvedValue(mockNewRole)
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.any(Object)]
    }));
  });

  it('should trigger execute catch block and call handleError if execute throws', async () => {
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn(() => {
          throw new Error('CONFIG_MISSING');
        })
      },
      reply: jest.fn().mockResolvedValue()
    };

    await givePermsCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not properly configured')
    }));
  });

  it('should return error if role name is empty or too long', async () => {
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return '';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      }
    };

    await givePermsCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('valid role name')
    }));

    // Test too long role name
    mockInteraction.options.getString = jest.fn((name) => {
      if (name === 'role') return 'a'.repeat(101);
      if (name === 'color') return '#FF0000';
      return null;
    });

    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('100 characters or less')
    }));
  });

  it('should return error if target user cannot be found in server', async () => {
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(null) },
          fetch: jest.fn().mockRejectedValue(new Error('Not found'))
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('could not be found')
    }));
  });

  it('should return error if role color format is invalid', async () => {
    const mockTargetMember = { id: 'user-123' };
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return 'invalid-color';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) }
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Invalid color format')
    }));
  });

  it('should return error if reference role ID or fren role ID is empty in config', async () => {
    const mockTargetMember = { id: 'user-123' };
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) }
        }
      }
    };

    // Missing position role ID
    mockConfig.customRolePositioningAnchorId = '';
    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('position reference role is not configured')
    }));

    // Missing fren role ID
    mockConfig.customRolePositioningAnchorId = 'ref-role-id';
    mockConfig.memberFrenRoleId = '';
    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('fren role is not configured')
    }));
  });

  it('should return error if reference role or fren role cannot be found in server, or fetch rejects', async () => {
    const mockTargetMember = { id: 'user-123' };
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) }
        },
        roles: {
          fetch: jest.fn().mockResolvedValue(null) // Mock both as not found
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('reference role (ID: ref-role-id) was not found')
    }));

    // Only fren role not found
    mockInteraction.guild.roles.fetch = jest.fn().mockImplementation(async (id) => {
      if (id === 'ref-role-id') return { id: 'ref-role-id', position: 5 };
      return null;
    });

    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('fren role (ID: fren-role-id) was not found')
    }));

    // Roles fetch rejects
    mockInteraction.guild.roles.fetch = jest.fn().mockRejectedValue(new Error('Fetch error'));
    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('reference role (ID: ref-role-id) was not found')
    }));
  });

  it('should return error if bot highest role is below position reference role', async () => {
    const mockTargetMember = { id: 'user-123' };
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) },
          me: { roles: { highest: { position: 4 } } }
        },
        roles: {
          fetch: jest.fn().mockImplementation(async (id) => {
            if (id === 'ref-role-id') return { id: 'ref-role-id', position: 5 };
            if (id === 'fren-role-id') return { id: 'fren-role-id', position: 4 };
            return null;
          })
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('highest role must be above the reference role')
    }));
  });

  it('should clean up and delete new role if role assignment fails', async () => {
    const mockNewRole = {
      id: 'new-role-id',
      name: 'Elite',
      delete: jest.fn().mockRejectedValue(new Error('delete failed'))
    };
    const mockTargetMember = {
      id: 'user-123',
      user: { tag: 'Member#1234' },
      roles: {
        add: jest.fn().mockRejectedValue(new Error('Add role permission error'))
      }
    };

    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'Elite';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'user-123' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(mockTargetMember) },
          me: { roles: { highest: { position: 10 } } }
        },
        roles: {
          fetch: jest.fn().mockImplementation(async (id) => {
            if (id === 'ref-role-id') return { id: 'ref-role-id', position: 5 };
            if (id === 'fren-role-id') return { id: 'fren-role-id', position: 4 };
            return null;
          }),
          create: jest.fn().mockResolvedValue(mockNewRole)
        }
      }
    };

    await givePermsCommand.execute(mockInteraction);

    expect(mockNewRole.delete).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Role was created but I couldn\'t assign it')
    }));
  });

  it('should reply when target user is not in guild', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn((name) => {
          if (name === 'role') return 'TestRole';
          if (name === 'color') return '#FF0000';
          return null;
        }),
        getUser: jest.fn(() => ({ id: 'missing-user', tag: 'Missing#0001' }))
      },
      guild: {
        members: {
          cache: { get: jest.fn().mockReturnValue(undefined) },
          fetch: jest.fn().mockResolvedValue(null)
        }
      }
    });

    await givePermsCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ The specified user could not be found in this server.'
    }));
  });

  it('handleError uses default message for unknown errors', async () => {
    const interaction = {
      user: { id: 'admin-123' },
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn()
    };
    await givePermsCommand.handleError(interaction, new Error('SOMETHING_ELSE'));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ An unexpected error occurred while granting permissions. Please try again later.'
    }));
  });

  it('handleError maps USER_NOT_FOUND when editReply succeeds', async () => {
    const interaction = {
      user: { id: 'admin-123' },
      guildId: 'guild-123',
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn()
    };

    await givePermsCommand.handleError(interaction, new Error('USER_NOT_FOUND'));

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ The specified user could not be found in this server.'
    }));
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('handleError maps INVALID_COLOR when editReply succeeds', async () => {
    const interaction = {
      user: { id: 'admin-123' },
      guildId: 'guild-123',
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn()
    };

    await givePermsCommand.handleError(interaction, new Error('INVALID_COLOR'));

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ Invalid color format. Please use the format #RRGGBB or RRGGBB.'
    }));
  });

  it('handleError uses generic message for unmapped errors', async () => {
    const interaction = {
      user: { id: 'admin-123' },
      guildId: 'guild-123',
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn()
    };

    await givePermsCommand.handleError(interaction, new Error('UNKNOWN'));

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ An unexpected error occurred while granting permissions. Please try again later.'
    }));
  });

  it('should handle custom command error classes in handleError', async () => {
    const mockInteraction = {
      user: { id: 'admin-123', tag: 'Admin#0001' },
      guildId: 'guild-123',
      editReply: jest.fn().mockRejectedValue(new Error('Edit reply error')),
      reply: jest.fn().mockResolvedValue()
    };

    await givePermsCommand.handleError(mockInteraction, new Error('CONFIG_MISSING'));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('properly configured')
    }));

    await givePermsCommand.handleError(mockInteraction, new Error('INSUFFICIENT_PERMISSIONS'));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('permission to create or assign roles')
    }));

    await givePermsCommand.handleError(mockInteraction, new Error('INVALID_ROLE_NAME'));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('valid role name')
    }));

    await givePermsCommand.handleError(mockInteraction, new Error('INVALID_COLOR'));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Invalid color format')
    }));

    const editReplyInteraction = {
      user: { id: 'admin-123' },
      guildId: 'guild-123',
      editReply: jest.fn().mockResolvedValue()
    };
    await givePermsCommand.handleError(editReplyInteraction, new Error('USER_NOT_FOUND'));
    expect(editReplyInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('could not be found')
    }));

    mockInteraction.reply.mockRejectedValue(new Error('reply failed'));
    await expect(
      givePermsCommand.handleError(mockInteraction, new Error('CONFIG_MISSING'))
    ).resolves.not.toThrow();
  });
});
