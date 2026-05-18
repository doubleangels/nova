/**
 * Script to prune unused, orphaned, or obsolete keys from the Keyv SQLite database.
 * 
 * Usage:
 *   node prune-db.js             # Dry run (default, will not modify anything)
 *   node prune-db.js --commit    # Real execution (will delete matching obsolete keys and vacuum)
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { sqlitePath, checkDatabaseAccess } = require('./utils/dbScriptUtils');

// Define the exact schema rules
const VALID_CONFIG_KEYS = new Set([
  'notext_channel',
  'troll_mode_enabled',
  'troll_mode_account_age',
  'reminder_channel',
  'reminder_role',
  'mute_mode_enabled',
  'mute_mode_kick_time_hours',
  'spam_mode_enabled',
  'spam_mode_threshold',
  'spam_mode_window_hours',
  'spam_mode_channel_id',
  'invite_notification_channel',
  'mute_mode_users',
  'spam_mode_users'
]);

const DISCORD_ID_REGEX = /^\d{17,20}$/;

function isKeyNeeded(dbKey) {
  const parts = dbKey.split(':');
  if (parts.length < 2) {
    return false; // Keyv keys must have at least namespace:key
  }

  const namespace = parts[0];
  const rest = parts.slice(1).join(':');

  if (namespace === 'main') {
    // 1. Config keys (main:config:<key>)
    if (rest.startsWith('config:')) {
      const configKey = rest.substring('config:'.length);
      return VALID_CONFIG_KEYS.has(configKey);
    }

    // 2. Mute mode users (main:mute_mode:<userId>)
    if (rest.startsWith('mute_mode:')) {
      const userId = rest.substring('mute_mode:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    // 3. Spam mode users (main:spam_mode:<userId>)
    if (rest.startsWith('spam_mode:')) {
      const userId = rest.substring('spam_mode:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    // 4. Former members (main:former_member:<userId>)
    if (rest.startsWith('former_member:')) {
      const userId = rest.substring('former_member:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    // 5. Message counts (main:message_count:<userId>)
    if (rest.startsWith('message_count:')) {
      const userId = rest.substring('message_count:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    // 6. Invite usage (main:invite_usage:<guildId>)
    if (rest.startsWith('invite_usage:')) {
      const guildId = rest.substring('invite_usage:'.length);
      return DISCORD_ID_REGEX.test(guildId);
    }

    // 7. Invite code to tag map (main:invite_code_to_tag_map:<guildId>)
    if (rest.startsWith('invite_code_to_tag_map:')) {
      const guildId = rest.substring('invite_code_to_tag_map:'.length);
      return DISCORD_ID_REGEX.test(guildId);
    }

    return false;
  }

  if (namespace === 'invites') {
    // 8. Invite tags (invites:tags:<tagName>)
    if (rest.startsWith('tags:')) {
      const tagName = rest.substring('tags:'.length);
      return tagName.length > 0;
    }

    return false;
  }

  if (namespace === 'nova_reminders') {
    // 9. Reminder lists (nova_reminders:reminders:<type>:list)
    if (rest === 'reminders:bump:list' ||
        rest === 'reminders:promote:list' ||
        rest === 'reminders:needafriend:list') {
      return true;
    }

    // 10. Individual reminders (nova_reminders:reminder:<uuid>)
    if (rest.startsWith('reminder:')) {
      const reminderId = rest.substring('reminder:'.length);
      return reminderId.length > 0;
    }

    return false;
  }

  return false; // Unknown namespace
}

async function pruneDatabase() {
  const args = process.argv.slice(2);
  const isCommit = args.includes('--commit');

  console.log('=== Keyv SQLite Database Pruner ===');
  console.log(`Database Path: ${sqlitePath}`);
  console.log(`Mode: ${isCommit ? 'COMMIT (Keys WILL be deleted)' : 'DRY RUN (Read-only)'}\n`);

  // Check database access permissions first
  const accessCheck = checkDatabaseAccess();
  if (!accessCheck.accessible && accessCheck.fileExists) {
    console.error('Permission error: Cannot access database file.');
    if (accessCheck.recommendation) {
      console.error('\nRecommendation:');
      console.error(accessCheck.recommendation);
    }
    process.exit(1);
  }

  if (!fs.existsSync(sqlitePath)) {
    console.log('Database file does not exist. Nothing to prune.');
    process.exit(0);
  }

  let db;
  try {
    db = new Database(sqlitePath, { readonly: !isCommit });
  } catch (error) {
    console.error(`Failed to open database: ${error.message}`);
    process.exit(1);
  }

  try {
    // Check if table 'keyv' exists
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='keyv'
    `).get();

    if (!tableCheck) {
      console.log("The 'keyv' table does not exist in the database yet. Nothing to prune.");
      db.close();
      return;
    }

    // Fetch all keys
    const rows = db.prepare('SELECT key FROM keyv').all();
    console.log(`Analyzing ${rows.length} total key(s) in the 'keyv' table...\n`);

    const keepKeys = [];
    const deleteKeys = [];

    for (const row of rows) {
      if (isKeyNeeded(row.key)) {
        keepKeys.push(row.key);
      } else {
        deleteKeys.push(row.key);
      }
    }

    // Print breakdown
    console.log(`Analysis Results:`);
    console.log(`  - Keys to KEEP:   ${keepKeys.length}`);
    console.log(`  - Keys to DELETE: ${deleteKeys.length}`);
    console.log('');

    if (deleteKeys.length === 0) {
      console.log('No unnecessary or orphaned keys found in the database. Your database is clean! ✨');
      db.close();
      return;
    }

    if (deleteKeys.length > 0) {
      console.log('Unnecessary / obsolete keys found:');
      deleteKeys.sort().forEach(key => {
        console.log(`  [DELETE] ${key}`);
      });
      console.log('');
    }

    if (!isCommit) {
      console.log('⚠️  DRY RUN ONLY. No changes were made to the database.');
      console.log('To perform the deletion, run the script with the --commit flag:');
      console.log('  node prune-db.js --commit');
    } else {
      console.log('Deleting unnecessary keys from the database...');
      
      // Perform deletion in a transaction
      const deleteStmt = db.prepare('DELETE FROM keyv WHERE key = ?');
      
      const transaction = db.transaction((keys) => {
        let count = 0;
        for (const key of keys) {
          const result = deleteStmt.run(key);
          count += result.changes;
        }
        return count;
      });

      const deletedCount = transaction(deleteKeys);
      console.log(`Successfully deleted ${deletedCount} obsolete key(s) from the database.`);

      console.log('Reclaiming disk space (VACUUM)...');
      db.pragma('journal_mode = DELETE'); // optimize vacuum speed
      db.prepare('VACUUM').run();
      console.log('Database size optimized successfully. Cleanup complete! 🎉');
    }

    db.close();
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
    if (db) {
      try {
        db.close();
      } catch (closeError) {
        // Ignore
      }
    }
    process.exit(1);
  }
}

pruneDatabase();
