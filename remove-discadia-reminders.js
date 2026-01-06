/**
 * Temporary script to remove all Discadia reminder data from the database
 * 
 * Usage: node remove-discadia-reminders.js
 * 
 * This script removes:
 * - The reminders:discadia:list key (list of reminder IDs)
 * - All reminder:{id} entries where type is 'discadia'
 * 
 * Note: This is a temporary script and can be removed after cleanup is complete.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'database.sqlite');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(sqlitePath)) {
  console.error('Database file does not exist.');
  console.error(`   Expected location: ${sqlitePath}`);
  console.error('');
  console.error('If running in a container, ensure:');
  console.error('  1. The data volume is properly mounted');
  console.error('  2. The database file exists in the mounted volume');
  console.error('  3. You can set DATA_DIR environment variable to override the path');
  process.exit(1);
}

// Check database access permissions
function checkDatabaseAccess() {
  try {
    const stats = fs.statSync(sqlitePath);
    const currentUid = process.getuid ? process.getuid() : null;
    const currentGid = process.getgid ? process.getgid() : null;
    const isRoot = currentUid === 0;
    
    if (isRoot && stats.uid !== 0) {
      console.error('⚠️  Running as root, but database is owned by another user.');
      console.error(`   Database owner: uid ${stats.uid}, gid ${stats.gid}`);
      console.error('');
      console.error('Please run this script as the discordbot user:');
      console.error('   gosu discordbot node remove-discadia-reminders.js');
      console.error('');
      process.exit(1);
    }
    
    // Try to access the file
    fs.accessSync(sqlitePath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch (error) {
    console.error(`❌ Cannot access database file: ${error.message}`);
    console.error(`   File: ${sqlitePath}`);
    console.error('');
    console.error('Please check file permissions and ownership.');
    process.exit(1);
  }
}

async function removeDiscadiaReminders() {
  try {
    console.log('Starting Discadia reminder cleanup...\n');
    
    // Check database access
    checkDatabaseAccess();
    
    // Use direct SQL queries to find and delete all Discadia-related entries
    // This works regardless of namespace (main or nova_reminders)
    let db;
    try {
      db = new Database(sqlitePath, { readonly: false });
    } catch (error) {
      console.error(`❌ Failed to open database: ${error.message}`);
      console.error('');
      console.error('If running in Docker, try:');
      console.error('   gosu discordbot node remove-discadia-reminders.js');
      process.exit(1);
    }
    
    let deletedCount = 0;
    let deletedKeys = [];
    
    // Find all keys that contain 'discadia' (case-insensitive)
    const allKeys = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE LOWER(key) LIKE '%discadia%'
    `).all();
    
    console.log(`Found ${allKeys.length} key(s) containing 'discadia'.\n`);
    
    // Also check for reminder entries with type 'discadia' in their value
    const allReminderKeys = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE '%:reminder:%' 
         OR key LIKE '%reminders:%'
    `).all();
    
    let discadiaReminders = [];
    for (const row of allReminderKeys) {
      try {
        const parsed = JSON.parse(row.value);
        const value = parsed?.value || parsed;
        
        if (value && typeof value === 'object' && value.type === 'discadia') {
          discadiaReminders.push(row.key);
        }
      } catch (e) {
        // Skip if value can't be parsed
      }
    }
    
    if (discadiaReminders.length > 0) {
      console.log(`Found ${discadiaReminders.length} reminder entry/entries with type 'discadia'.\n`);
    }
    
    // Delete all keys containing 'discadia' in the key name
    for (const row of allKeys) {
      const deleteStmt = db.prepare('DELETE FROM keyv WHERE key = ?');
      const result = deleteStmt.run(row.key);
      if (result.changes > 0) {
        deletedCount++;
        deletedKeys.push(row.key);
        console.log(`  ✓ Deleted: ${row.key}`);
      }
    }
    
    // Delete reminder entries with type 'discadia' in the value
    for (const key of discadiaReminders) {
      // Check if we already deleted it
      if (!deletedKeys.includes(key)) {
        const deleteStmt = db.prepare('DELETE FROM keyv WHERE key = ?');
        const result = deleteStmt.run(key);
        if (result.changes > 0) {
          deletedCount++;
          deletedKeys.push(key);
          console.log(`  ✓ Deleted: ${key} (type: discadia)`);
        }
      }
    }
    
    db.close();

    console.log('\n' + '='.repeat(50));
    console.log('Cleanup Summary:');
    console.log(`  Total keys deleted: ${deletedCount}`);
    if (deletedKeys.length > 0) {
      console.log(`  Deleted keys:`);
      deletedKeys.forEach(key => {
        console.log(`    - ${key}`);
      });
    }
    console.log('='.repeat(50));
    
    if (deletedCount === 0) {
      console.log('\n⚠️  No Discadia reminders found in the database.');
    } else {
      console.log('\n✅ Discadia reminder cleanup completed successfully!');
    }

  } catch (error) {
    console.error(`\n❌ Error removing Discadia reminders: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the cleanup
removeDiscadiaReminders()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

