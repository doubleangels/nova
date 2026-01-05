/**
 * Script to set/update a value in the Keyv database
 * 
 * Usage: node set-value.js <key> <value>
 * 
 * Key format: [namespace:][section:]key
 *   - namespace: main (default), invites
 *   - section: config, tags, invite_usage, invite_code_to_tag_map, etc.
 * 
 * Examples:
 *   node set-value.js reminder_channel "123456789012345678"
 *   node set-value.js main:config:reminder_channel "123456789012345678"
 *   node set-value.js spam_mode_enabled true
 *   node set-value.js invites:tags:disboard '{"code":"abc123","name":"Disboard"}'
 *   node set-value.js main:invite_usage:123456789 '{"abc123":5}'
 */

require('dotenv').config();
const { parseKey, getKeyvForNamespace, parseValue, withKeyv, formatSectionName } = require('./utils/dbScriptUtils');

async function setValue(keyString, value) {
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
    
    
    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);
    
    const parsedValue = parseValue(value);
    
    await withKeyv(keyv, async (kv) => {
      await kv.set(fullKey, parsedValue);
      
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
    console.error(`Error setting value: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node set-value.js <key> <value>');
  console.error('');
  console.error('Key format: [namespace:][section:]key');
  console.error('  namespace: main (default), invites');
  console.error('  section: config, tags, invite_usage, invite_code_to_tag_map, etc.');
  console.error('');
  console.error('Examples:');
  console.error('  node set-value.js reminder_channel "123456789012345678"');
  console.error('  node set-value.js main:config:reminder_channel "123456789012345678"');
  console.error('  node set-value.js spam_mode_enabled true');
  console.error('  node set-value.js invites:tags:disboard \'{"code":"abc123","name":"Disboard"}\'');
  console.error('  node set-value.js main:invite_usage:123456789 \'{"abc123":5}\'');
  process.exit(1);
}

const key = args[0];
const value = args.slice(1).join(' '); // Join remaining args in case value has spaces

if (!key || key.trim() === '') {
  console.error('Error: Key cannot be empty');
  process.exit(1);
}

if (value === undefined || value === null) {
  console.error('Error: Value cannot be undefined or null');
  process.exit(1);
}

setValue(key, value);