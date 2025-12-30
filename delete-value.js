/**
 * Script to delete a value from the Keyv database
 * 
 * Usage: node delete-value.js <key>
 * 
 * Key format: [namespace:][section:]key
 *   - namespace: main (default), invites
 *   - section: config, tags, invite_usage, invite_code_to_tag_map, etc.
 * 
 * Examples:
 *   node delete-value.js reminder_channel
 *   node delete-value.js main:config:reminder_channel
 *   node delete-value.js invites:tags:disboard
 *   node delete-value.js main:invite_usage:123456789
 */

require('dotenv').config();
const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Keyv with SQLite
const sqlitePath = path.join(dataDir, 'database.sqlite');

/**
 * Parse a key into namespace, section, and actual key
 * @param {string} key - The key to parse
 * @returns {{namespace: string, section: string|null, actualKey: string, fullKey: string}}
 */
function parseKey(key) {
  const parts = key.split(':');
  
  // Known namespaces
  const namespaces = ['main', 'invites'];
  
  // Check if first part is a namespace
  let namespace = 'main'; // default
  let section = null;
  let actualKey = key;
  
  if (namespaces.includes(parts[0])) {
    namespace = parts[0];
    const remaining = parts.slice(1).join(':');
    
    // Check if there's a section (second part after namespace)
    if (remaining.includes(':')) {
      const sectionParts = remaining.split(':');
      section = sectionParts[0] + ':';
      actualKey = sectionParts.slice(1).join(':');
    } else {
      // No section, entire remaining is the key
      actualKey = remaining;
    }
  } else {
    // No namespace specified, check if it starts with a known section
    const knownSections = ['config:', 'tags:', 'invite_usage:', 'invite_code_to_tag_map:'];
    for (const knownSection of knownSections) {
      if (key.startsWith(knownSection)) {
        section = knownSection;
        actualKey = key.substring(knownSection.length);
        break;
      }
    }
  }
  
  // Build full key for Keyv
  let fullKey = actualKey;
  if (section) {
    fullKey = section + fullKey;
  }
  
  return { namespace, section, actualKey, fullKey };
}

/**
 * Get Keyv instance for a namespace
 * @param {string} namespace - The namespace
 * @returns {Keyv}
 */
function getKeyvForNamespace(namespace) {
  return new Keyv({
    store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
      table: 'keyv',
      busyTimeout: 10000
    }),
    namespace: namespace
  });
}

async function deleteValue(keyString) {
  try {
    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);
    
    // Check if key exists first
    const existingValue = await keyv.get(fullKey);
    
    if (existingValue === undefined) {
      console.log(`Key "${keyString}" does not exist in the database.`);
      console.log(`   Searched: namespace="${namespace}", key="${fullKey}"`);
      await keyv.disconnect();
      process.exit(0);
    }
    
    // Delete the key
    const deleted = await keyv.delete(fullKey);
    
    if (deleted) {
      console.log(`✅ Successfully deleted "${keyString}"`);
      console.log(`   Namespace: ${namespace}`);
      if (section) {
        console.log(`   Section: ${section.substring(0, section.length - 1)}`);
      }
      console.log(`   Key: ${actualKey}`);
      console.log(`   Full Key: ${namespace}:${fullKey}`);
      console.log(`   Previous value was: ${JSON.stringify(existingValue)}`);
    } else {
      console.log(`Key "${keyString}" was not found or could not be deleted.`);
    }
    
    await keyv.disconnect();
  } catch (error) {
    console.error(`Error deleting value:`, error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node delete-value.js <key>');
  console.error('');
  console.error('Key format: [namespace:][section:]key');
  console.error('  namespace: main (default), invites');
  console.error('  section: config, tags, invite_usage, invite_code_to_tag_map, etc.');
  console.error('');
  console.error('Examples:');
  console.error('  node delete-value.js reminder_channel');
  console.error('  node delete-value.js main:config:reminder_channel');
  console.error('  node delete-value.js invites:tags:disboard');
  console.error('  node delete-value.js main:invite_usage:123456789');
  process.exit(1);
}

const key = args[0];

deleteValue(key);
