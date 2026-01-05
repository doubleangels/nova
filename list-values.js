/**
 * Script to list all values from the Keyv database or read a specific value
 * 
 * Usage: 
 *   node list-values.js [<key>]
 * 
 * Key format: [namespace:][section:]key
 *   - namespace: main (default), invites
 *   - section: config, tags, invite_usage, invite_code_to_tag_map, etc.
 * 
 * Examples:
 *   node list-values.js                    # List all values (all namespaces)
 *   node list-values.js reminder_channel   # Read config key (main:config:reminder_channel)
 *   node list-values.js main:config:reminder_channel  # Explicit namespace and section
 *   node list-values.js invites:tags:disboard  # Read invite tag
 *   node list-values.js main:invite_usage:123456789  # Read invite usage for guild
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const { parseKey, parseDatabaseKey, getKeyvForNamespace, withKeyv, formatSectionName, sqlitePath } = require('./utils/dbScriptUtils');

/**
 * Get all keys from the SQLite database, across all namespaces
 * Uses the same parseKey logic for consistency
 */
async function getAllKeys() {
  try {
    if (!fs.existsSync(sqlitePath)) {
      return [];
    }

    // Directly query SQLite to get all keys
    const db = new Database(sqlitePath, { readonly: true });
    
    const rows = db.prepare(`
      SELECT key, value 
      FROM keyv 
      ORDER BY key
    `).all();
    
    db.close();
    
    return rows.map(row => {
      let parsedValue = null;
      if (row.value) {
        try {
          const parsed = JSON.parse(row.value);
          // Keyv stores values wrapped in {value: ..., expires: null}
          // Extract the actual value from the wrapper
          if (parsed && typeof parsed === 'object' && 'value' in parsed) {
            parsedValue = parsed.value;
          } else {
            parsedValue = parsed;
          }
        } catch (parseError) {
          parsedValue = row.value;
        }
      }
      
      // Parse the database key using the dedicated function
      // Database keys are in format: namespace:section:key or namespace:key
      const parsed = parseDatabaseKey(row.key);
      
      return {
        namespace: parsed.namespace,
        section: parsed.section,
        rawKey: row.key,
        key: parsed.actualKey || row.key,
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

async function readValue(keyString) {
  try {
    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);
    
    await withKeyv(keyv, async (kv) => {
      const value = await kv.get(fullKey);
      
      if (value === undefined) {
        console.log(`Key "${keyString}" does not exist in the database.`);
        console.log(`   Searched: namespace="${namespace}", key="${fullKey}"`);
        process.exit(0);
      }
      
      // Display the value
      console.log(`📖 Value for "${keyString}":`);
      console.log(`   Namespace: ${namespace}`);
      if (section) {
        console.log(`   Section: ${formatSectionName(section)}`);
      }
      console.log(`   Key: ${actualKey}`);
      console.log(`   Full Key: ${namespace}:${fullKey}`);
      console.log(`   Value: ${JSON.stringify(value)}`);
      console.log(`   Type: ${typeof value}`);
      
      // If it's an object or array, show a pretty-printed version
      if (typeof value === 'object' && value !== null) {
        console.log(`\n   Pretty-printed:`);
        console.log(`   ${JSON.stringify(value, null, 2).split('\n').join('\n   ')}`);
      }
    });
  } catch (error) {
    console.error(`Error reading value: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function listAllValues() {
  try {
    const allData = await getAllKeys();
    
    if (allData.length === 0) {
      console.log('No values found in the database.');
      return;
    }

    console.log(`Found ${allData.length} value(s) in the database:\n`);
    
    // Group by namespace, then by section
    const grouped = {};
    for (const item of allData) {
      if (!grouped[item.namespace]) {
        grouped[item.namespace] = {};
      }
      const sectionKey = item.section || '(root)';
      if (!grouped[item.namespace][sectionKey]) {
        grouped[item.namespace][sectionKey] = [];
      }
      grouped[item.namespace][sectionKey].push({
        key: item.key,
        value: item.value
      });
    }
    
    // Display grouped by namespace
    for (const [namespace, sections] of Object.entries(grouped).sort()) {
      console.log(`Namespace: ${namespace}`);
      for (const [section, items] of Object.entries(sections).sort()) {
        const label = section === '(root)' ? 'Root' : formatSectionName(section);
        console.log(` ${label}:`);
        for (const item of items.sort((a, b) => a.key.localeCompare(b.key))) {
          const valueStr = typeof item.value === 'object' && item.value !== null
            ? JSON.stringify(item.value).substring(0, 80) + (JSON.stringify(item.value).length > 80 ? '...' : '')
            : String(item.value);
          const typeStr = typeof item.value === 'object' && item.value !== null
            ? (Array.isArray(item.value) ? 'array' : 'object')
            : typeof item.value;
          console.log(`    ${item.key.padEnd(30)} = ${valueStr.padEnd(50)} (${typeStr})`);
        }
        console.log('');
      }
    }
    
  } catch (error) {
    console.error(`Error listing values:`, error.message);
    process.exit(1);
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
  
  if (!key || key.trim() === '') {
    console.error('Error: Key cannot be empty');
    process.exit(1);
  }
  
  readValue(key);
}