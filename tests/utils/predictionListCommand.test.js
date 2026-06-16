const {
  splitContentIntoPages,
  buildUserPredictionLines,
  buildPredictionsEmbed,
  buildPredictionsFooter
} = require('../../utils/predictionListCommand');

describe('predictionListCommand', () => {
  it('should split long line lists into pages', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `• line ${i} ${'x'.repeat(40)}`);
    const pages = splitContentIntoPages(lines, 500);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toContain('line 0');
    expect(pages.join('')).toContain('line 199');
  });

  it('should chunk individual lines that exceed the page length', () => {
    const longLine = `• ${'x'.repeat(1200)}`;
    const pages = splitContentIntoPages([longLine], 500);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(longLine);
  });

  it('should build user prediction lines with missing data', () => {
    const lines = buildUserPredictionLines(
      [{ fixtureId: 42, prediction: null }],
      new Map(),
      () => 'fixture line',
      () => 'home'
    );
    expect(lines[0]).toContain('42');
    expect(lines[0]).toContain('prediction data missing');
  });

  it('should return a blank page for empty line lists', () => {
    expect(splitContentIntoPages([])).toEqual(['']);
  });

  it('should build footer with page numbers when paginated', () => {
    expect(buildPredictionsFooter(12, 0, 3)).toBe('Total points: 12 · Page 1/3');
    expect(buildPredictionsFooter(12, 1, 3)).toBe('Total points: 12 · Page 2/3');
    expect(buildPredictionsFooter(5, 0, 1)).toBe('Total points: 5');
  });

  it('should build embed with or without footer', () => {
    const withFooter = buildPredictionsEmbed('worldcup', 'Title', 'content', 'footer text');
    expect(withFooter.data.footer.text).toBe('footer text');

    const withoutFooter = buildPredictionsEmbed('worldcup', 'Title', 'content');
    expect(withoutFooter.data.footer).toBeUndefined();
  });

  it('should defer ephemerally when viewing your own predictions', async () => {
    const { handlePredictionsSubcommand } = require('../../utils/predictionListCommand');
    const { MessageFlags } = require('discord.js');
    const interaction = {
      user: { id: 'caller-1' },
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'caller-1', displayName: 'Caller' })
      },
      reply: jest.fn(),
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue()
    };

    await handlePredictionsSubcommand(interaction, {
      gameId: 'worldcup',
      paginationPrefix: 'worldcup_predictions',
      logger: { debug: jest.fn(), error: jest.fn() },
      isApiConfigured: () => true,
      getSeasonFixtures: async () => [],
      getUserPredictionFixtureIds: async () => [1],
      getPredictionsForUser: async () => [{
        fixtureId: 1,
        prediction: {
          homeScore: 1,
          awayScore: 0,
          resultPick: 'home',
          scored: false
        }
      }],
      getUserPoints: async () => 0,
      formatFixtureLine: () => 'fixture',
      formatResultPickDisplay: () => 'home'
    });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('should defer ephemerally when viewing another user predictions', async () => {
    const { handlePredictionsSubcommand } = require('../../utils/predictionListCommand');
    const { MessageFlags } = require('discord.js');
    const interaction = {
      user: { id: 'caller-1' },
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'other-1', displayName: 'Other User' })
      },
      reply: jest.fn(),
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue()
    };

    await handlePredictionsSubcommand(interaction, {
      gameId: 'club',
      paginationPrefix: 'football_predictions',
      logger: { debug: jest.fn(), error: jest.fn() },
      isApiConfigured: () => true,
      getSeasonFixtures: async () => [
        { id: 1, kickoff: '2026-06-01T12:00:00Z' },
        { id: 2, kickoff: '2026-06-02T12:00:00Z' }
      ],
      getUserPredictionFixtureIds: async () => [1, 2],
      getPredictionsForUser: async () => [{
        fixtureId: 1,
        prediction: {
          homeScore: 1,
          awayScore: 0,
          resultPick: 'home',
          scored: false
        }
      }, {
        fixtureId: 2,
        prediction: null
      }],
      getUserPoints: async () => 3,
      formatFixtureLine: () => 'fixture',
      formatResultPickDisplay: () => 'home'
    });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('should handle completely empty lines array to cover the empty pages branch', async () => {
    const { handlePredictionsSubcommand } = require('../../utils/predictionListCommand');
    const interaction = {
      user: { id: 'caller-1' },
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'other-1', displayName: 'Other User' })
      },
      reply: jest.fn(),
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue()
    };

    await handlePredictionsSubcommand(interaction, {
      gameId: 'club',
      paginationPrefix: 'football_predictions',
      logger: { debug: jest.fn(), error: jest.fn() },
      isApiConfigured: () => true,
      getSeasonFixtures: async () => [],
      getUserPredictionFixtureIds: async () => [1],
      getPredictionsForUser: async () => [], // returns empty
      getUserPoints: async () => 0,
      formatFixtureLine: () => 'line',
      formatResultPickDisplay: () => 'home'
    });

    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should show another user empty message', async () => {
    const { handlePredictionsSubcommand } = require('../../utils/predictionListCommand');
    const interaction = {
      user: { id: 'caller-1' },
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'other-1', displayName: 'Other User' })
      },
      reply: jest.fn(),
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue()
    };

    await handlePredictionsSubcommand(interaction, {
      gameId: 'club',
      paginationPrefix: 'football_predictions',
      logger: { debug: jest.fn(), error: jest.fn() },
      isApiConfigured: () => true,
      getSeasonFixtures: async () => [],
      getUserPredictionFixtureIds: async () => [],
      getPredictionsForUser: async () => [],
      getUserPoints: async () => 0,
      formatFixtureLine: () => 'line',
      formatResultPickDisplay: () => 'home'
    });

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Other User has not submitted')
    }));
  });
});

describe('predictionListCommand pagination', () => {
  let mockCreatePaginatedResults;
  let replyWithPagination;
  let handlePredictionsSubcommand;

  beforeEach(() => {
    jest.resetModules();
    mockCreatePaginatedResults = jest.fn().mockResolvedValue();
    jest.doMock('../../utils/searchUtils', () => ({
      createPaginatedResults: mockCreatePaginatedResults
    }));
    ({ replyWithPagination, handlePredictionsSubcommand } = require('../../utils/predictionListCommand'));
  });

  it('should call createPaginatedResults for multi-page replies', async () => {
    const interaction = {
      user: { id: 'user-123' },
      editReply: jest.fn().mockResolvedValue({ createMessageComponentCollector: jest.fn() })
    };

    await replyWithPagination(
      interaction,
      ['page one', 'page two'],
      index => buildPredictionsEmbed('worldcup', 'Title', `content ${index}`),
      'worldcup_predictions',
      { debug: jest.fn(), error: jest.fn() }
    );

    expect(mockCreatePaginatedResults).toHaveBeenCalled();
  });
});
