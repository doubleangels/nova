/**
 * Script to set/update a value in the Keyv database
 *
 * Usage:
 *   node set-value.js <key> <value>                    # Dry run (default)
 *   node set-value.js --commit --force <key> <value>   # Apply (stop the bot first)
 */

require('dotenv').config();
const {
  parseKey,
  getKeyvForNamespace,
  parseValue,
  withKeyv,
  formatSectionName,
  invalidateRuntimeConfigCache,
  checkDatabaseAccess
} = require('./utils/dbScriptUtils');
const { parseDbWriteFlags, resolveDbWriteMode, printDbWriteDryRunHint } = require('./utils/dbWriteCli');

/**
 * @param {string} keyString
 * @param {string} value
 * @param {{ commit: boolean }} options
 */
async function setValue(keyString, value, options = {}) {
  try {
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

    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const parsedValue = parseValue(value);

    if (!options.commit) {
      console.log(`Would set "${keyString}"`);
      console.log(`   Namespace: ${namespace}`);
      if (section) {
        console.log(`   Section: ${formatSectionName(section)}`);
      }
      console.log(`   Key: ${actualKey}`);
      console.log(`   Full Key: ${namespace}:${fullKey}`);
      console.log(`   Value: ${JSON.stringify(parsedValue)}`);
      console.log(`   Type: ${typeof parsedValue}`);
      printDbWriteDryRunHint('set-value.js');
      return;
    }

    const keyv = getKeyvForNamespace(namespace);
    await withKeyv(keyv, async (kv) => {
      await kv.set(fullKey, parsedValue);
      invalidateRuntimeConfigCache(section, actualKey, fullKey);

      console.log(`Successfully set "${keyString}"`);
      console.log(`   Namespace: ${namespace}`);
      if (section) {
        console.log(`   Section: ${formatSectionName(section)}`);
      }
      console.log(`   Key: ${actualKey}`);
      console.log(`   Full Key: ${namespace}:${fullKey}`);
      console.log(`   Value: ${JSON.stringify(parsedValue)}`);
      console.log(`   Type: ${typeof parsedValue}`);
    });
  } catch (error) {
    console.error(`Error occurred while setting value. ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

const rawArgs = process.argv.slice(2);
const { isCommit, isForce, positional } = parseDbWriteFlags(rawArgs);

if (positional.length < 2) {
  console.error('Usage: node set-value.js [--commit --force] <key> <value>');
  console.error('');
  console.error('Dry run by default. Stop the bot, then use --commit --force to write.');
  console.error('');
  console.error('Examples:');
  console.error('  node set-value.js main:config:reminder_channel "123456789012345678"');
  console.error('  node set-value.js --commit --force main:mute_mode_enabled true');
  process.exit(1);
}

const key = positional[0];
const value = positional.slice(1).join(' ');

if (!key || key.trim() === '') {
  console.error('Error: Key cannot be empty');
  process.exit(1);
}

if (value === undefined || value === null) {
  console.error('Error: Value cannot be empty');
  process.exit(1);
}

const writeMode = resolveDbWriteMode({ isCommit, isForce }, { scriptName: 'set-value.js' });
setValue(key, value, { commit: writeMode.proceed });
