const { createMockInteraction } = require('../testUtils');
const { PermissionFlagsBits } = require('discord.js');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

let mockConfig = {
  baseEmbedColor: 0x334455
};
jest.mock('../../config', () => mockConfig);

describe('changeNickname command', () => {
  let changeNicknameCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.baseEmbedColor = 0x334455;
    changeNicknameCommand = require('../../commands/changeNickname');
  });

  describe('execute', () => {
    it('should successfully change the nickname of a cached user using role color', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({
            id: 'target-user-id',
            username: 'targetuser',
            toString: () => '<@target-user-id>'
          }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      const mockMember = {
        nickname: 'Old Nick',
        manageable: true,
        setNickname: jest.fn().mockResolvedValue(),
        roles: {
          highest: { color: 0x990000 }
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(mockMember)
          },
          fetch: jest.fn(),
          me: {
            permissions: {
              has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.ManageNicknames)
            }
          }
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.cache.get).toHaveBeenCalledWith('target-user-id');
      expect(mockInteraction.guild.members.fetch).not.toHaveBeenCalled();
      expect(mockMember.setNickname).toHaveBeenCalledWith('New Nick');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0x990000);
      expect(embed.data.title).toBe('Nickname Updated');
      expect(embed.data.description).toContain('Successfully changed <@target-user-id>\'s nickname from **Old Nick** to **New Nick**.');
    });

    it('should successfully reset nickname (newNickname is null) using config baseEmbedColor if role color is 0', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({
            id: 'target-user-id-2',
            username: 'targetuser2',
            toString: () => '<@target-user-id-2>'
          }),
          getString: jest.fn().mockReturnValue(null) // Reset nickname
        }
      });

      const mockMember = {
        nickname: null, // fallback username
        manageable: true,
        setNickname: jest.fn().mockResolvedValue(),
        roles: {
          highest: { color: 0 } // fallback color
        }
      };

      mockInteraction.guild = {
        members: {
          cache: {
            get: jest.fn().mockReturnValue(undefined) // not cached
          },
          fetch: jest.fn().mockResolvedValue(mockMember),
          me: {
            permissions: {
              has: jest.fn().mockImplementation((perm) => perm === PermissionFlagsBits.ManageNicknames)
            }
          }
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockInteraction.guild.members.fetch).toHaveBeenCalledWith('target-user-id-2');
      expect(mockMember.setNickname).toHaveBeenCalledWith(null);
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0x334455);
      expect(embed.data.description).toContain('Successfully reset <@target-user-id-2>\'s nickname from **targetuser2**.');
    });

    it('should reply with error if target user cannot be found in server', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'nonexistent-id', username: 'nonexistent' }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      mockInteraction.guild = {
        members: {
          cache: { get: () => undefined },
          fetch: jest.fn().mockRejectedValue(new Error('Fetch failed')) // fetch fails
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The specified user could not be found in this server.'
      }));
    });

    it('should catch BOT_PERMISSION_DENIED error and display correct message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'user-id', username: 'targetuser' }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      const mockMember = { manageable: true };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember },
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(false) // BOT_PERMISSION_DENIED
            }
          }
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage nicknames in this server."
      }));
    });

    it('should catch USER_NOT_MANAGEABLE error and display correct message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'user-id', username: 'targetuser' }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      const mockMember = { manageable: false };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember },
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I cannot modify this user's nickname."
      }));
    });

    it('should catch INVALID_NICKNAME_LENGTH error if new nickname length is too long', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'user-id', username: 'targetuser' }),
          getString: jest.fn().mockReturnValue('A'.repeat(33)) // Length 33
        }
      });

      const mockMember = { manageable: true };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember },
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Nickname must be between 1 and 32 characters.'
      }));
    });

    it('should catch unexpected errors and display generic error message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'user-id', username: 'targetuser' }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      const mockMember = {
        manageable: true,
        setNickname: jest.fn().mockRejectedValue(new Error('Discord API error'))
      };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember },
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        }
      };

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in changenickname command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while changing the nickname. Please try again later.'
      }));
    });

    it('should fallback to interaction.reply if editReply fails inside handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'user-id', username: 'targetuser' }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      const mockMember = {
        manageable: true,
        setNickname: jest.fn().mockRejectedValue(new Error('Discord API error'))
      };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember },
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        }
      };

      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await changeNicknameCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for change nickname command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while changing the nickname. Please try again later.'
      }));
    });

    it('should catch error if fallback reply inside handleError also fails', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'user-id', username: 'targetuser' }),
          getString: jest.fn().mockReturnValue('New Nick')
        }
      });

      const mockMember = {
        manageable: true,
        setNickname: jest.fn().mockRejectedValue(new Error('Discord API error'))
      };

      mockInteraction.guild = {
        members: {
          cache: { get: () => mockMember },
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        }
      };

      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValue(new Error('reply failed'));

      await expect(changeNicknameCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
