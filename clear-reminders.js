/**
 * Script to clear old/expired reminders from the database
 * 
 * Usage: 
 *   node clear-reminders.js [--all] [--type <bump|promote>]
 * 
 * Options:
 *   --all          Clear ALL reminders (both expired and active)
 *   --type <type>  Clear reminders of a specific type (bump or promote)
 *                  If not specified, clears reminders of both types
 * 
 * Examples:
 *   node clear-reminders.js                    # Clear only expired reminders
 *   node clear-reminders.js --all              # Clear all reminders
 *   node clear-reminders.js --type bump        # Clear only expired bump reminders
 *   node clear-reminders.js --all --type bump  # Clear all bump reminders
 */

require('dotenv').config();
const Keyv = require('keyv');
const KeyvSqlite = require('@keyv/sqlite');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Keyv for reminder storage using SQLite (same as reminderUtils.js)
// Using the same database.sqlite file as the main database, but with a different namespace
const sqlitePath = path.join(dataDir, 'database.sqlite');
const reminderKeyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
  }),
  namespace: 'nova_reminders'
});

reminderKeyv.on('error', err => console.error('Reminder Keyv connection error:', err));

/**
 * Get all reminder IDs for a type
 */
async function getReminderIds(type) {
  const listKey = `reminders:${type}:list`;
  return await reminderKeyv.get(listKey) || [];
}

/**
 * Remove a reminder ID from the list
 */
async function removeReminderId(type, reminderId) {
  const listKey = `reminders:${type}:list`;
  const list = await getReminderIds(type);
  const filtered = list.filter(id => id !== reminderId);
  await reminderKeyv.set(listKey, filtered);
}

/**
 * Clear reminders for a specific type
 */
async function clearReminders(type, clearAll = false) {
  try {
    const reminderIds = await getReminderIds(type);
    
    if (reminderIds.length === 0) {
      console.log(`ℹ️  No ${type} reminders found in database.`);
      return { deleted: 0, expired: 0, active: 0 };
    }
    
    console.log(`\n📋 Found ${reminderIds.length} ${type} reminder(s) in database.`);
    
    const now = new Date();
    let deletedCount = 0;
    let expiredCount = 0;
    let activeCount = 0;
    
    const idsToRemove = [];
    
    for (const id of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      
      if (!reminder) {
        // Reminder data missing, mark for cleanup
        idsToRemove.push(id);
        deletedCount++;
        console.log(`  ⚠️  Reminder ${id}: Missing data (will be removed)`);
        continue;
      }
      
      if (!reminder.remind_at) {
        // Invalid reminder data, mark for cleanup
        idsToRemove.push(id);
        deletedCount++;
        console.log(`  ⚠️  Reminder ${id}: Invalid data (will be removed)`);
        continue;
      }
      
      const remindAt = reminder.remind_at instanceof Date 
        ? reminder.remind_at 
        : new Date(reminder.remind_at);
      
      if (isNaN(remindAt.getTime())) {
        // Invalid date, mark for cleanup
        idsToRemove.push(id);
        deletedCount++;
        console.log(`  ⚠️  Reminder ${id}: Invalid date (will be removed)`);
        continue;
      }
      
      const isExpired = remindAt <= now;
      
      if (clearAll || isExpired) {
        idsToRemove.push(id);
        if (isExpired) {
          expiredCount++;
          console.log(`  🗑️  Reminder ${id}: Expired (scheduled for ${remindAt.toISOString()})`);
        } else {
          activeCount++;
          console.log(`  🗑️  Reminder ${id}: Active (scheduled for ${remindAt.toISOString()}) - removing due to --all flag`);
        }
      } else {
        console.log(`  ✓  Reminder ${id}: Active (scheduled for ${remindAt.toISOString()}) - keeping`);
      }
    }
    
    // Delete all marked reminders
    for (const id of idsToRemove) {
      await reminderKeyv.delete(`reminder:${id}`);
      await removeReminderId(type, id);
    }
    
    if (idsToRemove.length > 0) {
      console.log(`\n✅ Cleared ${idsToRemove.length} ${type} reminder(s):`);
      if (expiredCount > 0) console.log(`   - ${expiredCount} expired`);
      if (activeCount > 0) console.log(`   - ${activeCount} active (removed due to --all flag)`);
      if (deletedCount > 0) console.log(`   - ${deletedCount} invalid/missing`);
    } else {
      console.log(`\n✅ No ${type} reminders to clear.`);
    }
    
    return { deleted: deletedCount, expired: expiredCount, active: activeCount };
  } catch (error) {
    console.error(`❌ Error clearing ${type} reminders:`, error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let clearAll = false;
    let types = ['bump', 'promote'];
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--all') {
        clearAll = true;
      } else if (args[i] === '--type' && i + 1 < args.length) {
        const type = args[i + 1].toLowerCase();
        if (type === 'bump' || type === 'promote') {
          types = [type];
          i++; // Skip the next argument as we've consumed it
        } else {
          console.error(`❌ Invalid type: ${type}. Must be 'bump' or 'promote'.`);
          process.exit(1);
        }
      } else if (args[i].startsWith('--')) {
        console.error(`❌ Unknown option: ${args[i]}`);
        console.error('\nUsage: node clear-reminders.js [--all] [--type <bump|promote>]');
        process.exit(1);
      }
    }
    
    console.log('🧹 Clearing reminders from database...');
    if (clearAll) {
      console.log('⚠️  --all flag set: Will clear ALL reminders (including active ones)');
    } else {
      console.log('ℹ️  Will only clear expired reminders (use --all to clear all)');
    }
    console.log(`📌 Types to process: ${types.join(', ')}`);
    
    let totalDeleted = 0;
    let totalExpired = 0;
    let totalActive = 0;
    
    for (const type of types) {
      const result = await clearReminders(type, clearAll);
      totalDeleted += result.deleted;
      totalExpired += result.expired;
      totalActive += result.active;
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Summary:');
    console.log(`   Total cleared: ${totalDeleted + totalExpired + totalActive}`);
    if (totalExpired > 0) console.log(`   - Expired: ${totalExpired}`);
    if (totalActive > 0) console.log(`   - Active (removed): ${totalActive}`);
    if (totalDeleted > 0) console.log(`   - Invalid/missing: ${totalDeleted}`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await reminderKeyv.disconnect();
  }
}

main();
