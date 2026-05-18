const { createMockInteraction: originalCreateMockInteraction, createMockMember } = require('../testUtils');
const { Collection, ChannelType } = require('discord.js');
const dayjs = require('dayjs');

function createMockInteraction(overrides = {}) {
  const me = createMockMember();
  me.permissions = { has: jest.fn().mockReturnValue(true) };
  
  const baseGuild = {
    id: 'guild-123',
    name: 'Test Guild',
    invites: {
      fetch: jest.fn().mockResolvedValue(new Collection())
    },
    members: {
      fetch: jest.fn(),
      cache: new Collection(),
      me
    },
    channels: {
      cache: new Collection()
    }
  };

  const mergedGuild = overrides.guild 
    ? { ...baseGuild, ...overrides.guild }
    : baseGuild;

  const baseOptions = {
    getSubcommand: jest.fn(),
    getString: jest.fn(),
    getUser: jest.fn(),
    getRole: jest.fn(),
    getInteger: jest.fn(),
    getBoolean: jest.fn(),
    getChannel: jest.fn(),
    getFocused: jest.fn(),
  };

  const mergedOptions = overrides.options
    ? { ...baseOptions, ...overrides.options }
    : baseOptions;

  return originalCreateMockInteraction({
    ...overrides,
    guild: mergedGuild,
    options: mergedOptions
  });
}

