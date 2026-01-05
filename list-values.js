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
    
    // First, check if the table exists and get row count
    let tableExists = false;
    let rowCount = 0;
    try {
      const tableInfo = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='keyv'
      `).get();
      tableExists = !!tableInfo;
      
      if (tableExists) {
        const countResult = db.prepare(`SELECT COUNT(*) as count FROM keyv`).get();
        rowCount = countResult.count;
      }
    } catch (e) {
      // Ignore errors
    }
    
    if (process.env.DEBUG) {
      console.log(`Debug: Table exists: ${tableExists}, Row count: ${rowCount}`);
    }
    
    if (!tableExists) {
      db.close();
      return [];
    }
    
    const rows = db.prepare(`
      SELECT key, value 
      FROM keyv 
      ORDER BY key
    `).all();
    
    db.close();
    
    if (process.env.DEBUG) {
      console.log(`Debug: Retrieved ${rows.length} rows from database`);
      if (rows.length > 0) {
        console.log(`Debug: First few keys: ${rows.slice(0, 3).map(r => r.key).join(', ')}`);
      }
    }
    
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
      console.log(`Value for "${keyString}":`);
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
    const { getDatabasePathInfo } = require('./utils/dbScriptUtils');
    const pathInfo = getDatabasePathInfo();
    
    // Always show path info to help diagnose issues
    console.log('Database path information:');
    console.log(`   Data directory: ${pathInfo.dataDir}`);
    console.log(`   Database file: ${pathInfo.sqlitePath}`);
    console.log(`   Working directory: ${pathInfo.cwd}`);
    console.log(`   Data dir exists: ${pathInfo.dataDirExists}`);
    console.log(`   Database exists: ${pathInfo.databaseExists}`);
    if (pathInfo.envDataDir) {
      console.log(`   DATA_DIR env var: ${pathInfo.envDataDir}`);
    }
    
    if (pathInfo.databaseExists) {
      try {
        const stats = require('fs').statSync(pathInfo.sqlitePath);
        console.log(`   Database file size: ${stats.size} bytes`);
      } catch (e) {
        // Ignore stat errors
      }
    }
    console.log('');
    
    if (!pathInfo.databaseExists) {
      console.log('Database file does not exist.');
      console.log(`   Expected location: ${pathInfo.sqlitePath}`);
      console.log('');
      console.log('If running in a container, ensure:');
      console.log('  1. The data volume is properly mounted');
      console.log('  2. The database file exists in the mounted volume');
      console.log('  3. You can set DATA_DIR environment variable to override the path');
      return;
    }
    
    const allData = await getAllKeys();
    
    if (allData.length === 0) {
      console.log('No values found in the database.');
      console.log('');
      console.log('This could mean:');
      console.log('  1. The database is empty');
      console.log('  2. The database file is different from your local one');
      console.log('  3. Check if the volume mount is pointing to the correct location');
      console.log('');
      console.log('To verify, check the database file directly:');
      console.log(`   sqlite3 ${pathInfo.sqlitePath} "SELECT COUNT(*) FROM keyv;"`);
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