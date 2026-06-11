const dayjs = require('dayjs');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('predictionPromptCommand', () => {
  let promptCommand;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = { info: jest.fn(), error: jest.fn() };
    promptCommand = require('../../utils/predictionPromptCommand');
  });

  describe('getUpcomingFixtures', () => {
    it('should filter to open upcoming fixtures sorted by kickoff', async () => {
      const getSeasonFixtures = jest.fn().mockResolvedValue([
        {
          id: 2,
          status: 'NS',
          kickoff: dayjs().add(2, 'day').toISOString()
        },
        {
          id: 1,
          status: 'NS',
          kickoff: dayjs().add(1, 'day').toISOString()
        },
        {
          id: 3,
          status: 'FT',
          kickoff: dayjs().add(1, 'day').toISOString()
        },
        {
          id: 4,
          status: 'NS',
          kickoff: dayjs().subtract(1, 'hour').toISOString()
        }
      ]);

      const fixtures = await promptCommand.getUpcomingFixtures(getSeasonFixtures);

      expect(fixtures.map(f => f.id)).toEqual([1, 2]);
    });

    it('should pass competition filter to getSeasonFixtures', async () => {
      const getSeasonFixtures = jest.fn().mockResolvedValue([]);
      await promptCommand.getUpcomingFixtures(getSeasonFixtures, { competition: 'PL' });
      expect(getSeasonFixtures).toHaveBeenCalledWith({ competition: 'PL' });
    });
  });

  describe('buildFixtureSelectOptions', () => {
    it('should map fixtures to select options with truncated labels', () => {
      const longLine = 'x'.repeat(120);
      const options = promptCommand.buildFixtureSelectOptions(
        [{ id: 99 }],
        () => longLine
      );
      expect(options[0].value).toBe('99');
      expect(options[0].label.length).toBeLessThanOrEqual(100);
    });
  });

  describe('handlePromptSubcommand', () => {
    const baseDeps = {
      gameId: 'club',
      selectCustomId: 'football:prompt:select',
      isApiConfigured: () => true,
      isGameConfigured: () => true,
      getSeasonFixtures: jest.fn(),
      formatFixtureLine: jest.fn().mockReturnValue('A vs B')
    };

    it('should require a guild', async () => {
      const interaction = createMockInteraction({
        guild: null,
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSubcommand(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should deny non-administrators', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: { has: jest.fn().mockReturnValue(false) }
      });
      await promptCommand.handlePromptSubcommand(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject when API is not configured', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSubcommand(interaction, {
        ...baseDeps,
        isApiConfigured: () => false
      });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject when game is not configured', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSubcommand(interaction, {
        ...baseDeps,
        isGameConfigured: () => false
      });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should show select menu for upcoming fixtures', async () => {
      baseDeps.getSeasonFixtures.mockResolvedValue([
        {
          id: 1,
          status: 'NS',
          kickoff: dayjs().add(1, 'day').toISOString()
        }
      ]);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSubcommand(interaction, baseDeps);
      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ components: expect.any(Array) })
      );
    });

    it('should pass competition filter when provided', async () => {
      const getSeasonFixtures = jest.fn().mockResolvedValue([
        {
          id: 1,
          status: 'NS',
          kickoff: dayjs().add(1, 'day').toISOString()
        }
      ]);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSubcommand(interaction, {
        ...baseDeps,
        getSeasonFixtures,
        competition: 'PL'
      });
      expect(getSeasonFixtures).toHaveBeenCalledWith({ competition: 'PL' });
    });

    it('should report when no upcoming fixtures exist', async () => {
      baseDeps.getSeasonFixtures.mockResolvedValue([]);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSubcommand(interaction, baseDeps);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('No upcoming') })
      );
    });
  });

  describe('handlePromptSelect', () => {
    const openFixture = {
      id: 7,
      status: 'NS',
      kickoff: dayjs().add(1, 'day').toISOString()
    };

    let baseDeps;

    beforeEach(() => {
      baseDeps = {
        gameId: 'worldcup',
        isApiConfigured: () => true,
        isGameConfigured: () => true,
        getFixtureById: jest.fn().mockResolvedValue(openFixture),
        formatFixtureLine: jest.fn().mockReturnValue('Home vs Away'),
        repromptFixture: jest.fn().mockResolvedValue(true),
        logger: mockLogger
      };
    });

    it('should require a guild for select handling', async () => {
      const interaction = createMockInteraction({
        guild: null,
        values: ['7'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should deny non-administrators for select handling', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['7'],
        memberPermissions: { has: jest.fn().mockReturnValue(false) }
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject select when API or game is not configured', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['7'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await promptCommand.handlePromptSelect(interaction, {
        ...baseDeps,
        isGameConfigured: () => false
      });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject invalid fixture ids', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['not-a-number'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(baseDeps.repromptFixture).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('invalid') })
      );
    });

    it('should report when fixture cannot be loaded', async () => {
      baseDeps.getFixtureById.mockResolvedValue(null);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['7'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('load') })
      );
    });

    it('should reprompt selected fixture for administrators', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['7'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(baseDeps.repromptFixture).toHaveBeenCalledWith(interaction.client, openFixture);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('posted') })
      );
    });

    it('should reject closed fixtures', async () => {
      baseDeps.getFixtureById.mockResolvedValue({
        id: 7,
        status: 'FT',
        kickoff: dayjs().subtract(1, 'day').toISOString()
      });
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['7'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(baseDeps.repromptFixture).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('closed') })
      );
    });

    it('should report failure when reprompt does not post', async () => {
      baseDeps.repromptFixture.mockResolvedValue(false);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['7'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await promptCommand.handlePromptSelect(interaction, baseDeps);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Could not post') })
      );
    });
  });
});
