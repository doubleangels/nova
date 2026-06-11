const { createPredictionScheduler } = require('./predictionScheduler');
const { getSeasonFixtures, isApiConfigured, isMockApiEnabled } = require('./worldCupClient');
const {
  isWorldCupGameConfigured,
  buildPromptEmbed,
  isInReminderWindow,
  scoreFinishedFixtures,
  resetMockDemoState,
  store
} = require('./worldCupUtils');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./worldCupMockData');

const config = require('../config');

const BUTTON_PREFIX = 'worldcup:predict:';

const scheduler = createPredictionScheduler({
  logLabel: 'World Cup',
  buttonPrefix: BUTTON_PREFIX,
  aiGameId: 'worldcup',
  participantRoleId: config.worldCupParticipantRoleId,
  channelId: config.worldCupChannelId,
  isApiConfigured,
  isGameConfigured: isWorldCupGameConfigured,
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
  repromptWorldCupFixture: scheduler.repromptFixture,
  runWorldCupPoll: scheduler.runPoll,
  runWorldCupStartup: scheduler.runStartup,
  startWorldCupScheduler: scheduler.startScheduler,
  stopWorldCupScheduler: scheduler.stopScheduler
};
