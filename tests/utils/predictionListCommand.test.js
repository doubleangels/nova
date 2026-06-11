const {
  buildAllPredictionsPages,
  splitContentIntoPages,
  buildUserPredictionLines,
  buildPredictionsEmbed,
  buildAllPredictionsPageEmbed
} = require('../../utils/predictionListCommand');

describe('predictionListCommand', () => {
  it('should split long line lists into pages', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `• line ${i} ${'x'.repeat(40)}`);
    const pages = splitContentIntoPages(lines, 500);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toContain('line 0');
    expect(pages.join('')).toContain('line 199');
  });

  it('should build all-predictions pages without splitting user sections when possible', () => {
    const usersData = [
      {
        userId: '111',
        points: 5,
        lines: ['• A vs B: pick']
      },
      {
        userId: '222',
        points: 2,
        lines: ['• C vs D: pick']
      }
    ];

    const pages = buildAllPredictionsPages(usersData, 3800);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('<@111>');
    expect(pages[0]).toContain('<@222>');
  });

  it('should paginate all-predictions across users when content is large', () => {
    const usersData = [
      {
        userId: '111',
        points: 5,
        lines: Array.from({ length: 80 }, (_, i) => `• match ${i} ${'y'.repeat(50)}`)
      },
      {
        userId: '222',
        points: 2,
        lines: ['• short pick']
      }
    ];

    const pages = buildAllPredictionsPages(usersData, 800);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('<@111>');
    expect(pages[pages.length - 1]).toContain('<@222>');
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

  it('should build all-predictions page embed with footer when paginated', () => {
    const embed = buildAllPredictionsPageEmbed('worldcup', 'content', 1, 3);
    expect(embed.data.footer.text).toBe('Page 2/3');
  });

  it('should return a blank page for empty line lists', () => {
    expect(splitContentIntoPages([])).toEqual(['']);
    expect(buildAllPredictionsPages([])).toEqual([]);
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
      getAllPredictorUserIds: async () => [],
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

  it('should sort tied users by id when showing all predictions', async () => {
    const { handlePredictionsSubcommand } = require('../../utils/predictionListCommand');
    const interaction = {
      user: { id: 'caller-1' },
      options: {
        getUser: jest.fn().mockReturnValue(null)
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
      getAllPredictorUserIds: async () => ['user-b', 'user-a'],
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
      getUserPoints: async () => 3,
      formatFixtureLine: () => 'fixture',
      formatResultPickDisplay: () => 'home'
    });

    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description.indexOf('<@user-a>')).toBeLessThan(description.indexOf('<@user-b>'));
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
