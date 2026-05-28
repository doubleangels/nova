const { MessageFlags, EmbedBuilder } = require('discord.js');
const { createPredictionInteractionHandlers } = require('../../utils/predictionInteractionHandlers');
const ui = require('../../utils/predictionGameUi');
const msgs = require('../../utils/predictionMessages');
const { alignResultPickWithScore } = require('../../utils/predictionGameScoring');
const config = require('../../config');

jest.mock('../../utils/predictionGameUi');
jest.mock('../../utils/predictionMessages');
jest.mock('../../utils/predictionGameScoring');
jest.mock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

describe('predictionInteractionHandlers', () => {
  let handlers;
  let options;
  let interaction;
  let store;

  beforeEach(() => {
    jest.resetAllMocks();
    
    store = {
      getPendingPrediction: jest.fn(),
      savePendingPrediction: jest.fn(),
      savePrediction: jest.fn(),
      isPendingPredictionComplete: jest.fn(),
      areAllMockPlayableFixturesPredicted: jest.fn(),
      isUserRegistered: jest.fn().mockResolvedValue(true),
      getPrediction: jest.fn().mockResolvedValue(null),
      clearPendingPrediction: jest.fn().mockResolvedValue()
    };

    options = {
      gameId: 'worldcup',
      pickPrefix: 'pred_wc_',
      buttonPrefix: 'btn_wc_',
      logLabel: 'World Cup',
      isApiConfigured: jest.fn().mockReturnValue(true),
      getFixtureById: jest.fn(),
      store,
      formatFixtureTeam: jest.fn((fix, side) => `${side}_team`),
      mockPlayableIds: [1],
      scoreFinishedFixtures: jest.fn()
    };

    handlers = createPredictionInteractionHandlers(options);

    interaction = {
      user: { id: 'user1' },
      guild: { id: 'guild1' },
      member: { id: 'user1' },
      channel: {
        messages: { fetch: jest.fn().mockResolvedValue({ id: 'msg1' }) }
      },
      message: { id: 'msg1' },
      client: {},
      customId: '',
      reply: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      showModal: jest.fn().mockResolvedValue(),
      fields: { getTextInputValue: jest.fn() },
      values: []
    };

    ui.truncateModalLabel.mockImplementation(l => l || 'Label');
    ui.formatResultPickDisplay.mockImplementation(l => l || 'Display');
    msgs.buildPredictionFormContentWithPick.mockReturnValue('Form content');
    msgs.errRegisterFirst = jest.fn().mockReturnValue('not registered');
  });

  describe('isPickSelect', () => {
    it('should return true if customId starts with pickPrefix', () => {
      expect(handlers.isPickSelect('pred_wc_home:1')).toBe(true);
    });
    
    it('should return false if customId does not start with pickPrefix', () => {
      expect(handlers.isPickSelect('btn_wc_1')).toBe(false);
      expect(handlers.isPickSelect(null)).toBe(false);
    });
  });

  describe('parsePickCustomId', () => {
    it('should parse valid pick custom IDs', () => {
      expect(handlers.parsePickCustomId('pred_wc_home:123')).toEqual({ side: 'home', fixtureId: 123 });
      expect(handlers.parsePickCustomId('pred_wc_away:456')).toEqual({ side: 'away', fixtureId: 456 });
      expect(handlers.parsePickCustomId('pred_wc_winner:789')).toEqual({ side: 'winner', fixtureId: 789 });
    });

    it('should return null for invalid side', () => {
      expect(handlers.parsePickCustomId('pred_wc_invalid:123')).toBeNull();
    });

    it('should return null for invalid fixture ID', () => {
      expect(handlers.parsePickCustomId('pred_wc_home:abc')).toBeNull();
    });
  });

  describe('buildPredictionSelectRows', () => {
    it('should build action rows', () => {
      ui.truncateModalLabel.mockImplementation(l => l);
      const rows = handlers.buildPredictionSelectRows(123, { home: 'A', away: 'B' });
      expect(rows).toHaveLength(3); // home, away, winner select menus
    });

    it('should use pending values in placeholders if provided', () => {
      ui.truncateModalLabel.mockImplementation(l => l);
      msgs.winnerPlaceholderSelected = jest.fn().mockReturnValue('winner selected');
      ui.formatResultPickDisplay.mockReturnValue('Home');
      
      const rows = handlers.buildPredictionSelectRows(123, { home: 'A', away: 'B' }, {
        homeScore: 1,
        awayScore: 2,
        resultPick: 'away'
      });
      
      expect(rows).toHaveLength(3);
      expect(msgs.winnerPlaceholderSelected).toHaveBeenCalledWith('Home');
      // The placeholders for scores should include the current values
      expect(rows[0].components[0].data.placeholder).toContain('goals: 1');
      expect(rows[1].components[0].data.placeholder).toContain('goals: 2');
    });
  });

  describe('buildPredictionFormContent', () => {
    it('should call msgs.buildPredictionFormContentWithPick', () => {
      msgs.buildPredictionFormContentWithPick.mockReturnValue('content');
      ui.formatResultPickDisplay.mockReturnValue('pick display');
      
      const content = handlers.buildPredictionFormContent({ id: 1 }, { resultPick: 'home' });
      expect(content).toBe('content');
      expect(msgs.buildPredictionFormContentWithPick).toHaveBeenCalled();
      
      // Test the inline format fn
      const formatFn = msgs.buildPredictionFormContentWithPick.mock.calls[0][2];
      expect(formatFn({}, 'home')).toBe('pick display');
    });
  });

  describe('handlePredictButton', () => {
    it('should reply with errNotConfigured if API is not configured', async () => {
      options.isApiConfigured.mockReturnValue(false);
      msgs.errNotConfigured = jest.fn().mockReturnValue('Not configured');
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Not configured',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reply with ERR_INVALID_MATCH if fixtureId is invalid', async () => {
      interaction.customId = 'btn_wc_abc';
      msgs.ERR_INVALID_MATCH = 'Invalid match';
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Invalid match',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reply with ERR_SERVER_ONLY if not in a guild', async () => {
      interaction.customId = 'btn_wc_123';
      interaction.guild = null;
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.any(String),
        flags: MessageFlags.Ephemeral
      }));
    });

    it('should reply with ERR_MATCH_NOT_FOUND if fixture not found', async () => {
      interaction.customId = 'btn_wc_123';
      options.getFixtureById.mockResolvedValue(null);
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.any(String),
        flags: MessageFlags.Ephemeral
      }));
    });

    it('should reply with FIXTURE_CLOSED_ERROR if fixture is closed', async () => {
      interaction.customId = 'btn_wc_123';
      options.getFixtureById.mockResolvedValue({ id: 123 });
      ui.isFixtureOpenForPrediction.mockReturnValue(false);
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.any(String),
        flags: MessageFlags.Ephemeral
      }));
    });

    it('should reply with ERR_ALREADY_PREDICTED if prediction exists', async () => {
      interaction.customId = 'btn_wc_123';
      options.getFixtureById.mockResolvedValue({ id: 123 });
      ui.isFixtureOpenForPrediction.mockReturnValue(true);
      store.isUserRegistered.mockResolvedValue(true);
      store.getPrediction.mockResolvedValue({ homeScore: 1 });
      msgs.ERR_ALREADY_PREDICTED = 'Already predicted';
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Already predicted',
        flags: MessageFlags.Ephemeral
      }));
    });

    it('should reply with registration error if not registered', async () => {
      interaction.customId = 'btn_wc_123';
      options.getFixtureById.mockResolvedValue({ id: 123 });
      ui.isFixtureOpenForPrediction.mockReturnValue(true);
      store.isUserRegistered.mockResolvedValue(false);
      config.worldCupParticipantRoleId = '12345';
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('not registered'),
        flags: MessageFlags.Ephemeral
      }));
    });

    it('should reply with registration error for club game', async () => {
      interaction.customId = 'btn_club_123';
      options.gameId = 'club';
      options.buttonPrefix = 'btn_club_';
      options.getFixtureById.mockResolvedValue({ id: 123 });
      ui.isFixtureOpenForPrediction.mockReturnValue(true);
      store.isUserRegistered.mockResolvedValue(false);
      config.footballParticipantRoleId = '67890';
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('not registered'),
        flags: MessageFlags.Ephemeral
      }));
    });

    it('should reply with prediction form if valid', async () => {
      interaction.customId = 'btn_wc_123';
      options.getFixtureById.mockResolvedValue({ id: 123 });
      ui.isFixtureOpenForPrediction.mockReturnValue(true);
      store.getPendingPrediction.mockResolvedValue({ resultPick: 'home' });
      msgs.buildPredictionFormContentWithPick.mockReturnValue('Form content');
      ui.truncateModalLabel.mockReturnValue('Label');
      
      await handlers.handlePredictButton(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Form content',
        flags: MessageFlags.Ephemeral,
        components: expect.any(Array)
      }));
    });
  });

  describe('handlePickSelect', () => {
    beforeEach(() => {
      interaction.customId = 'pred_wc_home:123';
      interaction.values = ['2'];
      options.getFixtureById.mockResolvedValue({ id: 123, home: 'A', away: 'B' });
      ui.isFixtureOpenForPrediction.mockReturnValue(true);
      store.getPendingPrediction.mockResolvedValue({});
    });

    it('should reply with ERR_INVALID_MATCH if parse PickCustomId fails', async () => {
      interaction.customId = 'pred_wc_invalid:abc';
      msgs.ERR_INVALID_MATCH = 'Invalid match';
      
      await handlers.handlePickSelect(interaction);
      
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Invalid match',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reply with closed error if fixture closed', async () => {
      ui.isFixtureOpenForPrediction.mockReturnValue(false);
      msgs.ERR_PREDICTIONS_CLOSED_SHORT = 'Closed short';
      
      await handlers.handlePickSelect(interaction);
      
      expect(store.clearPendingPrediction).toHaveBeenCalledWith('user1', 123);
      expect(interaction.update).toHaveBeenCalledWith({
        content: 'Closed short',
        components: []
      });
    });

    it('should return error if goals value is invalid', async () => {
      interaction.customId = 'pred_wc_home:123';
      interaction.values = ['invalid'];
      interaction.followUp = jest.fn().mockResolvedValue();
      msgs.ERR_GOALS_RANGE = 'Invalid goals';
      
      await handlers.handlePickSelect(interaction);
      
      expect(interaction.followUp).toHaveBeenCalledWith({
        content: 'Invalid goals',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should return error if winner value is invalid', async () => {
      interaction.customId = 'pred_wc_winner:123';
      interaction.values = ['invalid'];
      interaction.followUp = jest.fn().mockResolvedValue();
      msgs.ERR_INVALID_WINNER = 'Invalid winner';
      
      await handlers.handlePickSelect(interaction);
      
      expect(interaction.followUp).toHaveBeenCalledWith({
        content: 'Invalid winner',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should clear pending prediction if prediction already exists', async () => {
      interaction.values = ['2'];
      store.getPrediction.mockResolvedValue({ homeScore: 1 }); // Existing prediction exists
      msgs.ERR_ALREADY_PREDICTED = 'Already predicted';
      
      await handlers.handlePickSelect(interaction);
      
      expect(store.clearPendingPrediction).toHaveBeenCalledWith('user1', 123);
      expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Already predicted',
        components: []
      }));
    });

    it('should update pending prediction with home score', async () => {
      interaction.customId = 'pred_wc_home:123';
      interaction.values = ['2'];
      
      await handlers.handlePickSelect(interaction);
      
      expect(store.savePendingPrediction).toHaveBeenCalledWith(
        'user1', 123, expect.objectContaining({ homeScore: 2 })
      );
    });

    it('should update pending prediction with away score', async () => {
      interaction.customId = 'pred_wc_away:123';
      interaction.values = ['1'];
      
      await handlers.handlePickSelect(interaction);
      
      expect(store.savePendingPrediction).toHaveBeenCalledWith(
        'user1', 123, expect.objectContaining({ awayScore: 1 })
      );
    });

    it('should update pending prediction with winner', async () => {
      interaction.customId = 'pred_wc_winner:123';
      interaction.values = ['home'];
      
      await handlers.handlePickSelect(interaction);
      
      expect(store.savePendingPrediction).toHaveBeenCalledWith(
        'user1', 123, expect.objectContaining({ resultPick: 'home' })
      );
    });

    it('should finalize and save prediction when complete', async () => {
      ui.isPendingPredictionComplete.mockReturnValue(true);
      store.savePendingPrediction.mockResolvedValue({ homeScore: 2, awayScore: 1, resultPick: 'home' });
      alignResultPickWithScore.mockReturnValue('home');
      ui.formatResultPickDisplay.mockReturnValue('Home');
      
      await handlers.handlePickSelect(interaction);
      
      expect(store.savePrediction).toHaveBeenCalledWith('user1', 123, expect.objectContaining({
        homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
      }));
      expect(store.clearPendingPrediction).toHaveBeenCalledWith('user1', 123);
      expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array),
        content: null,
        components: []
      }));
    });

    it('should trigger scoreFinishedFixtures if mock Api and all predicted', async () => {
      config.predictionMockApi = true;
      ui.isPendingPredictionComplete.mockReturnValue(true);
      store.savePendingPrediction.mockResolvedValue({ homeScore: 2, awayScore: 1, resultPick: 'home' });
      alignResultPickWithScore.mockReturnValue('home');
      store.areAllMockPlayableFixturesPredicted.mockResolvedValue(true);
      
      await handlers.handlePickSelect(interaction);
      
      expect(options.scoreFinishedFixtures).toHaveBeenCalledWith(interaction.client);
    });
  });
});
