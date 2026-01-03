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
const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
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

/**
 * Get all keys from the SQLite database, across all namespaces
 */
async function getAllKeys() {
  try {
    // Diagnostic information
    console.error(`Checking database at: ${sqlitePath}`);
    console.error(`Data directory: ${dataDir}`);
    console.error(`Data directory exists: ${fs.existsSync(dataDir)}`);
    
    if (!fs.existsSync(dataDir)) {
      console.error(`Data directory does not exist: ${dataDir}`);
      return [];
    }
    
    // Check if data directory is writable (SQLite needs this for WAL files)
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
      console.error(`Data directory is writable`);
    } catch (wError) {
      console.error(`Data directory is NOT writable: ${wError.message}`);
      console.error(`This will cause SQLITE_CANTOPEN errors - SQLite needs to create WAL/journal files`);
    }
    
    if (!fs.existsSync(sqlitePath)) {
      console.error(`Database file not found: ${sqlitePath}`);
      return [];
    }
    
    // Check file permissions
    try {
      fs.accessSync(sqlitePath, fs.constants.R_OK);
      const stats = fs.statSync(sqlitePath);
      console.error(`Database file exists and is readable`);
      console.error(`File size: ${stats.size} bytes, mode: ${stats.mode.toString(8)}, uid: ${stats.uid}, gid: ${stats.gid}`);
    } catch (rError) {
      console.error(`Database file exists but is NOT readable: ${rError.message}`);
      return [];
    }

    // Directly query SQLite to get all keys
    // Use readonly mode and configure SQLite to use /tmp for temporary files
    // This is needed for Docker read-only filesystem
    const options = { 
      readonly: true
    };
    
    // Set SQLite temp directory environment variable if /tmp exists
    if (fs.existsSync('/tmp')) {
      try {
        fs.accessSync('/tmp', fs.constants.W_OK);
        // Set environment variable for SQLite to use /tmp
        process.env.SQLITE_TMPDIR = '/tmp';
        console.error(`Using /tmp for SQLite temporary files`);
      } catch (tmpError) {
        console.error(`Warning: /tmp is not writable: ${tmpError.message}`);
      }
    } else {
      console.error(`Warning: /tmp does not exist - SQLite may fail with read-only root filesystem`);
    }
    
    console.error(`Attempting to open database...`);
    const db = new Database(sqlitePath, options);
    
    // Check if table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='keyv'
    `).get();
    
    if (!tableExists) {
      console.error(`Table 'keyv' does not exist in database`);
      db.close();
      return [];
    }
    
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
      
      // Parse namespace from key (format: namespace:section:key or namespace:key)
      const parts = row.key.split(':');
      const namespace = parts[0] || '(default)';
      const restOfKey = parts.slice(1).join(':');
      
      // Extract section if present (e.g., config:, tags:, invite_usage:, etc.)
      const sectionMatch = restOfKey.match(/^([^:]+:)/);
      const section = sectionMatch ? sectionMatch[1] : null;
      const actualKey = section ? restOfKey.substring(section.length) : restOfKey;
      
      return {
        namespace: namespace,
        section: section,
        rawKey: row.key,
        key: actualKey || restOfKey,
        value: parsedValue
      };
    });
  } catch (error) {
    // Log the error for debugging
    console.error(`Error accessing database: ${error.message}`);
    console.error(`Error code: ${error.code || 'N/A'}`);
    console.error(`Database path: ${sqlitePath}`);
    
    // If database doesn't exist or table doesn't exist, return empty array
    if (error.code === 'SQLITE_CANTOPEN' || 
        error.code === 'SQLITE_READONLY' ||
        error.message.includes('no such table') ||
        error.message.includes('unable to open database')) {
      console.error(`Database access issue. This might be due to Docker read-only filesystem restrictions.`);
      return [];
    }
    throw error;
  }
}

async function readValue(keyString) {
  try {
    // Check if database file exists first
    if (!fs.existsSync(sqlitePath)) {
      console.error(`Database file not found: ${sqlitePath}`);
      console.error(`Make sure the database file exists and the volume is properly mounted.`);
      process.exit(1);
    }
    
    const { namespace, section, actualKey, fullKey } = parseKey(keyString);
    const keyv = getKeyvForNamespace(namespace);
    
    const value = await keyv.get(fullKey);
    
    if (value === undefined) {
      console.log(`Key "${keyString}" does not exist in the database.`);
      console.log(`   Searched: namespace="${namespace}", key="${fullKey}"`);
      await keyv.disconnect();
      process.exit(0);
    }
    
    // Display the value
    console.log(`📖 Value for "${keyString}":`);
    console.log(`   Namespace: ${namespace}`);
    if (section) {
      console.log(`   Section: ${section.substring(0, section.length - 1)}`);
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
    
    await keyv.disconnect();
  } catch (error) {
    console.error(`Error reading value: ${error.message}`);
    console.error(`Error code: ${error.code || 'N/A'}`);
    console.error(`Database path: ${sqlitePath}`);
    if (error.code === 'SQLITE_READONLY' || error.message.includes('readonly')) {
      console.error(`\nThis might be due to Docker read-only filesystem restrictions.`);
      console.error(`SQLite may need a writable /tmp directory for temporary files.`);
      console.error(`Consider adding a tmpfs mount for /tmp in your docker-compose.yml:`);
      console.error(`  tmpfs:`);
      console.error(`    - /tmp:rw,noexec,nosuid,size=100m`);
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
        const label = section === '(root)' ? 'Root' : section.substring(0, section.length - 1);
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

(async () => {
  try {
    if (args.length === 0) {
      // No key provided, list all values
      await listAllValues();
    } else {
      // Key provided, read specific value
      const key = args[0];
      await readValue(key);
    }
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
})();
