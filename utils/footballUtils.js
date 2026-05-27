const path = require('path');
const dayjs = require('dayjs');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { getSeasonFixtures } = require('./footballClient');
const keyvModule = require('keyv');
const Keyv = keyvModule.default ?? keyvModule;
const { getSharedKeyvStore } = require('./sqliteStore');
const { formatFixtureTeam } = require('./worldCupTeamFlags');
const msgs = require('./predictionMessages');

/**
 * @typedef {Object} NormalizedFixture
 * @property {number} id
 * @property {string} home
 * @property {string} away
 * @property {string|null} [homeIso2]
 * @property {string|null} [awayIso2]
 * @property {string|null} [homeTla]
 * @property {string|null} [awayTla]
 * @property {string|null} [competitionCode]
 * @property {string|null} [competitionName]
 * @property {string} kickoff ISO date
 * @property {string} status
 * @property {{ home: number|null, away: number|null }} goals
 */

/**
 * @typedef {Object} FootballPrediction
 * @property {number} homeScore
 * @property {number} awayScore
 * @property {'home'|'draw'|'away'} resultPick
 * @property {string} submittedAt
 * @property {boolean} [scored]
 * @property {number} [scorePoints]
 * @property {number} [resultPoints]
 * @property {number} [pointsAwarded]
 */

const footballKeyv = new Keyv({
  store: getSharedKeyvStore(),
  namespace: 'football'
});

footballKeyv.on('error', err => logger.error('Football Keyv connection error.', { err }));

const OPEN_STATUSES = new Set(['NS', 'TBD', 'PST']);

/**
 * @param {number|null|undefined} home
 * @param {number|null|undefined} away
 * @returns {'home'|'draw'|'away'|null}
 */
