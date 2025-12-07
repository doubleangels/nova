/**
 * Script to set/update a value in the Keyv database
 * 
 * Usage: node set-value.js <key> <value>
 * 
 * Examples:
 *   node set-value.js reminder_channel "123456789012345678"
 *   node set-value.js spam_mode_enabled true
 *   node set-value.js bot_status "Playing games"
 *   node set-value.js bot_status_type "playing"
 */

require('dotenv').config();
const KeyvModule = require('keyv');
const Keyv = KeyvModule.default || KeyvModule;
const KeyvSqliteModule = require('@keyv/sqlite');
const KeyvSqlite = KeyvSqliteModule.default || KeyvSqliteModule;
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Keyv with SQLite
const sqlitePath = path.join(dataDir, 'database.sqlite');
const keyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
  }),
  namespace: 'main'
});

async function setValue(key, value) {
  try {
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
    
    // Store with config: prefix to match the database.js implementation
    await keyv.set(`config:${key}`, parsedValue);
    
    console.log(`✅ Successfully set "${key}" = ${JSON.stringify(parsedValue)}`);
    console.log(`   Type: ${typeof parsedValue}`);
    
  } catch (error) {
    console.error(`❌ Error setting value:`, error.message);
    process.exit(1);
  } finally {
    await keyv.disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node set-value.js <key> <value>');
  console.error('');
  console.error('Examples:');
  console.error('  node set-value.js reminder_channel "123456789012345678"');
  console.error('  node set-value.js spam_mode_enabled true');
  console.error('  node set-value.js bot_status "Playing games"');
  console.error('  node set-value.js bot_status_type "playing"');
  console.error('  node set-value.js mute_mode_kick_time_hours 4');
  process.exit(1);
}

const key = args[0];
const value = args.slice(1).join(' '); // Join remaining args in case value has spaces

setValue(key, value);
