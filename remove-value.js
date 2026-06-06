/**
 * Script to delete a value from the Keyv database
 *
 * Usage:
 *   node remove-value.js <key>                    # Dry run (default)
 *   node remove-value.js --commit --force <key>   # Delete (stop the bot first)
 */

require('dotenv').config();
const {
  parseKey,
  getKeyvForNamespace,
  withKeyv,
  formatSectionName,
  invalidateRuntimeConfigCache,
  getDatabasePathInfo,
  checkDatabaseAccess
} = require('./utils/dbScriptUtils');
const { parseDbWriteFlags, resolveDbWriteMode, printDbWriteDryRunHint } = require('./utils/dbWriteCli');

/**
 * @param {string} keyString
 * @param {{ commit: boolean }} options
 */
async function deleteValue(keyString, options = {}) {
  try {
    const pathInfo = getDatabasePathInfo();
    const accessCheck = checkDatabaseAccess();

    if (!accessCheck.accessible && accessCheck.fileExists) {
      if (accessCheck.currentUser?.isRoot) {
        const { spawn } = require('child_process');
        try {
          require('child_process').execSync('which gosu', { stdio: 'ignore' });
          const scriptPath = __filename;
          const args = ['discordbot', 'node', scriptPath, ...process.argv.slice(2)];
          const child = spawn('gosu', args, {
            stdio: 'inherit',
            cwd: process.cwd()
          });
          child.on('exit', (code) => {
            process.exit(code || 0);
          });
          return;
        } catch {
          // gosu not available or re-execution failed
        }
      }

      console.error('Cannot access the database file due to a permission error.');
      if (accessCheck.recommendation) {
        console.error('');
        console.error(accessCheck.recommendation);
      }
      process.exit(1);
    }

    if (!pathInfo.databaseExists) {
      console.error('Database file does not exist.');
      console.error(`   Expected location: ${pathInfo.sqlitePath}`);
      process.exit(1);
    }

    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);

    await withKeyv(keyv, async (kv) => {
      const existingValue = await kv.get(fullKey);

      if (existingValue === undefined) {
        console.log(`Key "${keyString}" does not exist in the database.`);
        console.log(`   Searched: namespace="${namespace}", key="${fullKey}"`);
        process.exit(0);
      }

      if (!options.commit) {
        console.log(`Would delete "${keyString}"`);
        console.log(`   Namespace: ${namespace}`);
        if (section) {
          console.log(`   Section: ${formatSectionName(section)}`);
        }
        console.log(`   Key: ${actualKey}`);
        console.log(`   Full Key: ${namespace}:${fullKey}`);
        console.log(`   Current value: ${JSON.stringify(existingValue)}`);
        printDbWriteDryRunHint('remove-value.js');
        return;
      }

      const deleted = await kv.delete(fullKey);

      if (deleted) {
        invalidateRuntimeConfigCache(section, actualKey, fullKey);
        console.log(`Successfully deleted "${keyString}"`);
        console.log(`   Namespace: ${namespace}`);
        if (section) {
          console.log(`   Section: ${formatSectionName(section)}`);
        }
        console.log(`   Key: ${actualKey}`);
        console.log(`   Full Key: ${namespace}:${fullKey}`);
        console.log(`   Previous value was: ${JSON.stringify(existingValue)}`);
      } else {
        console.log(`Key "${keyString}" was not found or could not be deleted.`);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error(`Error occurred while deleting value. ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

const rawArgs = process.argv.slice(2);
const { isCommit, isForce, positional } = parseDbWriteFlags(rawArgs);

if (positional.length < 1) {
  console.error('Usage: node remove-value.js [--commit --force] <key>');
  console.error('');
  console.error('Dry run by default. Stop the bot, then use --commit --force to delete.');
  process.exit(1);
}

const key = positional[0];

if (!key || key.trim() === '') {
  console.error('Error: Key cannot be empty');
  process.exit(1);
}

const writeMode = resolveDbWriteMode({ isCommit, isForce }, { scriptName: 'remove-value.js' });
deleteValue(key, { commit: writeMode.proceed });
