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

// We define the bot's activity and status for consistent presence.
const BOT_ACTIVITY = {
  name: "for ways to assist! ❤️",
  type: ActivityType.Watching
};
const BOT_STATUS = "online";

/**
 * We perform a setup task with proper error handling and logging.
 * This function standardizes our setup process and error handling.
 * 
 * @param {string} taskName - The name of the task for logging purposes.
 * @param {Function} task - The async function to execute.
 * @param {string} startMessage - The message to log before starting.
 * @param {string} successMessage - The message to log on success.
 * @returns {Promise<boolean>} Whether the task completed successfully.
 */
async function performSetupTask(taskName, task, startMessage, successMessage) {
  try {
    logger.debug(startMessage);
    await task();
    logger.info(successMessage);
    return true;
  } catch (error) {
    // We capture errors in Sentry for monitoring and troubleshooting.
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
 * 1. We set the bot's activity status to indicate it's ready for use.
 * 2. We initialize the database connection for data persistence.
 * 3. We reschedule mute kicks for tracked members to maintain moderation.
 * 4. We reschedule any pending reminders to ensure timely notifications.
 *
 * @param {Client} client - The Discord client instance.
 */
module.exports = {
  name: 'ready',
  async execute(client) {
    try {
      // We set the bot's activity status to indicate it's ready for use.
      client.user.setActivity('Da Frens', { type: ActivityType.Playing });
      logger.info(`Logged in as ${client.user.tag}`);

      // We initialize the database connection for data persistence.
      await initializeDatabase();
      logger.info('Database connection initialized successfully.');

      // We reschedule mute kicks for any tracked members to maintain moderation.
      await rescheduleAllMuteKicks(client);
      logger.info('Mute kicks rescheduled successfully.');

      // We reschedule any pending reminders to ensure timely notifications.
      await rescheduleReminder(client);
      logger.info('Reminders rescheduled successfully.');

      // We log successful initialization of all systems.
      logger.info('Bot is ready and all systems are initialized.');
    } catch (error) {
      // We log any errors that occur during initialization.
      logger.error('Error during bot initialization:', { 
        error: error.message,
        stack: error.stack
      });
    }
  }
};