function getOutcome(home, away) {
  if (home == null || away == null) return null;
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

/**
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {number} actualHome
 * @param {number} actualAway
 * @returns {number}
 */
function calculateScorePoints(homeScore, awayScore, actualHome, actualAway) {
  if (homeScore === actualHome && awayScore === actualAway) return 3;
  const predicted = getOutcome(homeScore, awayScore);
  const actual = getOutcome(actualHome, actualAway);
  if (predicted && predicted === actual) return 1;
  return 0;
}

/**
 * @param {'home'|'draw'|'away'} resultPick
 * @param {number} actualHome
 * @param {number} actualAway
 * @returns {number}
 */
function calculateResultPoints(resultPick, actualHome, actualAway) {
  const actual = getOutcome(actualHome, actualAway);
  return actual && resultPick === actual ? 1 : 0;
}

/**
 * @param {NormalizedFixture} fixture
 * @param {Date} [now]
 * @returns {boolean}
 */
function isFixtureOpenForPrediction(fixture, now = new Date()) {
  if (!fixture) return false;
  if (!OPEN_STATUSES.has(fixture.status)) return false;
  if (!fixture.kickoff) return true;
  return dayjs(fixture.kickoff).isAfter(dayjs(now));
}

/**
 * @returns {boolean}
 */
function isFootballGameConfigured() {
  const hasApi =
    config.predictionMockApi ||
    (config.footballDataApiKey && String(config.footballDataApiKey).trim());

  return Boolean(
    hasApi &&
    config.predictionChannelId &&
    String(config.predictionChannelId).trim()
  );
}

/**
 * @returns {Promise<string[]>}
 */
async function getRegisteredUserIds() {
  return (await footballKeyv.get('registered')) || [];
}

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserRegistered(userId) {
  const list = await getRegisteredUserIds();
  return list.includes(userId);
}

/**
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function addRegisteredUser(userId) {
  const list = await getRegisteredUserIds();
  if (!list.includes(userId)) {
    list.push(userId);
    await footballKeyv.set('registered', list);
  }
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @returns {Promise<FootballPrediction|null>}
 */
async function getPrediction(userId, fixtureId) {
  return (await footballKeyv.get(`prediction:${userId}:${fixtureId}`)) || null;
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @param {FootballPrediction} prediction
 * @returns {Promise<void>}
 */
async function savePrediction(userId, fixtureId, prediction) {
  await footballKeyv.set(`prediction:${userId}:${fixtureId}`, prediction);

  const indexKey = `predictions_by_fixture:${fixtureId}`;
  const userIds = (await footballKeyv.get(indexKey)) || [];
  if (!userIds.includes(userId)) {
    userIds.push(userId);
    await footballKeyv.set(indexKey, userIds);
  }

  const userIndexKey = `user_predictions:${userId}`;
  const fixtureIds = (await footballKeyv.get(userIndexKey)) || [];
  if (!fixtureIds.includes(fixtureId)) {
    fixtureIds.push(fixtureId);
    await footballKeyv.set(userIndexKey, fixtureIds);
  }
}

/**
 * @param {string} userId
 * @returns {Promise<number[]>}
 */
async function getUserPredictionFixtureIds(userId) {
  return (await footballKeyv.get(`user_predictions:${userId}`)) || [];
}

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function getUserPoints(userId) {
  return (await footballKeyv.get(`points:${userId}`)) || 0;
}

/**
 * @param {string} userId
 * @param {number} delta
 * @returns {Promise<number>}
 */
async function addUserPoints(userId, delta) {
  const current = await getUserPoints(userId);
  const next = current + delta;
  await footballKeyv.set(`points:${userId}`, next);
  return next;
}

/**
 * @returns {Promise<number[]>}
 */
async function getPromptedFixtures() {
  return (await footballKeyv.get('prompted_fixtures')) || [];
}

/**
 * @param {number} fixtureId
 * @returns {Promise<void>}
 */
async function markFixturePrompted(fixtureId) {
  const list = await getPromptedFixtures();
  if (!list.includes(fixtureId)) {
    list.push(fixtureId);
    await footballKeyv.set('prompted_fixtures', list);
  }
}

/**
 * @returns {Promise<number[]>}
 */
async function getScoredFixtures() {
  return (await footballKeyv.get('scored_fixtures')) || [];
}

/**
 * @param {number} fixtureId
 * @returns {Promise<void>}
 */
async function markFixtureScored(fixtureId) {
  const list = await getScoredFixtures();
  if (!list.includes(fixtureId)) {
    list.push(fixtureId);
    await footballKeyv.set('scored_fixtures', list);
  }
}

/**
 * @param {number} fixtureId
 * @returns {Promise<string[]>}
 */
async function getPredictorIdsForFixture(fixtureId) {
  return (await footballKeyv.get(`predictions_by_fixture:${fixtureId}`)) || [];
}

const PENDING_PREDICTION_TTL_MS = config.predictionPendingTtlMs;

/**
 * @typedef {Object} PendingPrediction
 * @property {number} [homeScore]
 * @property {number} [awayScore]
 * @property {'home'|'draw'|'away'} [resultPick]
 * @property {string} updatedAt
 */

/**
 * @param {PendingPrediction|null|undefined} pending
 * @returns {boolean}
 */
function isPendingPredictionComplete(pending) {
  if (!pending) return false;
  const home = pending.homeScore;
  const away = pending.awayScore;
  return (
    Number.isInteger(home) &&
    home >= 0 &&
    home <= 15 &&
    Number.isInteger(away) &&
    away >= 0 &&
    away <= 15 &&
    ['home', 'draw', 'away'].includes(pending.resultPick)
  );
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @param {Partial<PendingPrediction>} partial
 * @returns {Promise<PendingPrediction>}
 */
async function savePendingPrediction(userId, fixtureId, partial) {
  const existing = (await getPendingPrediction(userId, fixtureId)) || {};
  const next = {
    ...existing,
    ...partial,
    updatedAt: new Date().toISOString()
  };
  await footballKeyv.set(
    `pending_prediction:${userId}:${fixtureId}`,
    next,
    PENDING_PREDICTION_TTL_MS
  );
  return next;
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @returns {Promise<PendingPrediction|null>}
 */
async function getPendingPrediction(userId, fixtureId) {
  return (await footballKeyv.get(`pending_prediction:${userId}:${fixtureId}`)) || null;
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @returns {Promise<void>}
 */
async function clearPendingPrediction(userId, fixtureId) {
  await footballKeyv.delete(`pending_prediction:${userId}:${fixtureId}`);
}

/**
 * @param {string} isoDate
 * @param {'t'|'T'|'d'|'D'|'f'|'F'|'R'} [style='f']
 * @returns {string}
 */
function formatDiscordTimestamp(isoDate, style = 'f') {
  const unix = Math.floor(new Date(isoDate).getTime() / 1000);
  if (!Number.isFinite(unix)) return 'TBD';
  return `<t:${unix}:${style}>`;
}

/**
 * @param {NormalizedFixture} fixture
 * @returns {string}
 */
function formatFixtureLine(fixture) {
  const kickoff = fixture.kickoff
    ? formatDiscordTimestamp(fixture.kickoff)
    : 'TBD';
  const league = fixture.competitionName || fixture.competitionCode;
  const prefix = league ? `**[${league}]** ` : '';
  return `${prefix}**${formatFixtureTeam(fixture, 'home')}** vs **${formatFixtureTeam(fixture, 'away')}** - ${kickoff} (\`${fixture.status}\`)`;
}

/**
 * @param {NormalizedFixture} fixture
 * @returns {EmbedBuilder}
 */
/**
 * @param {NormalizedFixture} fixture
 * @param {{ aiPrediction?: import('./matchPredictionAi').AiMatchPrediction }} [options]
 * @returns {EmbedBuilder}
 */
function buildPromptEmbed(fixture, options = {}) {
  const league = fixture.competitionName || fixture.competitionCode;
  const embed = new EmbedBuilder()
    .setColor(config.baseEmbedColor)
    .setTitle(msgs.buildPromptTitle('club', league))
    .setDescription(
      `${formatFixtureLine(fixture)}\n\n${msgs.buildPromptDescription(fixture, formatFixtureTeam)}`
    )
    .setFooter({ text: msgs.PROMPT_FOOTER });

  if (options.aiPrediction) {
    embed.addFields({
      name: msgs.AI_PICK_FIELD_NAME,
      value: msgs
        .formatAiPredictionField(fixture, options.aiPrediction, formatFixtureTeam)
        .slice(0, 1024)
    });
  }

  return embed;
}

/**
 * @param {NormalizedFixture} fixture
 * @param {Array<{ userId: string, scorePoints: number, resultPoints: number, total: number }>} earners
 * @returns {EmbedBuilder}
 */
function buildAnnouncementEmbed(fixture, earners) {
  const home = fixture.goals.home ?? '?';
  const away = fixture.goals.away ?? '?';
  const embed = new EmbedBuilder()
    .setColor(config.baseEmbedColor)
    .setTitle(
      `Full time - ${formatFixtureTeam(fixture, 'home')} ${home}-${away} ${formatFixtureTeam(fixture, 'away')}`
    )
    .setDescription(formatFixtureLine(fixture));

  embed.addFields({
    name: msgs.POINTS_FIELD_NAME,
    value: msgs.formatPointsEarnedField(earners).slice(0, 1024)
  });

  embed.setFooter({ text: msgs.buildResultsFooter('club') });
  return embed;
}

/**
 * @param {number} [limit]
 * @returns {Promise<Array<{ userId: string, points: number }>>}
 */
async function getLeaderboard(limit = 10) {
  const registered = await getRegisteredUserIds();
  const entries = await Promise.all(
    registered.map(async userId => ({
      userId,
      points: await getUserPoints(userId)
    }))
  );
  return entries
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

/**
 * @returns {Promise<boolean>}
 */
async function areAllMockPlayableFixturesPredicted() {
  if (!config.predictionMockApi) return false;

  const { MOCK_PLAYABLE_MATCH_IDS } = require('./footballMockData');
  for (const fixtureId of MOCK_PLAYABLE_MATCH_IDS) {
    const predictorIds = await getPredictorIdsForFixture(fixtureId);
    if (predictorIds.length === 0) return false;
  }
  return true;
}

/**
 * Wipes all Football game data in Keyv (registrations, predictions, points, prompts, pending).
 * @returns {Promise<void>}
 */
async function resetFootballGame() {
  await footballKeyv.clear();
}

/**
 * Clears mock demo match state so each bot start posts fresh prompts.
 * @returns {Promise<void>}
 */
async function resetMockDemoState() {
  if (!config.predictionMockApi) return;

  const { MOCK_PLAYABLE_MATCH_IDS } = require('./footballMockData');
  const { clearAiPredictionCache } = require('./matchPredictionAi');
  clearAiPredictionCache(MOCK_PLAYABLE_MATCH_IDS, 'club');

  const prompted = await getPromptedFixtures();
  await footballKeyv.set(
    'prompted_fixtures',
    prompted.filter(id => !MOCK_PLAYABLE_MATCH_IDS.includes(id))
  );

  const scored = await getScoredFixtures();
  await footballKeyv.set(
    'scored_fixtures',
    scored.filter(id => !MOCK_PLAYABLE_MATCH_IDS.includes(id))
  );

  for (const fixtureId of MOCK_PLAYABLE_MATCH_IDS) {
    const userIds = await getPredictorIdsForFixture(fixtureId);
    for (const userId of userIds) {
      await footballKeyv.delete(`prediction:${userId}:${fixtureId}`);
      const userFixtureIds = await getUserPredictionFixtureIds(userId);
      await footballKeyv.set(
        `user_predictions:${userId}`,
        userFixtureIds.filter(id => id !== fixtureId)
      );
    }
    await footballKeyv.delete(`predictions_by_fixture:${fixtureId}`);
  }
}

/**
 * Mock-only: after every demo fixture has at least one prediction, expose all as
 * full-time with scripted goals so scoring can run in one batch.
 * @param {NormalizedFixture[]} fixtures
 * @returns {Promise<NormalizedFixture[]>}
 */
async function applyMockInstantFinishToFixtures(fixtures) {
  if (!config.predictionMockApi) return fixtures;
  if (!(await areAllMockPlayableFixturesPredicted())) return fixtures;

  const {
    isMockPlayableMatchId,
    getMockScriptedFullTimeGoals
  } = require('./footballMockData');

  return fixtures.map(fixture => {
    if (!isMockPlayableMatchId(fixture.id)) return fixture;

    const goals = getMockScriptedFullTimeGoals(fixture.id);
    if (!goals) return fixture;

    return {
      ...fixture,
      status: 'FT',
      goals: { home: goals.home, away: goals.away }
    };
  });
}

/**
 * @param {import('discord.js').Client} client
 * @returns {Promise<number>}
 */
async function scoreFinishedFixtures(client) {
  if (!isFootballGameConfigured()) return 0;

  const fixtures = await getSeasonFixtures({ forceRefresh: true });
  const scoredList = await getScoredFixtures();
  const finished = fixtures.filter(
    f => f.status === 'FT' &&
      f.goals.home != null &&
      f.goals.away != null &&
      !scoredList.includes(f.id)
  );

  let scoredCount = 0;
  const channelId = config.predictionChannelId;

  for (const fixture of finished) {
    const predictorIds = await getPredictorIdsForFixture(fixture.id);
    /** @type {Array<{ userId: string, scorePoints: number, resultPoints: number, total: number }>} */
    const earners = [];

    for (const userId of predictorIds) {
      const prediction = await getPrediction(userId, fixture.id);
      if (!prediction || prediction.scored) continue;

      const scorePts = calculateScorePoints(
        prediction.homeScore,
        prediction.awayScore,
        fixture.goals.home,
        fixture.goals.away
      );
      const resultPts = calculateResultPoints(
        prediction.resultPick,
        fixture.goals.home,
        fixture.goals.away
      );
      const total = scorePts + resultPts;

      prediction.scored = true;
      prediction.scorePoints = scorePts;
      prediction.resultPoints = resultPts;
      prediction.pointsAwarded = total;
      await savePrediction(userId, fixture.id, prediction);

      if (total > 0) {
        await addUserPoints(userId, total);
        earners.push({ userId, scorePoints: scorePts, resultPoints: resultPts, total });
      }
    }

    await markFixtureScored(fixture.id);
    scoredCount += 1;

    if (client && channelId) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          const embed = buildAnnouncementEmbed(fixture, earners);
          await channel.send({ embeds: [embed] });
        }
      } catch (err) {
        logger.error('Failed to post Football match announcement.', {
          err,
          fixtureId: fixture.id,
          channelId
        });
      }
    }
  }

  return scoredCount;
}

/**
 * @param {NormalizedFixture} fixture
 * @param {Date} [now]
 * @param {number} [reminderHours]
 * @returns {boolean}
 */
function isInReminderWindow(fixture, now = new Date(), reminderHours = config.predictionReminderHours) {
  if (!fixture.kickoff || !OPEN_STATUSES.has(fixture.status)) return false;
  const kickoff = dayjs(fixture.kickoff);
  const start = kickoff.subtract(reminderHours, 'hour');
  const current = dayjs(now);
  return (current.isAfter(start) || current.isSame(start)) && current.isBefore(kickoff);
}

/**
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncateModalLabel(text, maxLength = 45) {
  const s = String(text || '').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1)}…`;
}

/**
 * @param {string} teamName
 * @returns {string}
 */
function goalsModalLabel(teamName) {
  return truncateModalLabel(`${truncateModalLabel(teamName, 38)} goals`, 45);
}

/**
 * @param {NormalizedFixture} fixture
 * @param {'home'|'draw'|'away'} resultPick
 * @returns {string}
 */
function formatResultPickDisplay(fixture, resultPick) {
  if (resultPick === 'home') return formatFixtureTeam(fixture, 'home');
  if (resultPick === 'away') return formatFixtureTeam(fixture, 'away');
  if (resultPick === 'draw') return 'Draw';
  return resultPick;
}

/**
 * @param {string} raw
 * @param {NormalizedFixture} [fixture]
 * @returns {'home'|'draw'|'away'|null}
 */
function parseResultPick(raw, fixture) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'draw' || normalized === 'd') return 'draw';

  if (fixture) {
    const homeNorm = fixture.home.trim().toLowerCase();
    const awayNorm = fixture.away.trim().toLowerCase();
    if (normalized === homeNorm) return 'home';
    if (normalized === awayNorm) return 'away';
  }

  if (normalized === 'home' || normalized === 'h') return 'home';
  if (normalized === 'away' || normalized === 'a') return 'away';
  return null;
}

/**
 * @param {string} homeRaw
 * @param {string} awayRaw
 * @param {NormalizedFixture} [fixture]
 * @returns {{ homeScore: number, awayScore: number }|{ error: string }}
 */
function parseScoreInputs(homeRaw, awayRaw, fixture) {
  const homeLabel = fixture ? formatFixtureTeam(fixture, 'home') : 'Home';
  const awayLabel = fixture ? formatFixtureTeam(fixture, 'away') : 'Away';
  const homeScore = parseInt(String(homeRaw).trim(), 10);
  const awayScore = parseInt(String(awayRaw).trim(), 10);
  if (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 15) {
    return { error: `${homeLabel} score must be a whole number from 0 to 15.` };
  }
  if (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 15) {
    return { error: `${awayLabel} score must be a whole number from 0 to 15.` };
  }
  return { homeScore, awayScore };
}

/**
 * @param {NormalizedFixture} fixture
 * @returns {string}
 */
function formatResultPickOptions(fixture) {
  return `**${formatFixtureTeam(fixture, 'home')}**, **draw**, or **${formatFixtureTeam(fixture, 'away')}**`;
}

module.exports = {
  footballKeyv,
  getOutcome,
  calculateScorePoints,
  calculateResultPoints,
  isFixtureOpenForPrediction,
  isFootballGameConfigured,
  getRegisteredUserIds,
  isUserRegistered,
  addRegisteredUser,
  getPrediction,
  savePrediction,
  getUserPredictionFixtureIds,
  getUserPoints,
  addUserPoints,
  getPromptedFixtures,
  markFixturePrompted,
  getScoredFixtures,
  markFixtureScored,
  getPredictorIdsForFixture,
  isPendingPredictionComplete,
  savePendingPrediction,
  getPendingPrediction,
  clearPendingPrediction,
  PENDING_PREDICTION_TTL_MS,
  formatDiscordTimestamp,
  formatFixtureTeam,
  formatFixtureLine,
  buildPromptEmbed,
  buildAnnouncementEmbed,
  getLeaderboard,
  areAllMockPlayableFixturesPredicted,
  resetFootballGame,
  resetMockDemoState,
  applyMockInstantFinishToFixtures,
  scoreFinishedFixtures,
  isInReminderWindow,
  truncateModalLabel,
  goalsModalLabel,
  formatResultPickDisplay,
  formatResultPickOptions,
  parseResultPick,
  parseScoreInputs
};
