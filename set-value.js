/**
 * Script to set/update a value in the Keyv database
 * 
 * Usage: node set-value.js <key> <value> [--namespace <namespace>] [--section <section>]
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

async function setValue(keyString, value) {
  try {
    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);
    
    // Try to parse as JSON if it looks like JSON
    let parsedValue = value;
    
    // Check if value looks like JSON (starts with { or [)
    if ((value.trim().startsWith('{') && value.trim().endsWith('}')) ||
        (value.trim().startsWith('[') && value.trim().endsWith(']'))) {
      try {
        parsedValue = JSON.parse(value);
      } catch (e) {
        // If JSON parsing fails, use as string
        parsedValue = value;
      }
    } else {
      // Try to parse as boolean
      if (value.toLowerCase() === 'true') {
        parsedValue = true;
      } else if (value.toLowerCase() === 'false') {
        parsedValue = false;
      } else if (value.toLowerCase() === 'null') {
        parsedValue = null;
      } else {
        // Try to parse as number, but preserve large numbers (Discord IDs) as strings
        const numValue = Number(value);
        if (!isNaN(numValue) && value.trim() !== '') {
          // Discord snowflake IDs are 64-bit integers that exceed JavaScript's safe integer range
          // Keep them as strings to preserve precision
          if (numValue > Number.MAX_SAFE_INTEGER || numValue < Number.MIN_SAFE_INTEGER) {
            parsedValue = value; // Keep as string for large numbers
          } else {
            parsedValue = numValue;
          }
        } else {
          // Use as string
          parsedValue = value;
        }
      }
    }
    
    await keyv.set(fullKey, parsedValue);
    
    console.log(`✅ Successfully set "${keyString}"`);
    console.log(`   Namespace: ${namespace}`);
    if (section) {
      console.log(`   Section: ${section.substring(0, section.length - 1)}`);
    }
    console.log(`   Key: ${actualKey}`);
    console.log(`   Full Key: ${namespace}:${fullKey}`);
    console.log(`   Value: ${JSON.stringify(parsedValue)}`);
    console.log(`   Type: ${typeof parsedValue}`);
    
    await keyv.disconnect();
  } catch (error) {
    console.error(`Error setting value:`, error.message);
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

setValue(key, value);
