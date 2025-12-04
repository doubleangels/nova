/**
 * Script to delete a value from the Keyv database
 * 
 * Usage: node delete-value.js <key>
 * 
 * Examples:
 *   node delete-value.js reminder_channel
 *   node delete-value.js spam_mode_enabled
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

async function deleteValue(key) {
  try {
    // Check if key exists first
    const existingValue = await keyv.get(`config:${key}`);
    
    if (existingValue === undefined) {
      console.log(`⚠️  Key "${key}" does not exist in the database.`);
      process.exit(0);
    }
    
    // Delete with config: prefix to match the database.js implementation
    const deleted = await keyv.delete(`config:${key}`);
    
    if (deleted) {
      console.log(`✅ Successfully deleted "${key}"`);
      console.log(`   Previous value was: ${JSON.stringify(existingValue)}`);
    } else {
      console.log(`⚠️  Key "${key}" was not found or could not be deleted.`);
    }
    
  } catch (error) {
    console.error(`❌ Error deleting value:`, error.message);
    process.exit(1);
  } finally {
    await keyv.disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node delete-value.js <key>');
  console.error('');
  console.error('Examples:');
  console.error('  node delete-value.js reminder_channel');
  console.error('  node delete-value.js spam_mode_enabled');
  process.exit(1);
}

const key = args[0];

deleteValue(key);
