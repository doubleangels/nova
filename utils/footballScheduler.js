const { createPredictionScheduler } = require('./predictionScheduler');
const { getSeasonFixtures, isApiConfigured, isMockApiEnabled } = require('./footballClient');
const {
  isFootballGameConfigured,
  buildPromptEmbed,
  isInReminderWindow,
  scoreFinishedFixtures,
  resetMockDemoState,
  store
} = require('./footballUtils');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./footballMockData');

const BUTTON_PREFIX = 'football:predict:';

const scheduler = createPredictionScheduler({
  logLabel: 'Football',
  buttonPrefix: BUTTON_PREFIX,
  aiGameId: 'club',
  isApiConfigured,
  isGameConfigured: isFootballGameConfigured,
  isMockApiEnabled,
  mockPlayableIds: MOCK_PLAYABLE_MATCH_IDS,
  getSeasonFixtures,
  store,
  buildPromptEmbed,
  scoreFinishedFixtures,
  resetMockDemoState,
  isInReminderWindow
});

module.exports = {
  BUTTON_PREFIX,
  buildPromptChannelContent: scheduler.buildPromptChannelContent,
  buildPredictButtonRow: scheduler.buildPredictButtonRow,
  sendPredictionPrompts: scheduler.sendPredictionPrompts,
  runFootballPoll: scheduler.runPoll,
  runFootballStartup: scheduler.runStartup,
  startFootballScheduler: scheduler.startScheduler,
  stopFootballScheduler: scheduler.stopScheduler
};
