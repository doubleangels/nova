const STOP_BOT_MESSAGE =
  'Stop the Nova bot before modifying the database while it is running.';

/**
 * @param {string[]} argv
 * @returns {{ isCommit: boolean, isForce: boolean, positional: string[] }}
 */
function parseDbWriteFlags(argv) {
  const isCommit = argv.includes('--commit');
  const isForce = argv.includes('--force');
  const positional = argv.filter((arg) => arg !== '--commit' && arg !== '--force');
  return { isCommit, isForce, positional };
}

/**
 * @param {{ isCommit: boolean, isForce: boolean }} flags
 * @param {{ scriptName: string }} options
 * @returns {{ proceed: boolean, dryRun: boolean }}
 */
function resolveDbWriteMode(flags, { scriptName }) {
  if (!flags.isCommit) {
    return { proceed: false, dryRun: true };
  }
  if (!flags.isForce) {
    console.error(STOP_BOT_MESSAGE);
    console.error(`Re-run with --commit --force if the bot is stopped:`);
    console.error(`  node ${scriptName} --commit --force ...`);
    process.exit(1);
  }
  return { proceed: true, dryRun: false };
}

/**
 * @param {string} scriptName
 */
function printDbWriteDryRunHint(scriptName) {
  console.log('Dry run only. No changes were made to the database.');
  console.log(`Stop the bot first, then run with --commit --force:`);
  console.log(`  node ${scriptName} --commit --force ...`);
}

module.exports = {
  STOP_BOT_MESSAGE,
  parseDbWriteFlags,
  resolveDbWriteMode,
  printDbWriteDryRunHint
};
