#!/usr/bin/env node
/**
 * Re-scores a finished World Cup fixture after a scoring-rule change.
 *
 * Fetches the fixture and final score from football-data.org using
 * FOOTBALL_DATA_API_KEY (injected by Doppler in production).
 *
 * Usage (host — requires Doppler):
 *   doppler run -- node scripts/migrate-worldcup-scoring.js
 *   pnpm run migrate-worldcup-scoring
 *
 * Usage (Docker — stop nova first):
 *   docker compose run --rm --no-deps nova /app/scripts/migrate-worldcup-scoring.sh
 *   docker compose run --rm --no-deps nova /app/scripts/migrate-worldcup-scoring.sh --commit --force
 *
 * Optional: --fixture-id=ID, --home=Team, --away=Team
 * Fallback only: --goals-home=N --goals-away=N (when the API has no final score yet)
 *
 * Dry run by default. Stop the Nova bot before --commit --force.
 */

const {
  bootstrapMigrationEnv,
  getFootballApiReadiness
} = require('../utils/migrateWorldCupScoringEnv');

bootstrapMigrationEnv();

const config = require('../config');
const { checkDatabaseAccess } = require('../utils/dbScriptUtils');
const { sqlitePath } = require('../utils/sqliteStore');
const {
  parseDbWriteFlags,
  resolveDbWriteMode,
  printDbWriteDryRunHint
} = require('../utils/dbWriteCli');
const { buildFixtureRescoreUpdates } = require('../utils/predictionGameScoring');
const {
  getSeasonFixtures,
  getFixtureById,
  isApiConfigured
} = require('../utils/worldCupClient');
const { store } = require('../utils/worldCupUtils');

const SCRIPT_NAME = 'scripts/migrate-worldcup-scoring.js';

/**
 * @param {string[]} argv
 */
function parseScriptArgs(argv) {
  const { isCommit, isForce, positional } = parseDbWriteFlags(argv);
  const opts = {
    fixtureId: null,
    home: 'Mexico',
    away: 'South Africa',
    goalsHome: null,
    goalsAway: null
  };

  for (const arg of positional) {
    if (arg.startsWith('--fixture-id=')) {
      opts.fixtureId = Number(arg.slice('--fixture-id='.length));
    } else if (arg.startsWith('--home=')) {
      opts.home = arg.slice('--home='.length);
    } else if (arg.startsWith('--away=')) {
      opts.away = arg.slice('--away='.length);
    } else if (arg.startsWith('--goals-home=')) {
      opts.goalsHome = Number(arg.slice('--goals-home='.length));
    } else if (arg.startsWith('--goals-away=')) {
      opts.goalsAway = Number(arg.slice('--goals-away='.length));
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error(
        'Usage: node scripts/migrate-worldcup-scoring.js [--fixture-id=ID] [--home=Team] [--away=Team] [--goals-home=N] [--goals-away=N] [--commit --force]'
      );
      process.exit(1);
    }
  }

  if (opts.fixtureId != null && !Number.isFinite(opts.fixtureId)) {
    console.error('Invalid --fixture-id value.');
    process.exit(1);
  }

  if (
    (opts.goalsHome != null && !Number.isFinite(opts.goalsHome)) ||
    (opts.goalsAway != null && !Number.isFinite(opts.goalsAway))
  ) {
    console.error('Invalid --goals-home or --goals-away value.');
    process.exit(1);
  }

  return { ...opts, isCommit, isForce };
}

/**
 * @param {string} needle
 * @param {string} teamName
 */
function teamNameMatches(needle, teamName) {
  return teamName.toLowerCase().includes(needle.toLowerCase());
}

/**
 * @param {{
 *   fixtureId: number|null,
 *   home: string,
 *   away: string
 * }} opts
 */
async function resolveFixtureFromApi(opts) {
  if (opts.fixtureId != null) {
    const fixture = await getFixtureById(opts.fixtureId);
    if (!fixture) {
      throw new Error(
        `Fixture ${opts.fixtureId} was not found on football-data.org.`
      );
    }
    return fixture;
  }

  const fixtures = await getSeasonFixtures({ forceRefresh: true });
  if (fixtures.length === 0) {
    throw new Error(
      'football-data.org returned no World Cup fixtures. ' +
        'Check FOOTBALL_DATA_API_KEY, WORLD_CUP_COMPETITION_CODE, and WORLD_CUP_SEASON.'
    );
  }

  const match = fixtures.find(
    f =>
      (teamNameMatches(opts.home, f.home) && teamNameMatches(opts.away, f.away)) ||
      (teamNameMatches(opts.away, f.home) && teamNameMatches(opts.home, f.away))
  );

  if (!match) {
    throw new Error(
      `No World Cup fixture found for ${opts.home} vs ${opts.away} on football-data.org.`
    );
  }

  return match;
}

