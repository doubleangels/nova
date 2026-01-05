/**
 * Script to delete a value from the Keyv database
 * 
 * Usage: node remove-value.js <key>
 * 
 * Key format: [namespace:][section:]key
 *   - namespace: main (default), invites
 *   - section: config, tags, invite_usage, invite_code_to_tag_map, etc.
 * 
 * Examples:
 *   node remove-value.js reminder_channel
 *   node remove-value.js main:config:reminder_channel
 *   node remove-value.js invites:tags:disboard
 *   node remove-value.js main:invite_usage:123456789
 */

require('dotenv').config();
const { parseKey, getKeyvForNamespace, withKeyv, formatSectionName } = require('./utils/dbScriptUtils');

async function deleteValue(keyString) {
  try {
    const { getDatabasePathInfo, checkDatabaseAccess } = require('./utils/dbScriptUtils');
    const pathInfo = getDatabasePathInfo();
    
    // Check database access permissions first
    const accessCheck = checkDatabaseAccess();
    
    if (!accessCheck.accessible && accessCheck.fileExists) {
      // If running as root and gosu is available, try to re-execute automatically
      if (accessCheck.currentUser?.isRoot) {
        const { spawn } = require('child_process');
        try {
          // Check if gosu is available
          require('child_process').execSync('which gosu', { stdio: 'ignore' });
          // Re-execute with gosu
          const scriptPath = __filename;
          const args = ['discordbot', 'node', scriptPath, ...process.argv.slice(2)];
          const child = spawn('gosu', args, {
            stdio: 'inherit',
            cwd: process.cwd()
          });
          child.on('exit', (code) => {
            process.exit(code || 0);
          });
          return; // Exit after re-execution
        } catch (e) {
          // gosu not available or re-execution failed, show error
        }
      }
      
      console.error('Permission error: Cannot access database file.');
      console.error('');
      if (accessCheck.recommendation) {
        console.error(accessCheck.recommendation);
        console.error('');
      }
      process.exit(1);
    }
    
    
    if (!pathInfo.databaseExists) {
      console.error('Database file does not exist.');
      console.error(`   Expected location: ${pathInfo.sqlitePath}`);
      console.error('');
      console.error('If running in a container, ensure:');
      console.error('  1. The data volume is properly mounted');
      console.error('  2. The database file exists in the mounted volume');
      console.error('  3. You can set DATA_DIR environment variable to override the path');
      process.exit(1);
    }
    
    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);
    
    await withKeyv(keyv, async (kv) => {
      // Check if key exists first
      const existingValue = await kv.get(fullKey);
      
      if (existingValue === undefined) {
        console.log(`Key "${keyString}" does not exist in the database.`);
        console.log(`   Searched: namespace="${namespace}", key="${fullKey}"`);
        process.exit(0);
      }
      
      // Delete the key
      const deleted = await kv.delete(fullKey);
      
      if (deleted) {
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
    console.error(`Error deleting value: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node remove-value.js <key>');
  console.error('');
  console.error('Key format: [namespace:][section:]key');
  console.error('  namespace: main (default), invites');
  console.error('  section: config, tags, invite_usage, invite_code_to_tag_map, etc.');
  console.error('');
  console.error('Examples:');
  console.error('  node remove-value.js reminder_channel');
  console.error('  node remove-value.js main:config:reminder_channel');
  console.error('  node remove-value.js invites:tags:disboard');
  console.error('  node remove-value.js main:invite_usage:123456789');
  process.exit(1);
}

const key = args[0];

if (!key || key.trim() === '') {
  console.error('Error: Key cannot be empty');
  process.exit(1);
}

deleteValue(key);