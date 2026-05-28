const { createPredictionInteractionHandlers } = require('./predictionInteractionHandlers');
const { isApiConfigured, getFixtureById } = require('./worldCupClient');
const { BUTTON_PREFIX } = require('./worldCupScheduler');
const {
  store,
  scoreFinishedFixtures
} = require('./worldCupUtils');
const { formatFixtureTeam } = require('./worldCupTeamFlags');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./worldCupMockData');

const PICK_PREFIX = 'worldcup:pick:';

const handlers = createPredictionInteractionHandlers({
  gameId: 'worldcup',
  pickPrefix: PICK_PREFIX,
  buttonPrefix: BUTTON_PREFIX,
  logLabel: 'World Cup',
  isApiConfigured,
  getFixtureById,
  store,
  formatFixtureTeam,
  mockPlayableIds: MOCK_PLAYABLE_MATCH_IDS,
  scoreFinishedFixtures
});

module.exports = {
  PICK_PREFIX,
  BUTTON_PREFIX,
  isWorldCupPickSelect: handlers.isPickSelect,
  parsePickCustomId: handlers.parsePickCustomId,
  buildPredictionSelectRows: handlers.buildPredictionSelectRows,
  buildPredictionFormContent: handlers.buildPredictionFormContent,
  handleWorldCupPredictButton: handlers.handlePredictButton,
  handleWorldCupPickSelect: handlers.handlePickSelect
};