/**
 * @param {import('../utils/worldCupUtils').NormalizedFixture} fixture
 * @param {number|null} goalsHomeOverride
 * @param {number|null} goalsAwayOverride
 */
function resolveFinalScore(fixture, goalsHomeOverride, goalsAwayOverride) {
  if (goalsHomeOverride != null && goalsAwayOverride != null) {
    return { home: goalsHomeOverride, away: goalsAwayOverride };
  }

  if (fixture.goals.home == null || fixture.goals.away == null) {
    throw new Error(
      `Fixture ${fixture.id} (${fixture.home} vs ${fixture.away}) has no final score on football-data.org yet. ` +
        'Pass --goals-home and --goals-away to override.'
    );
  }

  return { home: fixture.goals.home, away: fixture.goals.away };
}

/**
 * @param {Array<{
 *   userId: string,
 *   oldTotal: number,
 *   newTotal: number,
 *   pointsDelta: number,
 *   scorePts: number,
 *   resultPts: number
 * }>} updates
 */
function printChangeSummary(updates) {
  if (updates.length === 0) {
    console.log('No prediction point changes are needed for this fixture.');
    return;
  }

  console.log('Planned changes:');
  for (const row of updates) {
    console.log(
      `  user ${row.userId}: ${row.oldTotal} -> ${row.newTotal} pts ` +
        `(delta ${row.pointsDelta >= 0 ? '+' : ''}${row.pointsDelta}; ` +
        `${row.scorePts} score, ${row.resultPts} result)`
    );
  }
}

async function main() {
  const args = parseScriptArgs(process.argv.slice(2));
  const writeMode = resolveDbWriteMode(
    { isCommit: args.isCommit, isForce: args.isForce },
    { scriptName: SCRIPT_NAME }
  );

  const apiReadiness = getFootballApiReadiness(config);
  if (!apiReadiness.ready) {
    console.error(apiReadiness.message);
    process.exit(1);
  }

  if (!isApiConfigured()) {
    console.error('football-data.org API is not configured after bootstrap.');
    process.exit(1);
  }

  console.log('=== World Cup scoring migration ===');
  console.log(`Database: ${sqlitePath}`);
  console.log(
    `Mode: ${writeMode.proceed ? 'COMMIT (database WILL be updated)' : 'DRY RUN (read-only)'}\n`
  );
  console.log(
    `football-data.org: competition ${config.worldCupCompetitionCode}, season ${config.worldCupSeason}\n`
  );

  const accessCheck = checkDatabaseAccess();
  if (!accessCheck.accessible && accessCheck.fileExists) {
    console.error('Cannot access the database file.');
    if (accessCheck.recommendation) {
      console.error(accessCheck.recommendation);
    }
    process.exit(1);
  }

  let fixture;
  try {
    console.log('Fetching fixture from football-data.org...');
    fixture = await resolveFixtureFromApi(args);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let finalScore;
  try {
    finalScore = resolveFinalScore(fixture, args.goalsHome, args.goalsAway);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(
    `Fixture: ${fixture.home} vs ${fixture.away} (id ${fixture.id}, status ${fixture.status})`
  );
  console.log(`Final score: ${finalScore.home}-${finalScore.away}\n`);

  const predictorEntries = await store.getPredictionsForFixture(fixture.id);
  const scoredCount = predictorEntries.filter(entry => entry.prediction?.scored).length;
  console.log(`Scored predictions on file: ${scoredCount}`);

  const updates = buildFixtureRescoreUpdates(
    predictorEntries,
    finalScore.home,
    finalScore.away
  );

  printChangeSummary(updates);

  if (!writeMode.proceed) {
    console.log('');
    printDbWriteDryRunHint(SCRIPT_NAME);
    return;
  }

  if (updates.length === 0) {
    return;
  }

  await store.applyFixtureRescoreUpdates(
    fixture.id,
    updates.map(({ userId, prediction, pointsDelta }) => ({
      userId,
      prediction,
      pointsDelta
    }))
  );

  console.log(`\nApplied ${updates.length} prediction update(s) for fixture ${fixture.id}.`);
}

main().catch(err => {
  console.error('Migration failed.', err);
  process.exit(1);
});
