const { createPredictionInteractionHandlers } = require('./predictionInteractionHandlers');
const { isApiConfigured, getFixtureById } = require('./footballClient');
const { BUTTON_PREFIX } = require('./footballScheduler');
const {
  store,
  scoreFinishedFixtures
} = require('./footballUtils');
const { formatFixtureTeam } = require('./worldCupTeamFlags');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./footballMockData');

const PICK_PREFIX = 'football:pick:';

const handlers = createPredictionInteractionHandlers({
  gameId: 'club',
  pickPrefix: PICK_PREFIX,
  buttonPrefix: BUTTON_PREFIX,
  logLabel: 'Football',
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
  isFootballPickSelect: handlers.isPickSelect,
  parsePickCustomId: handlers.parsePickCustomId,
  buildPredictionSelectRows: handlers.buildPredictionSelectRows,
  buildPredictionFormContent: handlers.buildPredictionFormContent,
  handleFootballPredictButton: handlers.handlePredictButton,
  handleFootballPickSelect: handlers.handlePickSelect
};
