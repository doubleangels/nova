const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { loadVoiceJoinTimes } = require('./voiceStateUpdate');
const { initializeDatabase } = require('../utils/database');
const Sentry = require('../sentry');

// We import the deploy-commands module to register slash commands with Discord.
const deployCommands = require('../deploy-commands');

// We configure the bot's activity and status for a consistent presence.
const BOT_ACTIVITY = {
  name: "for ways to assist! ❤️",
  type: ActivityType.Watching
};
const BOT_STATUS = "online";

/**
 * Performs a setup task with proper error handling and logging.
 * We use this helper function to standardize our setup process and error handling.
 * 
 * @param {string} taskName - Name of the task for logging.
 * @param {Function} task - Async function to execute.
 * @param {string} startMessage - Message to log before starting.
 * @param {string} successMessage - Message to log on success.
 * @returns {Promise<boolean>} Whether the task completed successfully.
 */
async function performSetupTask(taskName, task, startMessage, successMessage) {
  try {
    logger.debug(startMessage);
    await task();
    logger.info(successMessage);
    return true;
  } catch (error) {
    // We track errors with Sentry for better monitoring and troubleshooting.
    Sentry.captureException(error, {
      extra: {
        taskName,
        startMessage
      }
    });
    
    logger.error(`Failed to ${taskName}:`, { 
      error: error.message || error.toString(),
      stack: error.stack
    });
    return false;
  }
}

/**
 * We handle the ready event when the bot starts up.
 * This function initializes the bot's state and reschedules any pending operations.
 *
 * We perform several initialization tasks:
 * 1. Set the bot's activity status
 * 2. Initialize the database connection
 * 3. Reschedule mute kicks for tracked members
 * 4. Reschedule any pending reminders
 *
 * @param {Client} client - The Discord client instance
 */
module.exports = {
  name: 'ready',
  async execute(client) {
    try {
      // We set the bot's activity status to indicate it's ready.
      client.user.setActivity('Da Frens', { type: ActivityType.Playing });
      logger.info(`Logged in as ${client.user.tag}`);

      // We initialize the database connection.
      await initializeDatabase();
      logger.info('Database connection initialized successfully.');

      // We reschedule mute kicks for any tracked members.
      await rescheduleAllMuteKicks(client);
      logger.info('Mute kicks rescheduled successfully.');

      // We reschedule any pending reminders.
      await rescheduleReminder(client);
      logger.info('Reminders rescheduled successfully.');

      logger.info('Bot is ready and all systems are initialized.');
    } catch (error) {
      logger.error('Error during bot initialization:', { 
        error: error.message,
        stack: error.stack
      });
    }
  }
};