describe('invite command', () => {
  let inviteCommand;
  let mockDatabase;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({}));

    mockDatabase = {
      setInviteTag: jest.fn(),
      getInviteTag: jest.fn(),
      deleteInviteTag: jest.fn(),
      setInviteNotificationChannel: jest.fn(),
      getValue: jest.fn(),
      setValue: jest.fn(),
      getAllInviteTagsData: jest.fn(),
      getInviteCodeToTagMap: jest.fn(),
      setInviteCodeToTagMap: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    inviteCommand = require('../../commands/invite');
  });

  describe('execute', () => {
    it('should route subcommands correctly', async () => {
      const subcommands = ['tag', 'setup', 'list', 'create', 'remove'];
      for (const sub of subcommands) {
        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue(sub)
          }
        });

        const handlerName = `handle${sub.charAt(0).toUpperCase() + sub.slice(1)}Subcommand`;
        const spy = jest.spyOn(inviteCommand, handlerName).mockResolvedValue();

        await inviteCommand.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(spy).toHaveBeenCalledWith(mockInteraction);
        spy.mockRestore();
      }
    });

    it('should show error for unknown subcommand', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('unknown')
        }
      });

      await inviteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Unknown subcommand.'
      }));
    });

    it('should handle errors using handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('list')
        }
      });

      const err = new Error('TEST_ERROR');
      jest.spyOn(inviteCommand, 'handleListSubcommand').mockRejectedValue(err);
      const spy = jest.spyOn(inviteCommand, 'handleError').mockResolvedValue();

      await inviteCommand.execute(mockInteraction);

      expect(spy).toHaveBeenCalledWith(mockInteraction, err);
      spy.mockRestore();
    });
  });

  describe('handleTagSubcommand', () => {
    it('should show invalid invite code format warning if code is wrong', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'code') return 'xyz';
            if (name === 'name') return 'tag1';
            return null;
          })
        }
      });

      await inviteCommand.handleTagSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invalid Invite Code');
    });

    it('should validate vanity invite tags without server checks', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'code') return 'https://discord.gg/dafrens';
            if (name === 'name') return 'vanity';
            return null;
          })
        }
      });

      mockDatabase.getInviteTag.mockResolvedValue(null);
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({});
      mockDatabase.setInviteTag.mockResolvedValue(true);
      mockDatabase.setInviteCodeToTagMap.mockResolvedValue(true);

      await inviteCommand.handleTagSubcommand(mockInteraction);

      expect(mockDatabase.setInviteTag).toHaveBeenCalledWith('vanity', expect.objectContaining({
        code: 'dafrens'
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invite Code Tagged');
    });

    it('should check guild invites and throw error if invite code not found in server', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'code') return 'code123';
            if (name === 'name') return 'myTag';
            return null;
          })
        }
      });

      mockInteraction.guild.invites.fetch = jest.fn().mockResolvedValue(new Collection([
        ['otherCode', { code: 'otherCode' }]
      ]));
      mockDatabase.getInviteTag.mockResolvedValue(null);

      await inviteCommand.handleTagSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invite Not Found');
    });

    it('should proceed and save if invites fetch fails', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'code') return 'code123';
            if (name === 'name') return 'myTag';
            return null;
          })
        }
      });

      mockInteraction.guild.invites.fetch = jest.fn().mockRejectedValue(new Error('fail fetch'));
      mockDatabase.getInviteTag.mockResolvedValue(null);

      await inviteCommand.handleTagSubcommand(mockInteraction);

      expect(mockDatabase.setInviteTag).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle updating an existing tag and cleaning old maps', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'code') return 'newcode';
            if (name === 'name') return 'existingTag';
            return null;
          })
        }
      });

      const existingTag = {
        code: 'oldcode',
        name: 'existingTag',
        createdAt: '2025-01-01',
        createdBy: 'user-1'
      };

      mockInteraction.guild.invites.fetch.mockResolvedValue(new Collection([
        ['newcode', { code: 'newcode' }]
      ]));

      mockDatabase.getInviteTag.mockResolvedValue(existingTag);
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({
        'oldcode': 'existingTag',
        'newcode': 'otherTag'
      });

      await inviteCommand.handleTagSubcommand(mockInteraction);

      expect(mockDatabase.setInviteTag).toHaveBeenCalledWith('existingTag', expect.objectContaining({
        code: 'newcode',
        createdAt: '2025-01-01',
        createdBy: 'user-1'
      }));
      expect(mockDatabase.setInviteCodeToTagMap).toHaveBeenCalledWith(
        mockInteraction.guildId,
        {
          'newcode': 'existingTag'
        }
      );
    });
  });

  describe('handleSetupSubcommand', () => {
    it('should configure invite notifications channel', async () => {
      const mockChannel = { id: 'ch-1', type: ChannelType.GuildText, toString: () => '<#ch-1>' };
      const mockInteraction = createMockInteraction({
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel)
        }
      });

      await inviteCommand.handleSetupSubcommand(mockInteraction);

      expect(mockDatabase.setInviteNotificationChannel).toHaveBeenCalledWith('ch-1');
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invite Notifications Configured');
    });

    it('should error if non-text channel', async () => {
      const mockChannel = { id: 'ch-1', type: ChannelType.GuildVoice };
      const mockInteraction = createMockInteraction({
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel)
        }
      });

      await inviteCommand.handleSetupSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invalid Channel Type');
    });
  });

  describe('handleListSubcommand', () => {
    it('should inform if no tags found', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getAllInviteTagsData.mockResolvedValue([]);

      await inviteCommand.handleListSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('No tagged invites found.');
    });

    it('should list tagged invite codes, handling chunk formatting', async () => {
      const mockInteraction = createMockInteraction();
      const tags = [
        { name: 'tagA', code: 'codeA' },
        { name: 'tagB', code: 'x'.repeat(480) } // large string to cause multi field chunking but <= 1024 limit
      ];
      mockDatabase.getAllInviteTagsData.mockResolvedValue(tags);

      await inviteCommand.handleListSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Tagged Invites');
      expect(embed.data.fields.length).toBe(2);
    });

    it('should restrict to 25 fields in list embed', async () => {
      const mockInteraction = createMockInteraction();
      const tags = Array.from({ length: 600 }, (_, i) => ({
        name: `tag${i.toString().padStart(4, '0')}`,
        code: `code${i}`
      }));
      mockDatabase.getAllInviteTagsData.mockResolvedValue(tags);

      await inviteCommand.handleListSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields.length).toBeLessThanOrEqual(25);
      expect(embed.data.footer.text).toContain('Showing first 25 of 600 tags');
    });
  });

  describe('handleCreateSubcommand', () => {
    it('should error if bot lacks guild permission', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.guild.members.me.permissions.has.mockReturnValue(false);

      await inviteCommand.handleCreateSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Missing Permissions');
    });

    it('should create invite in targeted channel with custom expiry/uses, warning if code is already mapped to a different tag', async () => {
      const mockChannel = {
        id: 'ch-text',
        createInvite: jest.fn().mockResolvedValue({ code: 'newlyCreated' }),
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('newTag'),
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getInteger: jest.fn().mockImplementation((name) => {
            if (name === 'max-uses') return 5;
            if (name === 'max-age') return 86400 * 2; // 2 days
            return null;
          })
        }
      });

      mockDatabase.getInviteTag.mockResolvedValue(null);
      // Cover line 502
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({
        'newlycreated': 'differentTag'
      });

      await inviteCommand.handleCreateSubcommand(mockInteraction);

      expect(mockChannel.createInvite).toHaveBeenCalledWith({
        maxUses: 5,
        maxAge: 172800,
        unique: true
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('Code already mapped to different tag, overwriting.', expect.any(Object));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invite Created and Tagged');
    });

    it('should fallback to first available channel if not provided', async () => {
      const mockChannel = {
        id: 'ch-first',
        type: ChannelType.GuildText,
        createInvite: jest.fn().mockResolvedValue({ code: 'firstCode' }),
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag-first'),
          getChannel: jest.fn().mockReturnValue(null),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      mockInteraction.guild.channels.cache = new Collection([
        ['ch-first', mockChannel]
      ]);

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'old' });

      await inviteCommand.handleCreateSubcommand(mockInteraction);

      expect(mockChannel.createInvite).toHaveBeenCalled();
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Invite Created and Tag Updated');
    });

    it('should show error if no channel is available', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag-first'),
          getChannel: jest.fn().mockReturnValue(null)
        }
      });

      mockInteraction.guild.channels.cache = new Collection();

      await inviteCommand.handleCreateSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('No Channel Available');
    });

    it('should show error if target channel permissions are missing', async () => {
      const mockChannel = {
        id: 'ch-text',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(false)
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('newTag'),
          getChannel: jest.fn().mockReturnValue(mockChannel)
        }
      });

      await inviteCommand.handleCreateSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Missing Permissions');
    });

    it('should show error when createInvite throws error', async () => {
      const mockChannel = {
        id: 'ch-text',
        createInvite: jest.fn().mockRejectedValue(new Error('Discord error')),
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('newTag'),
          getChannel: jest.fn().mockReturnValue(mockChannel)
        }
      });

      await inviteCommand.handleCreateSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Failed to Create Invite');
    });
  });

  describe('handleRemoveSubcommand', () => {
    it('should error if tag not found', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('nonexistent')
        }
      });

      mockDatabase.getInviteTag.mockResolvedValue(null);

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Tag Not Found');
    });

    it('should delete invite if found in guild and bot has ManageGuild permissions', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag1')
        }
      });

      const mockInvite = {
        code: 'code1',
        delete: jest.fn().mockResolvedValue(true)
      };

      mockInteraction.guild.invites.fetch = jest.fn().mockResolvedValue(new Collection([
        ['code1', mockInvite]
      ]));

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'code1', name: 'tag1' });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code1': 'tag1' });

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      expect(mockInvite.delete).toHaveBeenCalled();
      expect(mockDatabase.deleteInviteTag).toHaveBeenCalledWith('tag1');
      expect(mockDatabase.setInviteCodeToTagMap).toHaveBeenCalledWith(mockInteraction.guildId, {});
    });

    it('should delete invite if bot created it but lacks ManageGuild permissions', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag1')
        }
      });

      const mockInvite = {
        code: 'code1',
        inviter: { id: 'bot-123' },
        delete: jest.fn().mockResolvedValue(true)
      };

      mockInteraction.guild.members.me.permissions.has.mockReturnValue(false); // ManageGuild false
      mockInteraction.guild.members.me.id = 'bot-123';
      mockInteraction.guild.invites.fetch = jest.fn().mockResolvedValue(new Collection([
        ['code1', mockInvite]
      ]));

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'code1', name: 'tag1' });

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      expect(mockInvite.delete).toHaveBeenCalled();
    });

    it('should skip delete if bot lacks ManageGuild and did not create invite', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag1')
        }
      });

      const mockInvite = {
        code: 'code1',
        inviter: { id: 'other-user' },
        delete: jest.fn()
      };

      mockInteraction.guild.members.me.permissions.has.mockReturnValue(false);
      mockInteraction.guild.members.me.id = 'bot-123';
      mockInteraction.guild.invites.fetch = jest.fn().mockResolvedValue(new Collection([
        ['code1', mockInvite]
      ]));

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'code1', name: 'tag1' });

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      expect(mockInvite.delete).not.toHaveBeenCalled();
    });

    it('should skip delete but proceed with DB cleanup if invites fetch fails while lacking ManageGuild', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag1')
        }
      });

      mockInteraction.guild.members.me.permissions.has.mockReturnValue(false); // ManageGuild false
      mockInteraction.guild.invites.fetch = jest.fn().mockRejectedValue(new Error('Discord error'));

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'code1', name: 'tag1' });

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      // Cover lines 642-643
      expect(mockLogger.debug).toHaveBeenCalledWith("Bot doesn't have ManageGuild permission, cannot fetch invites to check creator.");
      expect(mockDatabase.deleteInviteTag).toHaveBeenCalledWith('tag1');
    });

    it('should handle failures/throws in invite delete but proceed with DB cleanup', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag1')
        }
      });

      const mockInvite = {
        code: 'code1',
        delete: jest.fn().mockRejectedValue(new Error('Discord server is offline'))
      };

      mockInteraction.guild.invites.fetch = jest.fn().mockResolvedValue(new Collection([
        ['code1', mockInvite]
      ]));

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'code1', name: 'tag1' });
      mockDatabase.getInviteCodeToTagMap.mockResolvedValue({ 'code1': 'tag1' });

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      // Cover lines 664-668
      expect(mockInvite.delete).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to delete invite from Discord.', expect.any(Object));
      expect(mockDatabase.deleteInviteTag).toHaveBeenCalledWith('tag1');
    });

    it('should fail with error if DB or delete throws error', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tag1')
        }
      });

      mockDatabase.getInviteTag.mockResolvedValue({ code: 'code1', name: 'tag1' });
      mockDatabase.deleteInviteTag.mockRejectedValue(new Error('db fail'));

      await inviteCommand.handleRemoveSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Failed to Remove Tag');
    });
  });

  describe('autocomplete', () => {
    it('should return matching tags', async () => {
      const mockInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue({ name: 'name', value: 'my' })
        },
        respond: jest.fn().mockResolvedValue(true)
      };

      const tags = [
        { name: 'myTag', tagName: 'myTag' },
        { name: 'other', tagName: 'other' }
      ];
      mockDatabase.getAllInviteTagsData.mockResolvedValue(tags);

      await inviteCommand.autocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'myTag', value: 'myTag' }
      ]);
    });

    it('should return empty list on error', async () => {
      const mockInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue({ name: 'name', value: 'my' })
        },
        respond: jest.fn().mockResolvedValue(true)
      };

      mockDatabase.getAllInviteTagsData.mockRejectedValue(new Error('fail'));

      await inviteCommand.autocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    it('should reply with correct database messages', async () => {
      const mockInteraction = createMockInteraction();
      await inviteCommand.handleError(mockInteraction, new Error('DATABASE_WRITE_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to save the invite tag. Please try again later.'
      }));

      await inviteCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve invite tags. Please try again later.'
      })); // Cover lines 781-782
    });

    it('should fallback to reply if editReply fails, logging the followUpError', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('Discord API unavailable'));

      await inviteCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));

      // Cover lines 791-797
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for invite command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve invite tags. Please try again later.'
      }));
    });
  });
});
