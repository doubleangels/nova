/**
 * Script to temporarily add a user to spam mode tracking database
 * 
 * Usage: node add-spam-mode-user.js <userId> [username] [joinTime]
 * 
 * Examples:
 *   node add-spam-mode-user.js "123456789012345678"
 *   node add-spam-mode-user.js "123456789012345678" "TestUser#1234"
 *   node add-spam-mode-user.js "123456789012345678" "TestUser#1234" "2024-01-01T00:00:00.000Z"
 *   node add-spam-mode-user.js "123456789012345678" "TestUser#1234" "now"
 */

require('dotenv').config();
const { addSpamModeJoinTime } = require('./utils/database');

async function addUserToSpamMode(userId, username = null, joinTime = null) {
  try {
    // Initialize database connection
    const { initializeDatabase } = require('./utils/database');
    await initializeDatabase();
    
    // Use provided username or default
    const displayUsername = username || `User_${userId}`;
    
    // Parse join time
    let timeToSet;
    if (joinTime === null || joinTime === 'now' || joinTime === '') {
      // Set to current time
      timeToSet = new Date();
      console.log(`Adding user ${userId} (${displayUsername}) to spam mode tracking with current time.`);
    } else {
      // Try to parse the provided time
      timeToSet = new Date(joinTime);
      if (isNaN(timeToSet.getTime())) {
        console.error(`Invalid date format: ${joinTime}`);
        console.error('Please use ISO 8601 format (e.g., "2024-01-01T00:00:00.000Z") or "now"');
        process.exit(1);
      }
      console.log(`Adding user ${userId} (${displayUsername}) to spam mode tracking with join time: ${timeToSet.toISOString()}`);
    }
    
    // Add user to spam mode tracking
    await addSpamModeJoinTime(userId, displayUsername, timeToSet);
    
    console.log(`✅ Successfully added user ${userId} (${displayUsername}) to spam mode tracking.`);
    console.log(`   Join time: ${timeToSet.toISOString()}`);
    console.log(`   User will be tracked for spam mode until the tracking window expires.`);
    
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error adding user to spam mode tracking:`, error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node add-spam-mode-user.js <userId> [username] [joinTime]');
  console.error('');
  console.error('Arguments:');
  console.error('  userId    - Discord user ID (required)');
  console.error('  username  - Discord username/tag (optional, defaults to "User_<userId>")');
  console.error('  joinTime  - Join time in ISO 8601 format or "now" (optional, defaults to current time)');
  console.error('');
  console.error('Examples:');
  console.error('  node add-spam-mode-user.js "123456789012345678"');
  console.error('  node add-spam-mode-user.js "123456789012345678" "TestUser#1234"');
  console.error('  node add-spam-mode-user.js "123456789012345678" "TestUser#1234" "2024-01-01T00:00:00.000Z"');
  console.error('  node add-spam-mode-user.js "123456789012345678" "TestUser#1234" "now"');
  process.exit(1);
}

const userId = args[0];
const username = args[1] || null;
const joinTime = args[2] || null;

addUserToSpamMode(userId, username, joinTime);

