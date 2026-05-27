const path = require('path');
const dayjs = require('dayjs');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { getSeasonFixtures } = require('./worldCupClient');
const keyvModule = require('keyv');
const Keyv = keyvModule.default ?? keyvModule;
const { getSharedKeyvStore } = require('./sqliteStore');

/**
 * @typedef {Object} NormalizedFixture
 * @property {number} id
 * @property {string} home
 * @property {string} away
 * @property {string} kickoff ISO date
 * @property {string} status
 * @property {{ home: number|null, away: number|null }} goals
 */

/**
 * @typedef {Object} WorldCupPrediction
 * @property {number} homeScore
 * @property {number} awayScore
 * @property {'home'|'draw'|'away'} resultPick
 * @property {string} submittedAt
 * @property {boolean} [scored]
 * @property {number} [scorePoints]
 * @property {number} [resultPoints]
 * @property {number} [pointsAwarded]
 */

const worldCupKeyv = new Keyv({
  store: getSharedKeyvStore(),
  namespace: 'worldcup'
});

worldCupKeyv.on('error', err => logger.error('World Cup Keyv connection error.', { err }));

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
function isWorldCupGameConfigured() {
  const hasApi =
    config.worldCupMockApi ||
    (config.footballDataApiKey && String(config.footballDataApiKey).trim());

  return Boolean(
    hasApi &&
    config.worldCupChannelId &&
    String(config.worldCupChannelId).trim()
  );
}

/**
 * @returns {Promise<string[]>}
 */
async function getRegisteredUserIds() {
  return (await worldCupKeyv.get('registered')) || [];
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
    await worldCupKeyv.set('registered', list);
  }
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @returns {Promise<WorldCupPrediction|null>}
 */
async function getPrediction(userId, fixtureId) {
  return (await worldCupKeyv.get(`prediction:${userId}:${fixtureId}`)) || null;
}

/**
 * @param {string} userId
 * @param {number} fixtureId
 * @param {WorldCupPrediction} prediction
 * @returns {Promise<void>}
 */
async function savePrediction(userId, fixtureId, prediction) {
  await worldCupKeyv.set(`prediction:${userId}:${fixtureId}`, prediction);

  const indexKey = `predictions_by_fixture:${fixtureId}`;
  const userIds = (await worldCupKeyv.get(indexKey)) || [];
  if (!userIds.includes(userId)) {
    userIds.push(userId);
    await worldCupKeyv.set(indexKey, userIds);
  }

  const userIndexKey = `user_predictions:${userId}`;
  const fixtureIds = (await worldCupKeyv.get(userIndexKey)) || [];
  if (!fixtureIds.includes(fixtureId)) {
    fixtureIds.push(fixtureId);
    await worldCupKeyv.set(userIndexKey, fixtureIds);
  }
}

/**
 * @param {string} userId
 * @returns {Promise<number[]>}
 */
async function getUserPredictionFixtureIds(userId) {
  return (await worldCupKeyv.get(`user_predictions:${userId}`)) || [];
}

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function getUserPoints(userId) {
  return (await worldCupKeyv.get(`points:${userId}`)) || 0;
}

/**
 * @param {string} userId
 * @param {number} delta
 * @returns {Promise<number>}
 */
async function addUserPoints(userId, delta) {
  const current = await getUserPoints(userId);
  const next = current + delta;
  await worldCupKeyv.set(`points:${userId}`, next);
  return next;
}

/**
 * @returns {Promise<number[]>}
 */
async function getPromptedFixtures() {
  return (await worldCupKeyv.get('prompted_fixtures')) || [];
}

/**
 * @param {number} fixtureId
 * @returns {Promise<void>}
 */
async function markFixturePrompted(fixtureId) {
  const list = await getPromptedFixtures();
  if (!list.includes(fixtureId)) {
    list.push(fixtureId);
    await worldCupKeyv.set('prompted_fixtures', list);
  }
}

/**
 * @returns {Promise<number[]>}
 */
async function getScoredFixtures() {
  return (await worldCupKeyv.get('scored_fixtures')) || [];
}

/**
 * @param {number} fixtureId
 * @returns {Promise<void>}
 */
