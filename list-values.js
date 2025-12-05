/**
 * Script to list all values from the Keyv database or read a specific value
 * 
 * Usage: 
 *   node list-values.js [<key>]
 * 
 * If no key is provided, lists all values in the database.
 * 
 * Examples:
 *   node list-values.js                    # List all values
 *   node list-values.js reminder_channel   # Read specific key
 *   node list-values.js spam_mode_enabled
 *   node list-values.js bot_status
 *   node list-values.js bot_status_type
 */

require('dotenv').config();
const Keyv = require('keyv');
const KeyvSqlite = require('@keyv/sqlite');
const Database = require('better-sqlite3');
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

/**
 * Get all keys from the SQLite database
 */
async function getAllKeys() {
  try {
    // Directly query SQLite to get all keys
    const db = new Database(sqlitePath, { readonly: true });
    const namespace = 'main:';
    
    const rows = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE ?
      ORDER BY key
    `).all(`${namespace}%`);
    
    db.close();
    
    return rows.map(row => {
      let parsedValue = null;
      if (row.value) {
        const parsed = JSON.parse(row.value);
        // Keyv stores values wrapped in {value: ..., expires: null}
        // Extract the actual value from the wrapper
        if (parsed && typeof parsed === 'object' && 'value' in parsed) {
          parsedValue = parsed.value;
        } else {
          parsedValue = parsed;
        }
      }
      return {
        key: row.key.substring(namespace.length), // Remove namespace prefix
        value: parsedValue
      };
    });
  } catch (error) {
    // If database doesn't exist or table doesn't exist, return empty array
    if (error.code === 'SQLITE_CANTOPEN' || error.message.includes('no such table')) {
      return [];
    }
    throw error;
  }
}

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

async function listAllValues() {
  try {
    const allData = await getAllKeys();
    
    if (allData.length === 0) {
      console.log('📋 No values found in the database.');
      return;
    }
    
    console.log(`📋 Found ${allData.length} value(s) in the database:\n`);
    
    // Group by prefix (config:, mute_mode_recovery:, etc.)
    const grouped = {};
    for (const item of allData) {
      const colonIndex = item.key.indexOf(':');
      const prefix = colonIndex > 0 ? item.key.substring(0, colonIndex + 1) : '(root)';
      const actualKey = colonIndex > 0 ? item.key.substring(colonIndex + 1) : item.key;
      
      if (!grouped[prefix]) {
        grouped[prefix] = [];
      }
      grouped[prefix].push({ key: actualKey, value: item.value });
    }
    
    // Display grouped
    for (const [prefix, items] of Object.entries(grouped).sort()) {
      console.log(`${prefix === '(root)' ? '📦 Root' : `📦 ${prefix.substring(0, prefix.length - 1)}`}:`);
      for (const item of items.sort((a, b) => a.key.localeCompare(b.key))) {
        const valueStr = typeof item.value === 'object' && item.value !== null
          ? JSON.stringify(item.value).substring(0, 80) + (JSON.stringify(item.value).length > 80 ? '...' : '')
          : String(item.value);
        const typeStr = typeof item.value === 'object' && item.value !== null
          ? (Array.isArray(item.value) ? 'array' : 'object')
          : typeof item.value;
        console.log(`   ${item.key.padEnd(30)} = ${valueStr.padEnd(50)} (${typeStr})`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error(`❌ Error listing values:`, error.message);
    process.exit(1);
  } finally {
    await keyv.disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  // No key provided, list all values
  listAllValues();
} else {
  // Key provided, read specific value
  const key = args[0];
  readValue(key);
}
