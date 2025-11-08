/**
 * Test script to fake a recent join time for spam mode testing
 * 
 * Usage: node test-spam-mode.js <userId> <username> [minutesAgo]
 * 
 * Examples:
 *   node test-spam-mode.js 123456789 "YourUsername#1234" 30
 *   node test-spam-mode.js 123456789 "YourUsername#1234"
 * 
 * If minutesAgo is not provided, it defaults to 30 minutes ago
 */

require('dotenv').config();
const { updateUserJoinTime } = require('./utils/database');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node test-spam-mode.js <userId> <username> [minutesAgo]');
    console.log('');
    console.log('Examples:');
    console.log('  node test-spam-mode.js 123456789 "YourUsername#1234" 30');
    console.log('  node test-spam-mode.js 123456789 "YourUsername#1234"');
    console.log('');
    console.log('If minutesAgo is not provided, it defaults to 30 minutes ago');
    process.exit(1);
  }

  const userId = args[0];
  const username = args[1];
  const minutesAgo = args[2] ? parseInt(args[2], 10) : 30;

  if (isNaN(minutesAgo) || minutesAgo < 0) {
    console.error('Error: minutesAgo must be a positive number');
    process.exit(1);
  }

  try {
    // Calculate join time (X minutes ago)
    const joinTime = new Date(Date.now() - minutesAgo * 60 * 1000);
    
    console.log(`Updating join time for user ${userId} (${username})...`);
    console.log(`Setting join time to: ${joinTime.toISOString()}`);
    console.log(`This is ${minutesAgo} minutes ago`);
    
    await updateUserJoinTime(userId, username, joinTime);
    
    console.log('✅ Successfully updated join time!');
    console.log('');
    console.log('Now you can test spam mode by:');
    console.log('1. Make sure spam mode is enabled: /spammode set enabled:true');
    console.log('2. Send the same message in multiple channels');
    console.log('3. Check the bot logs for spam mode warnings');
    
    process.exit(0);
  } catch (error) {
    console.error('Error updating join time:', error);
    process.exit(1);
  }
}

main();

