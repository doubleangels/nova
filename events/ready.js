const { ActivityType, Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { initializeDatabase, getValue } = require('../utils/database');

const deployCommands = require('../deploy-commands');

const DEFAULT_BOT_ACTIVITY = {
  name: "for ways to help! ❤️",
  type: ActivityType.Watching
};

/**
 * Performs a setup task with error handling and logging
 * @param {string} taskName - The name of the task being performed
 * @param {Function} task - The async function to execute
 * @param {string} startMessage - The message to log when starting
 * @param {string} successMessage - The message to log on success
 * @returns {Promise<boolean>} True if the task succeeded, false otherwise
 */
async function performSetupTask(taskName, task, startMessage, successMessage) {
  try {
    logger.debug(startMessage);
    await task();
    logger.info(successMessage);
    return true;
  } catch (error) {
    logger.error(`Failed to ${taskName}:`, { 
      error: error.message || error.toString(),
      stack: error.stack
    });
    return false;
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,

  /**
   * Handles the event when the bot is ready.
   * This function:
   * 1. Sets the bot's activity status
   * 2. Initializes the database connection
   * 3. Reschedules mute kicks and reminders
   * 
   * @param {Client} client - The Discord client instance
   * @throws {Error} If there's an error during initialization
   * @returns {Promise<void>}
   */
  async execute(client) {
    try {
      await initializeDatabase();
      logger.info('Database connection initialized successfully.');

      // Get bot status from database config
      let botActivity = DEFAULT_BOT_ACTIVITY;
      try {
        const botStatusConfig = await getValue('bot_status');
        if (botStatusConfig && botStatusConfig.name) {
          // Map activity type string to ActivityType enum (case-insensitive)
          const activityTypeMap = {
            'playing': ActivityType.Playing,
            'streaming': ActivityType.Streaming,
            'listening': ActivityType.Listening,
            'watching': ActivityType.Watching,
            'competing': ActivityType.Competing,
            'custom': ActivityType.Custom
          };
          
          const typeKey = (botStatusConfig.type || '').toLowerCase().trim();
          const activityType = activityTypeMap[typeKey] || ActivityType.Watching;
          botActivity = {
            name: botStatusConfig.name,
            type: activityType
          };
          logger.info(`Loaded bot status from database: {"name":"${botStatusConfig.name}","type":"${botStatusConfig.type}"}`);
        } else {
          logger.info('No bot_status config found in database, using default.');
        }
      } catch (error) {
        logger.warn('Failed to load bot status from database, using default:', { error: error.message });
      }

      logger.debug(`Setting bot activity:`, JSON.stringify(botActivity));
      client.user.setActivity(botActivity.name, { type: botActivity.type });
      logger.info(`Ready! Logged in as ${client.user.tag}`);

      await rescheduleAllMuteKicks(client);
      logger.info('Mute kicks rescheduled successfully.');

      await rescheduleReminder(client);
      logger.info('Reminders rescheduled successfully.');

      logger.info('Bot is ready and all systems are initialized.');
    } catch (error) {
      logger.error('Error in ready event:', {
        error: error.stack,
        message: error.message,
        clientId: client.user?.id,
        clientTag: client.user?.tag
      });

      let errorMessage = "⚠️ An unexpected error occurred during bot initialization.";
      
      if (error.message === "⚠️ Failed to initialize database connection.") {
        errorMessage = "⚠️ Failed to initialize database connection.";
      } else if (error.message === "⚠️ Failed to reschedule mute kicks.") {
        errorMessage = "⚠️ Failed to reschedule mute kicks.";
      } else if (error.message === "⚠️ Failed to reschedule reminders.") {
        errorMessage = "⚠️ Failed to reschedule reminders.";
      } else if (error.message === "⚠️ Failed to set bot activity.") {
        errorMessage = "⚠️ Failed to set bot activity.";
      } else if (error.message === "⚠️ Failed to set bot status.") {
        errorMessage = "⚠️ Failed to set bot status.";
      } else if (error.message === "⚠️ Failed to load voice join times.") {
        errorMessage = "⚠️ Failed to load voice join times.";
      } else if (error.message === "⚠️ Insufficient permissions for bot initialization.") {
        errorMessage = "⚠️ Insufficient permissions for bot initialization.";
      }
      
      throw new Error(errorMessage);
    }
  }
};

/**
 * Initializes all required services for the bot
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
 */
async function initializeServices(client) {
}