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
const { getSeasonFixtures } = require('./footballClient');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./footballMockData');
const {
  getOutcome,
  calculateScorePoints,
  calculateResultPoints,
  alignResultPickWithScore
} = require('./predictionGameScoring');

const store = createPredictionStore('football', 'Football');

function formatLinePrefix(fixture) {
  const league = fixture.competitionName || fixture.competitionCode;
  return league ? `**[${league}]** ` : '';
}

function buildPromptEmbed(fixture, options = {}) {
  return buildPromptEmbedUi('club', fixture, formatFixtureTeam, formatLinePrefix, options);
}

function buildAnnouncementEmbed(fixture, earners) {
  return buildAnnouncementEmbedUi(
    'club',
    fixture,
    earners,
    formatFixtureTeam,
    formatLinePrefix
  );
}

function isFootballGameConfigured() {
  const hasApi =
    config.predictionMockApi ||
    (config.footballDataApiKey && String(config.footballDataApiKey).trim());

  return Boolean(
    hasApi &&
    config.footballChannelId &&
    String(config.footballChannelId).trim()
  );
}

async function areAllMockPlayableFixturesPredicted() {
  return store.areAllMockPlayableFixturesPredicted(MOCK_PLAYABLE_MATCH_IDS);
}

async function resetFootballGame() {
  await store.resetGame();
}

async function resetMockDemoState() {
  return store.resetMockDemoState(MOCK_PLAYABLE_MATCH_IDS, 'club');
}

/**
 * @param {object[]} fixtures
 * @returns {Promise<object[]>}
 */
async function applyMockInstantFinishToFixtures(fixtures) {
  const { applyMockInstantFinishToFixtures: applyFinish } = require('./predictionMockFinish');
  const mockData = require('./footballMockData');
  return applyFinish(store, MOCK_PLAYABLE_MATCH_IDS, mockData, fixtures);
}

const scoreFinishedFixtures = createScoreFinishedFixtures(store, {
  isConfigured: isFootballGameConfigured,
  getFixtures: getSeasonFixtures,
  buildAnnouncementEmbed,
  channelId: config.footballChannelId,
  logLabel: 'Football'
});

module.exports = {
  footballKeyv: store.keyv,
  store,
  getOutcome,
  calculateScorePoints,
  calculateResultPoints,
  alignResultPickWithScore,
  isFixtureOpenForPrediction,
  isFootballGameConfigured,
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
  getPredictionsForUser: (userId, fixtureIds) =>
    store.getPredictionsForUser(userId, fixtureIds),
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
  resetFootballGame,
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
