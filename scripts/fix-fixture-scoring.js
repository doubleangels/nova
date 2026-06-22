#!/usr/bin/env node
/**
 * Correct prediction points after a fixture was scored with the wrong final score.
 *
 * This happens when football-data.org briefly publishes an incorrect fullTime score
 * before the bot marks the fixture as scored. Scored fixtures are not re-evaluated
 * on later polls.
 *
 * Host usage:
 *   node scripts/fix-fixture-scoring.js --fixture 537371 --wrong 5-1 --correct 4-1
 *   node scripts/fix-fixture-scoring.js --commit --force --fixture 537371 --wrong 5-1 --correct 4-1
 *
 * Docker (stop the bot before --commit --force):
 *   docker compose stop nova
 *
 *   docker run --rm \
 *     -v "$(pwd)/data:/app/data:rw" \
 *     --entrypoint /app/docker-entrypoint.sh \
 *     ghcr.io/doubleangels/nova:latest \
 *     su-exec discordbot node scripts/fix-fixture-scoring.js \
 *       --fixture 537371 --wrong 5-1 --correct 4-1
 *
 *   docker run --rm \
 *     -v "$(pwd)/data:/app/data:rw" \
 *     --entrypoint /app/docker-entrypoint.sh \
 *     ghcr.io/doubleangels/nova:latest \
 *     su-exec discordbot node scripts/fix-fixture-scoring.js \
 *       --commit --force --fixture 537371 --wrong 5-1 --correct 4-1
 *
 *   docker compose start nova
 *
 * Options:
 *   --fixture <id>     football-data.org match id (required)
 *   --wrong <h-a>      score the bot used when scoring (required)
 *   --correct <h-a>    actual final score (required)
 *   --namespace <ns>   keyv namespace (optional; processes all namespaces with predictions when omitted)
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const { sqlitePath, checkDatabaseAccess } = require('../utils/dbScriptUtils');
const { parseDbWriteFlags, resolveDbWriteMode, printDbWriteDryRunHint } = require('../utils/dbWriteCli');
const {
  parseScoreArg,
  fixFixtureScoringAll,
  resolveNamespacesToProcess,
  detectNamespacesWithPredictions,
  formatMultiNamespaceFixtureScoringReport
} = require('../utils/fixFixtureScoring');

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const parsed = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--commit' || arg === '--force') continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }

  return { parsed, positional };
}

function printUsage() {
  console.error('Usage: node scripts/fix-fixture-scoring.js [--commit --force] --fixture <id> --wrong <h-a> --correct <h-a> [--namespace football|worldcup]');
}

function main() {
  const rawArgs = process.argv.slice(2);
  const { isCommit, isForce } = parseDbWriteFlags(rawArgs);
  const { parsed, positional } = parseArgs(rawArgs);

  if (positional.length > 0) {
    console.error('Unknown argument(s):', positional.join(' '));
    printUsage();
    process.exit(1);
  }

  const fixtureId = Number(parsed.fixture);
  if (!Number.isFinite(fixtureId)) {
    console.error('Missing or invalid --fixture id.');
    printUsage();
    process.exit(1);
  }

  if (!parsed.wrong || !parsed.correct) {
    console.error('Both --wrong and --correct scores are required (e.g. --wrong 5-1 --correct 4-1).');
    printUsage();
    process.exit(1);
  }

  const requestedNamespace = parsed.namespace
    ? String(parsed.namespace).trim()
    : undefined;
  const writeMode = resolveDbWriteMode({ isCommit, isForce }, { scriptName: 'scripts/fix-fixture-scoring.js' });

  let wrongActual;
  let correctActual;
  try {
    wrongActual = parseScoreArg(String(parsed.wrong));
    correctActual = parseScoreArg(String(parsed.correct));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log('=== Fix fixture scoring ===');
  console.log(`Database: ${sqlitePath}`);
  console.log(
    requestedNamespace
      ? `Namespace: ${requestedNamespace}`
      : 'Namespace: (auto — all namespaces with predictions)'
  );
  console.log(`Fixture: ${fixtureId}`);
  console.log(`Wrong score used for scoring: ${wrongActual.home}-${wrongActual.away}`);
  console.log(`Correct final score: ${correctActual.home}-${correctActual.away}`);
  console.log(`Mode: ${writeMode.proceed ? 'COMMIT' : 'DRY RUN'}\n`);

  const accessCheck = checkDatabaseAccess();
  if (!accessCheck.accessible && accessCheck.fileExists) {
    console.error('Cannot access the database file due to a permission error.');
    if (accessCheck.recommendation) {
      console.error('');
      console.error(accessCheck.recommendation);
    }
    process.exit(1);
  }

  if (!fs.existsSync(sqlitePath)) {
    console.error(`Database not found at ${sqlitePath}`);
    process.exit(1);
  }

  const db = new Database(sqlitePath);
  db.pragma('busy_timeout = 10000');

  try {
    const namespaces = resolveNamespacesToProcess(db, fixtureId, requestedNamespace);
    if (
      requestedNamespace &&
      !detectNamespacesWithPredictions(db, fixtureId).includes(requestedNamespace)
    ) {
      const found = detectNamespacesWithPredictions(db, fixtureId);
      if (found.length > 0) {
        console.warn(
          `Warning: no predictions in "${requestedNamespace}" for fixture ${fixtureId}. ` +
            `Predictions exist in: ${found.join(', ')}. ` +
            'Re-run without --namespace to process them automatically.\n'
        );
      }
    }

    const reports = fixFixtureScoringAll(
      db,
      fixtureId,
      wrongActual,
      correctActual,
      { commit: writeMode.proceed, namespace: requestedNamespace }
    );

    console.log(formatMultiNamespaceFixtureScoringReport(reports));
    console.log('');

    if (writeMode.proceed) {
      const totalChanges = reports.reduce((sum, report) => sum + report.changes.length, 0);
      if (reports.some(report => report.committed)) {
        console.log(`Changes committed across: ${namespaces.join(', ')}.`);
      } else if (totalChanges === 0) {
        console.log('No database changes were written.');
      }
    } else {
      printDbWriteDryRunHint('scripts/fix-fixture-scoring.js');
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}
