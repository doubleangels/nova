/**
 * Shared scoring helpers for World Cup and club football prediction games.
 */

/**
 * @param {number|null|undefined} home
 * @param {number|null|undefined} away
 * @returns {'home'|'draw'|'away'|null}
 */
function getOutcome(home, away) {
  if (home == null || away == null) return null;
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}

/**
 * @param {number} homeScore
 * @param {number} awayScore
 * @returns {'home'|'draw'|'away'}
 */
function resultPickFromScore(homeScore, awayScore) {
  return getOutcome(homeScore, awayScore) || 'draw';
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
 * Aligns winner pick with the predicted scoreline (same rule as matchPredictionAi).
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {'home'|'draw'|'away'} resultPick
 * @returns {'home'|'draw'|'away'}
 */
function alignResultPickWithScore(homeScore, awayScore, resultPick) {
  const fromScore = resultPickFromScore(homeScore, awayScore);
  return resultPick === fromScore ? resultPick : fromScore;
}

/**
 * @param {import('./predictionGameStore').PredictionStore} store
 * @param {{
 *   isConfigured: () => boolean,
 *   getFixtures: (opts?: { forceRefresh?: boolean }) => Promise<Array<{ id: number, status: string, goals: { home: number|null, away: number|null } }>>,
 *   buildAnnouncementEmbed: (fixture: unknown, earners: unknown[]) => import('discord.js').EmbedBuilder,
 *   logLabel: string
 * }} deps
 * @returns {(client?: import('discord.js').Client) => Promise<number>}
 */
function createScoreFinishedFixtures(store, deps) {
  let scoringInFlight = false;

  return async function scoreFinishedFixtures(client, prefetchedFixtures) {
    if (!deps.isConfigured()) return 0;
    if (scoringInFlight) return 0;

    scoringInFlight = true;
    try {
      const config = require('../config');
      const path = require('path');
      const logger = require('../logger')(path.basename(__filename));

      const fixtures =
        prefetchedFixtures ?? (await deps.getFixtures({ forceRefresh: false }));
      const scoredList = await store.getScoredFixtures();
      const scoredSet = new Set(scoredList);
      const finished = fixtures.filter(
        f =>
          f.status === 'FT' &&
          f.goals.home != null &&
          f.goals.away != null &&
          !scoredSet.has(f.id)
      );

      let scoredCount = 0;
      const channelId = deps.channelId;

      for (const fixture of finished) {
        if (scoredSet.has(fixture.id)) continue;

        if (!(await store.tryAcquireScoringLock(fixture.id))) continue;

        try {
          const predictorEntries = await store.getPredictionsForFixture(fixture.id);
          /** @type {Array<{ userId: string, prediction: import('./predictionGameStore').GamePrediction, pointsDelta: number }>} */
          const updates = [];
          /** @type {Array<{ userId: string, scorePoints: number, resultPoints: number, total: number }>} */
          const earners = [];

          for (const { userId, prediction } of predictorEntries) {
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

            updates.push({
              userId,
              prediction: {
                ...prediction,
                scored: true,
                scorePoints: scorePts,
                resultPoints: resultPts,
                pointsAwarded: total
              },
              pointsDelta: total
            });

            if (total > 0) {
              earners.push({
                userId,
                scorePoints: scorePts,
                resultPoints: resultPts,
                total
              });
            }
          }

          await store.applyFixtureScoringResults(fixture.id, updates);
          scoredSet.add(fixture.id);
          scoredCount += 1;

          if (client && channelId && earners.length > 0) {
            try {
              const channel = await client.channels.fetch(channelId);
              if (channel?.isTextBased()) {
                const embed = deps.buildAnnouncementEmbed(fixture, earners);
                await channel.send({ embeds: [embed] });
              }
            } catch (err) {
              logger.error(`Failed to post ${deps.logLabel} match announcement.`, {
                err,
                fixtureId: fixture.id,
                channelId
              });
            }
          }
        } finally {
          await store.releaseScoringLock(fixture.id);
        }
      }

      return scoredCount;
    } finally {
      scoringInFlight = false;
    }
  };
}

module.exports = {
  getOutcome,
  resultPickFromScore,
  calculateScorePoints,
  calculateResultPoints,
  alignResultPickWithScore,
  createScoreFinishedFixtures
};
