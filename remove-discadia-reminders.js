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
const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
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

// Initialize Keyv for reminder storage (same namespace as reminderUtils.js)
const reminderKeyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
  }),
  namespace: 'nova_reminders'
});

async function removeDiscadiaReminders() {
  try {
    console.log('Starting Discadia reminder cleanup...\n');

    // Get all Discadia reminder IDs from the list
    const discadiaListKey = 'reminders:discadia:list';
    const discadiaIds = await reminderKeyv.get(discadiaListKey) || [];
    
    console.log(`Found ${discadiaIds.length} Discadia reminder ID(s) in list.`);

    let deletedReminderCount = 0;
    let deletedListCount = 0;

    // Delete all individual reminder entries
    for (const reminderId of discadiaIds) {
      const reminderKey = `reminder:${reminderId}`;
      const reminder = await reminderKeyv.get(reminderKey);
      
      if (reminder) {
        const deleted = await reminderKeyv.delete(reminderKey);
        if (deleted) {
          deletedReminderCount++;
          console.log(`  Deleted reminder: ${reminderId}`);
        }
      }
    }

    // Delete the list itself
    const listDeleted = await reminderKeyv.delete(discadiaListKey);
    if (listDeleted) {
      deletedListCount++;
      console.log(`\nDeleted reminders:discadia:list`);
    }

    // Also check for any orphaned reminders with type 'discadia' that might not be in the list
    // Use direct SQL query for this to be thorough
    const db = new Database(sqlitePath, { readonly: false });
    
    // Get all keys in nova_reminders namespace
    const allReminderKeys = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE 'nova_reminders:reminder:%'
    `).all();

    let orphanedCount = 0;
    for (const row of allReminderKeys) {
      try {
        const parsed = JSON.parse(row.value);
        const value = parsed?.value || parsed;
        
        if (value && typeof value === 'object' && value.type === 'discadia') {
          const deleted = await reminderKeyv.delete(row.key.replace('nova_reminders:', ''));
          if (deleted) {
            orphanedCount++;
            console.log(`  Deleted orphaned reminder: ${row.key}`);
          }
        }
      } catch (e) {
        // Skip if value can't be parsed
      }
    }
    
    db.close();

    // Disconnect Keyv
    await reminderKeyv.disconnect();

    console.log('\n' + '='.repeat(50));
    console.log('Cleanup Summary:');
    console.log(`  Reminder entries deleted: ${deletedReminderCount}`);
    console.log(`  Orphaned reminders deleted: ${orphanedCount}`);
    console.log(`  List entry deleted: ${deletedListCount > 0 ? 'Yes' : 'No'}`);
    console.log(`  Total items removed: ${deletedReminderCount + orphanedCount + deletedListCount}`);
    console.log('='.repeat(50));
    
    if (deletedReminderCount === 0 && orphanedCount === 0 && deletedListCount === 0) {
      console.log('\nNo Discadia reminders found in the database.');
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