async function markFixtureScored(fixtureId) {
  const list = await getScoredFixtures();
  if (!list.includes(fixtureId)) {
    list.push(fixtureId);
    await worldCupKeyv.set('scored_fixtures', list);
  }
}

/**
 * @param {number} fixtureId
 * @returns {Promise<string[]>}
 */
async function getPredictorIdsForFixture(fixtureId) {
  return (await worldCupKeyv.get(`predictions_by_fixture:${fixtureId}`)) || [];
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
  return `**${fixture.home}** vs **${fixture.away}** — ${kickoff} (\`${fixture.status}\`)`;
}

/**
 * @param {NormalizedFixture} fixture
 * @returns {EmbedBuilder}
 */
function buildPromptEmbed(fixture) {
  return new EmbedBuilder()
    .setColor(config.baseEmbedColor)
    .setTitle('World Cup prediction')
    .setDescription(
      `${formatFixtureLine(fixture)}\n\n` +
      'Submit your **score** (home & away goals) and **result** (`home`, `draw`, or `away`) before kickoff.'
    )
    .setFooter({ text: 'Use the button below to open the prediction form.' });
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
    .setTitle(`Full time: ${fixture.home} ${home}–${away} ${fixture.away}`)
    .setDescription(formatFixtureLine(fixture));

  if (earners.length === 0) {
    embed.addFields({
      name: 'Points',
      value: 'No registered predictions earned points for this match.'
    });
  } else {
    const lines = earners
      .sort((a, b) => b.total - a.total)
      .map(e => `<@${e.userId}> — **+${e.total}** pts (score: ${e.scorePoints}, result: ${e.resultPoints})`);
    embed.addFields({
      name: 'Points earned',
      value: lines.join('\n').slice(0, 1024)
    });
  }

  embed.setFooter({ text: 'Check standings with /worldcup leaderboard' });
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
 * @param {import('discord.js').Client} client
 * @returns {Promise<number>}
 */
async function scoreFinishedFixtures(client) {
  if (!isWorldCupGameConfigured()) return 0;

  const fixtures = await getSeasonFixtures({ forceRefresh: true });
  const scoredList = await getScoredFixtures();
  const finished = fixtures.filter(
    f => f.status === 'FT' &&
      f.goals.home != null &&
      f.goals.away != null &&
      !scoredList.includes(f.id)
  );

  let scoredCount = 0;
  const channelId = config.worldCupChannelId;

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
        logger.error('Failed to post World Cup match announcement.', {
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
function isInReminderWindow(fixture, now = new Date(), reminderHours = config.worldCupReminderHours) {
  if (!fixture.kickoff || !OPEN_STATUSES.has(fixture.status)) return false;
  const kickoff = dayjs(fixture.kickoff);
  const start = kickoff.subtract(reminderHours, 'hour');
  const current = dayjs(now);
  return (current.isAfter(start) || current.isSame(start)) && current.isBefore(kickoff);
}

/**
 * @param {string} raw
 * @returns {'home'|'draw'|'away'|null}
 */
function parseResultPick(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'home' || normalized === 'h') return 'home';
  if (normalized === 'away' || normalized === 'a') return 'away';
  if (normalized === 'draw' || normalized === 'd') return 'draw';
  return null;
}

/**
 * @param {string} homeRaw
 * @param {string} awayRaw
 * @returns {{ homeScore: number, awayScore: number }|{ error: string }}
 */
function parseScoreInputs(homeRaw, awayRaw) {
  const homeScore = parseInt(String(homeRaw).trim(), 10);
  const awayScore = parseInt(String(awayRaw).trim(), 10);
  if (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 15) {
    return { error: 'Home score must be a whole number from 0 to 15.' };
  }
  if (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 15) {
    return { error: 'Away score must be a whole number from 0 to 15.' };
  }
  return { homeScore, awayScore };
}

module.exports = {
  worldCupKeyv,
  getOutcome,
  calculateScorePoints,
  calculateResultPoints,
  isFixtureOpenForPrediction,
  isWorldCupGameConfigured,
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
  formatDiscordTimestamp,
  formatFixtureLine,
  buildPromptEmbed,
  buildAnnouncementEmbed,
  getLeaderboard,
  scoreFinishedFixtures,
  isInReminderWindow,
  parseResultPick,
  parseScoreInputs
};
