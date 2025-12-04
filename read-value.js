/**
 * Script to read a value from the Keyv database
 * 
 * Usage: node read-value.js <key>
 * 
 * Examples:
 *   node read-value.js reminder_channel
 *   node read-value.js spam_mode_enabled
 *   node read-value.js bot_status
 *   node read-value.js bot_status_type
 */

require('dotenv').config();
const Keyv = require('keyv');
const { KeyvFile } = require('keyv-file');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Keyv
const keyv = new Keyv({
  store: new KeyvFile({
    filename: './data/database.json'
  }),
  namespace: 'nova'
});

async function readValue(key) {
  try {
    // Get value with config: prefix to match the database.js implementation
    const value = await keyv.get(`config:${key}`);
    
    if (value === undefined) {
      console.log(`⚠️  Key "${key}" does not exist in the database.`);
      process.exit(0);
    }
    
    // Display the value
    console.log(`📖 Value for "${key}":`);
    console.log(`   ${JSON.stringify(value)}`);
    console.log(`   Type: ${typeof value}`);
    
    // If it's an object or array, show a pretty-printed version
    if (typeof value === 'object' && value !== null) {
      console.log(`\n   Pretty-printed:`);
      console.log(`   ${JSON.stringify(value, null, 2).split('\n').join('\n   ')}`);
    }
    
  } catch (error) {
    console.error(`❌ Error reading value:`, error.message);
    process.exit(1);
  } finally {
    await keyv.disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node read-value.js <key>');
  console.error('');
  console.error('Examples:');
  console.error('  node read-value.js reminder_channel');
  console.error('  node read-value.js spam_mode_enabled');
  console.error('  node read-value.js bot_status');
  console.error('  node read-value.js bot_status_type');
  process.exit(1);
}

const key = args[0];

readValue(key);
