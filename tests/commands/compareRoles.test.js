const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

let mockConfig = {
  baseEmbedColor: 0x445566
};
jest.mock('../../config', () => mockConfig);

describe('compareRoles command', () => {
  let compareRolesCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.baseEmbedColor = 0x445566;
    compareRolesCommand = require('../../commands/compareRoles');
  });

  describe('helpers', () => {
    it('should truncateEmbedField returns None for empty text', () => {
      expect(compareRolesCommand.__test__.truncateEmbedField('')).toBe('None');
      expect(compareRolesCommand.__test__.truncateEmbedField(null)).toBe('None');
    });

    it('should not export __test__ helpers outside test environment', () => {
      jest.isolateModules(() => {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const cmd = require('../../commands/compareRoles');
        expect(cmd.__test__).toBeUndefined();
        process.env.NODE_ENV = previousEnv;
      });
    });
  });

  describe('execute', () => {
    it('should successfully compare two different roles with shared and unique permissions', async () => {
      const mockRoleOne = {
        id: 'role-id-1',
        name: 'Role One',
        permissions: {
          toArray: jest.fn().mockReturnValue(['KickMembers', 'BanMembers', 'ManageMessages'])
        },
        toString: () => '<@&role-id-1>'
      };

      const mockRoleTwo = {
        id: 'role-id-2',
        name: 'Role Two',
        permissions: {
          toArray: jest.fn().mockReturnValue(['BanMembers', 'ManageRoles', 'ViewAuditLog'])
        },
        toString: () => '<@&role-id-2>'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Shared Role Permissions');
      expect(embed.data.color).toBe(0x445566);
      expect(embed.data.description).toContain('<@&role-id-1>');
      expect(embed.data.description).toContain('<@&role-id-2>');

      // Verify fields
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Role 1',
        value: '<@&role-id-1> (`3` permissions)'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Role 2',
        value: '<@&role-id-2> (`3` permissions)'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Shared permissions',
        value: 'Ban Members'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Only in Role 1',
        value: 'Kick Members, Manage Messages'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Only in Role 2',
        value: 'Manage Roles, View Audit Log'
      }));
    });

    it('should show None in lists when there are no shared or unique permissions', async () => {
      const mockRoleOne = {
        id: 'role-id-1',
        name: 'Role One',
        permissions: {
          toArray: jest.fn().mockReturnValue([])
        },
        toString: () => '<@&role-id-1>'
      };

      const mockRoleTwo = {
        id: 'role-id-2',
        name: 'Role Two',
        permissions: {
          toArray: jest.fn().mockReturnValue([])
        },
        toString: () => '<@&role-id-2>'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Shared permissions',
        value: 'None'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Only in Role 1',
        value: 'None'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: 'Only in Role 2',
        value: 'None'
      }));
    });

    it('should reply with error if one or both roles are missing/undefined', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(null) // returns null for both
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please provide two valid roles to compare.'
      }));
    });

    it('should reply with error if base-role and comparison-role are identical', async () => {
      const mockRoleOne = { id: 'role-id-1', name: 'Role One' };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRoleOne) // returns the same role for both
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please select **two different roles** to compare.'
      }));
    });

    it('should use default embed color 0 if baseEmbedColor is missing', async () => {
      mockConfig.baseEmbedColor = undefined;

      const mockRoleOne = {
        id: 'role-id-1',
        permissions: { toArray: () => [] },
        toString: () => 'role1'
      };
      const mockRoleTwo = {
        id: 'role-id-2',
        permissions: { toArray: () => [] },
        toString: () => 'role2'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should catch unexpected errors and display unexpected error message', async () => {
      const mockRoleOne = {
        id: 'role-id-1',
        permissions: {
          toArray: jest.fn().mockImplementation(() => {
            throw new Error('Simulated role error');
          })
        }
      };

      const mockRoleTwo = { id: 'role-id-2' };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in compareroles command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while comparing permissions. Please try again later.'
      }));
    });

    it('should use None when truncateEmbedField receives empty text', async () => {
      const mockRoleOne = {
        id: 'role-id-1',
        name: 'Role One',
        permissions: { toArray: jest.fn().mockReturnValue([]) },
        toString: () => '<@&role-id-1>'
      };
      const mockRoleTwo = {
        id: 'role-id-2',
        name: 'Role Two',
        permissions: { toArray: jest.fn().mockReturnValue([]) },
        toString: () => '<@&role-id-2>'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const sharedField = embed.data.fields.find(f => f.name === 'Shared permissions');
      expect(sharedField.value).toBe('None');
    });

    it('should return short text unchanged in truncateEmbedField path', async () => {
      const mockRoleOne = {
        id: 'role-id-1',
        name: 'Role One',
        permissions: { toArray: jest.fn().mockReturnValue(['KickMembers']) },
        toString: () => '<@&role-id-1>'
      };
      const mockRoleTwo = {
        id: 'role-id-2',
        name: 'Role Two',
        permissions: { toArray: jest.fn().mockReturnValue(['BanMembers']) },
        toString: () => '<@&role-id-2>'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const sharedField = embed.data.fields.find(f => f.name === 'Shared permissions');
      expect(sharedField.value).toBe('None');
      expect(sharedField.value.length).toBeLessThan(1024);
    });

    it('should truncate permission lists longer than 1024 characters', async () => {
      const longPerm = 'A'.repeat(200);
      const manyPerms = Array.from({ length: 10 }, () => longPerm);

      const mockRoleOne = {
        id: 'role-id-1',
        name: 'Role One',
        permissions: {
          toArray: jest.fn().mockReturnValue(manyPerms)
        },
        toString: () => '<@&role-id-1>'
      };

      const mockRoleTwo = {
        id: 'role-id-2',
        name: 'Role Two',
        permissions: {
          toArray: jest.fn().mockReturnValue(manyPerms)
        },
        toString: () => '<@&role-id-2>'
      };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      await compareRolesCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const sharedField = embed.data.fields.find(f => f.name === 'Shared permissions');
      expect(sharedField.value.length).toBeLessThanOrEqual(1024);
      expect(sharedField.value.endsWith('...')).toBe(true);
    });

    it('should catch error and log if editReply inside catch block also fails', async () => {
      const mockRoleOne = {
        id: 'role-id-1',
        permissions: {
          toArray: jest.fn().mockImplementation(() => {
            throw new Error('Simulated role error');
          })
        }
      };
      const mockRoleTwo = { id: 'role-id-2' };

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockImplementation((name) => {
            if (name === 'base-role') return mockRoleOne;
            if (name === 'comparison-role') return mockRoleTwo;
            return null;
          })
        }
      });

      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await expect(compareRolesCommand.execute(mockInteraction)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error reply for compareroles command.', expect.any(Object));
    });
  });
});
