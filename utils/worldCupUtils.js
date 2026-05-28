const config = require('../config');
const { createPredictionStore } = require('./predictionGameStore');
const { createScoreFinishedFixtures } = require('./predictionGameScoring');
const {
  isFixtureOpenForPrediction,
  isInReminderWindow,
  formatDiscordTimestamp,
  formatFixtureLine,
  formatResultPickDisplay,
  buildPromptEmbed: buildPromptEmbedUi,
  buildAnnouncementEmbed: buildAnnouncementEmbedUi,
  truncateModalLabel,
  goalsModalLabel,
  formatResultPickOptions,
  parseResultPick,
  parseScoreInputs,
  isPendingPredictionComplete
} = require('./predictionGameUi');
const { formatFixtureTeam } = require('./worldCupTeamFlags');
const { getSeasonFixtures } = require('./worldCupClient');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./worldCupMockData');
const {
  getOutcome,
  calculateScorePoints,
  calculateResultPoints,
  alignResultPickWithScore
} = require('./predictionGameScoring');

const store = createPredictionStore('worldcup', 'World Cup');

function formatLinePrefix() {
  return '';
}

function buildPromptEmbed(fixture, options = {}) {
  return buildPromptEmbedUi('worldcup', fixture, formatFixtureTeam, formatLinePrefix, options);
}

function buildAnnouncementEmbed(fixture, earners) {
  return buildAnnouncementEmbedUi(
    'worldcup',
    fixture,
    earners,
    formatFixtureTeam,
    formatLinePrefix
  );
}

function isWorldCupGameConfigured() {
  const hasApi =
    config.predictionMockApi ||
    (config.footballDataApiKey && String(config.footballDataApiKey).trim());

  return Boolean(
    hasApi &&
    config.predictionChannelId &&
    String(config.predictionChannelId).trim()
  );
}

async function areAllMockPlayableFixturesPredicted() {
  return store.areAllMockPlayableFixturesPredicted(MOCK_PLAYABLE_MATCH_IDS);
}

async function resetWorldCupGame() {
  await store.resetGame();
}

async function resetMockDemoState() {
  return store.resetMockDemoState(MOCK_PLAYABLE_MATCH_IDS, 'worldcup');
}

/**
 * @param {import('./predictionGameUi').NormalizedFixture[]} fixtures
 * @returns {Promise<typeof fixtures>}
 */
async function applyMockInstantFinishToFixtures(fixtures) {
  const { applyMockInstantFinishToFixtures: applyFinish } = require('./predictionMockFinish');
  const mockData = require('./worldCupMockData');
  return applyFinish(store, MOCK_PLAYABLE_MATCH_IDS, mockData, fixtures);
}

const scoreFinishedFixtures = createScoreFinishedFixtures(store, {
  isConfigured: isWorldCupGameConfigured,
  getFixtures: getSeasonFixtures,
  buildAnnouncementEmbed,
  logLabel: 'World Cup'
});

module.exports = {
  worldCupKeyv: store.keyv,
  store,
  getOutcome,
  calculateScorePoints,
  calculateResultPoints,
  alignResultPickWithScore,
  isFixtureOpenForPrediction,
  isWorldCupGameConfigured,
  getRegisteredUserIds: () => store.getRegisteredUserIds(),
  isUserRegistered: userId => store.isUserRegistered(userId),
  addRegisteredUser: userId => store.addRegisteredUser(userId),
  getPrediction: (userId, fixtureId) => store.getPrediction(userId, fixtureId),
  savePrediction: (userId, fixtureId, prediction) =>
    store.savePrediction(userId, fixtureId, prediction),
  getUserPredictionFixtureIds: userId => store.getUserPredictionFixtureIds(userId),
  getUserPoints: userId => store.getUserPoints(userId),
  addUserPoints: (userId, delta) => store.addUserPoints(userId, delta),
  getPromptedFixtures: () => store.getPromptedFixtures(),
  markFixturePrompted: fixtureId => store.markFixturePrompted(fixtureId),
  getScoredFixtures: () => store.getScoredFixtures(),
  markFixtureScored: fixtureId => store.markFixtureScored(fixtureId),
  getPredictorIdsForFixture: fixtureId => store.getPredictorIdsForFixture(fixtureId),
  isPendingPredictionComplete,
  savePendingPrediction: (userId, fixtureId, partial) =>
    store.savePendingPrediction(userId, fixtureId, partial),
  getPendingPrediction: (userId, fixtureId) =>
    store.getPendingPrediction(userId, fixtureId),
  clearPendingPrediction: (userId, fixtureId) =>
    store.clearPendingPrediction(userId, fixtureId),
  PENDING_PREDICTION_TTL_MS: store.PENDING_PREDICTION_TTL_MS,
  formatDiscordTimestamp,
  formatFixtureTeam,
  formatFixtureLine: fixture => formatFixtureLine(fixture, formatFixtureTeam, formatLinePrefix),
  buildPromptEmbed,
  buildAnnouncementEmbed,
  getLeaderboard: limit => store.getLeaderboard(limit),
  areAllMockPlayableFixturesPredicted,
  resetWorldCupGame,
  resetMockDemoState,
  applyMockInstantFinishToFixtures,
  isPromptingPaused: () => store.isPromptingPaused(),
  setPromptingPaused: paused => store.setPromptingPaused(paused),
  scoreFinishedFixtures,
  isInReminderWindow,
  truncateModalLabel,
  goalsModalLabel,
  formatResultPickDisplay: (fixture, resultPick) =>
    formatResultPickDisplay(fixture, formatFixtureTeam, resultPick),
  formatResultPickOptions: fixture => formatResultPickOptions(fixture, formatFixtureTeam),
  parseResultPick: (raw, fixture) => parseResultPick(raw, fixture, formatFixtureTeam),
  parseScoreInputs: (homeRaw, awayRaw, fixture) =>
    parseScoreInputs(homeRaw, awayRaw, fixture, formatFixtureTeam)
};
