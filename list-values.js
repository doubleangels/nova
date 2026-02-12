/**
 * Script to list all values from the Keyv database or read a specific value
 * 
 * Usage: 
 *   node list-values.js [<key>]
 * 
 * Key format: [namespace:][section:]key
 *   - namespace: main (default), invites
 *   - section: config, tags, invite_usage, invite_code_to_tag_map, former_member, etc.
 * 
 * Examples:
 *   node list-values.js                    # List all values (all namespaces)
 *   node list-values.js reminder_channel   # Read config key (main:config:reminder_channel)
 *   node list-values.js main:config:reminder_channel  # Explicit namespace and section
 *   node list-values.js invites:tags:disboard  # Read invite tag
 *   node list-values.js main:invite_usage:123456789  # Read invite usage for guild
 *   node list-values.js former_member:123456789  # Read former member (returning-user tracking)
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
    // Parse the requested key using the same rules as set-value.js
    const { namespace, section, actualKey } = parseKey(keyString);

    // To avoid any discrepancies between how Keyv stores keys and how we
    // display them in the full dump, reuse the same direct-SQLite path that
    // listAllValues() uses and filter in memory.
    const allData = await getAllKeys();

    const match = allData.find(item =>
      item.namespace === namespace &&
      // section can be null in both the parsed key and the stored item
      (item.section || null) === (section || null) &&
      item.key === actualKey
    );

    if (!match) {
      // Fall back to the old Keyv-based lookup for maximum compatibility,
      // so existing invocations that relied on it for config:* still work.
      const { fullKey } = parseKey(keyString);
      const keyv = getKeyvForNamespace(namespace);

      await withKeyv(keyv, async (kv) => {
        const value = await kv.get(fullKey);

        if (value === undefined) {
          console.log(`Key "${keyString}" does not exist in the database.`);
          console.log(`   Searched: namespace="${namespace}", key="${fullKey}"`);
          process.exit(0);
        }

        console.log(`Value for "${keyString}":`);
        console.log(`   Namespace: ${namespace}`);
        if (section) {
          console.log(`   Section: ${formatSectionName(section)}`);
        }
        console.log(`   Key: ${actualKey}`);
        console.log(`   Full Key: ${namespace}:${fullKey}`);
        console.log(`   Value: ${JSON.stringify(value)}`);
        console.log(`   Type: ${typeof value}`);

        if (typeof value === 'object' && value !== null) {
          console.log(`\n   Pretty-printed:`);
          console.log(`   ${JSON.stringify(value, null, 2).split('\n').join('\n   ')}`);
        }
      });
      return;
    }

    // We found the key using the same direct-SQLite path as the full dump.
    const value = match.value;

    console.log(`Value for "${keyString}":`);
    console.log(`   Namespace: ${match.namespace}`);
    if (match.section) {
      console.log(`   Section: ${formatSectionName(match.section)}`);
    }
    console.log(`   Key: ${match.key}`);
    console.log(`   Full Key: ${match.namespace}:${match.section ? match.section + match.key : match.key}`);
    console.log(`   Value: ${JSON.stringify(value)}`);
    console.log(`   Type: ${typeof value}`);

    if (typeof value === 'object' && value !== null) {
      console.log(`\n   Pretty-printed:`);
      console.log(`   ${JSON.stringify(value, null, 2).split('\n').join('\n   ')}`);
    }
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
      console.error('Database file information:');
      console.error(`   File: ${pathInfo.sqlitePath}`);
      console.error(`   Owner: uid ${accessCheck.fileOwner?.uid}, gid ${accessCheck.fileOwner?.gid}`);
      console.error(`   Current user: uid ${accessCheck.currentUser?.uid}, gid ${accessCheck.currentUser?.gid}`);
      if (accessCheck.currentUser?.isRoot) {
        console.error('   Running as root - switch to the file owner user');
      }
      process.exit(1);
    }
    
    
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
    
    // Check database structure before querying
    let tableInfo = null;
    let rowCount = 0;
    try {
      // Check file permissions first
      const stats = fs.statSync(pathInfo.sqlitePath);
      const fileMode = (stats.mode & parseInt('777', 8)).toString(8);
      const fileOwner = stats.uid;
      const fileGroup = stats.gid;
      
      if (process.env.DEBUG) {
        console.log(`Database file permissions: ${fileMode} (uid: ${fileOwner}, gid: ${fileGroup})`);
        console.log(`Current process uid: ${process.getuid()}, gid: ${process.getgid()}`);
      }
      
      const db = new Database(pathInfo.sqlitePath, { readonly: true });
      const tableCheck = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='keyv'
      `).get();
      
      if (tableCheck) {
        const countResult = db.prepare(`SELECT COUNT(*) as count FROM keyv`).get();
        rowCount = countResult.count;
        
        // Get sample keys if any exist
        if (rowCount > 0) {
          const sampleKeys = db.prepare(`SELECT key FROM keyv LIMIT 5`).all();
          tableInfo = {
            exists: true,
            rowCount: rowCount,
            sampleKeys: sampleKeys.map(r => r.key)
          };
        } else {
          tableInfo = {
            exists: true,
            rowCount: 0
          };
        }
      } else {
        // Check what tables do exist
        const allTables = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table'
        `).all();
        tableInfo = {
          exists: false,
          otherTables: allTables.map(t => t.name)
        };
      }
      db.close();
    } catch (e) {
      console.error(`Error checking database structure: ${e.message}`);
      console.error('');
      console.error('This is likely a permissions issue. The database file exists but cannot be opened.');
      console.error('');
      console.error('Solutions:');
      console.error('  1. Run the script as the discordbot user:');
      console.error('     gosu discordbot node list-values.js');
      console.error('  2. Or temporarily fix permissions (not recommended for production):');
      console.error(`     chmod 644 ${pathInfo.sqlitePath}`);
      console.error('');
      console.error('The database file is owned by discordbot:nodejs with restrictive permissions');
      console.error('for security. Scripts should be run as the discordbot user.');
    }
    
    const allData = await getAllKeys();
    
    if (allData.length === 0) {
      console.log('No values found in the database.');
      console.log('');
      
      if (tableInfo) {
        if (tableInfo.exists) {
          console.log(`Database table 'keyv' exists with ${tableInfo.rowCount} row(s).`);
          if (tableInfo.rowCount > 0 && tableInfo.sampleKeys) {
            console.log('Sample keys found in database:');
            tableInfo.sampleKeys.forEach(key => {
              console.log(`   - ${key}`);
            });
            console.log('');
            console.log('The keys exist but could not be parsed. This might indicate:');
            console.log('  1. A namespace/section parsing issue');
            console.log('  2. The keys are in an unexpected format');
          } else if (tableInfo.rowCount === 0) {
            console.log('The table is empty.');
          }
        } else {
          console.log(`Database table 'keyv' does not exist.`);
          if (tableInfo.otherTables && tableInfo.otherTables.length > 0) {
            console.log(`Other tables found: ${tableInfo.otherTables.join(', ')}`);
          }
        }
      }
      
      console.log('');
      console.log('This could mean:');
      console.log('  1. The database is empty');
      console.log('  2. The database file is different from your local one');
      console.log('  3. Check if the volume mount is pointing to the correct location');
      console.log('');
      console.log('To verify, check the database file directly:');
      console.log(`   sqlite3 ${pathInfo.sqlitePath} "SELECT COUNT(*) FROM keyv;"`);
      console.log(`   sqlite3 ${pathInfo.sqlitePath} "SELECT key FROM keyv LIMIT 10;"`);
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

// Single-key lookups caused confusion and are no longer supported.
// Always list all values, regardless of any arguments.
if (args.length > 0) {
  console.error('Reading a single key with list-values.js is no longer supported.');
  console.error('Run `node list-values.js` with no arguments to see all values.');
  process.exit(1);
}

listAllValues();