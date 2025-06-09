/**
 * Event handler for when the bot becomes ready.
 * Handles bot initialization, status updates, and startup tasks.
 * @module events/ready
 */

const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { loadVoiceJoinTimes } = require('./voiceStateUpdate');
const { initializeDatabase } = require('../utils/database');
const Sentry = require('../sentry');
const { logError } = require('../errors');

const deployCommands = require('../deploy-commands');

const BOT_ACTIVITY = {
  name: "for ways to help! ❤️",
  type: ActivityType.Watching
};
const BOT_STATUS = "online";

/**
 * Error messages specific to the ready event.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred during bot initialization.",
    BOT_INITIALIZATION_FAILED: "⚠️ Failed to initialize the bot.",
    DATABASE_INITIALIZATION_FAILED: "⚠️ Failed to initialize database connection.",
    MUTE_KICK_RESCHEDULE_FAILED: "⚠️ Failed to reschedule mute kicks.",
    REMINDER_RESCHEDULE_FAILED: "⚠️ Failed to reschedule reminders.",
    ACTIVITY_SET_FAILED: "⚠️ Failed to set bot activity.",
    STATUS_SET_FAILED: "⚠️ Failed to set bot status.",
    VOICE_JOIN_TIMES_LOAD_FAILED: "⚠️ Failed to load voice join times.",
    PERMISSION_DENIED: "⚠️ Insufficient permissions for bot initialization."
};

async function performSetupTask(taskName, task, startMessage, successMessage) {
  try {
    logger.debug(startMessage);
    await task();
    logger.info(successMessage);
    return true;
  } catch (error) {
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
 * Event handler for bot ready events.
 * @type {Object}
 */
module.exports = {
  name: 'ready',
  /**
   * Executes when the bot becomes ready.
   * @async
   * @function execute
   * @param {Client} client - The Discord client instance
   * @throws {Error} If bot initialization fails
   */
  async execute(client) {
    try {
      client.user.setActivity(BOT_ACTIVITY.name, { type: BOT_ACTIVITY.type });
      logger.info(`Logged in as ${client.user.tag}.`);

      await initializeDatabase();
      logger.info('Database connection initialized successfully.');

      await rescheduleAllMuteKicks(client);
      logger.info('Mute kicks rescheduled successfully.');

      await rescheduleReminder(client);
      logger.info('Reminders rescheduled successfully.');

      logger.info('Bot is ready and all systems are initialized.');
    } catch (error) {
      logger.error('Error during bot initialization:', { 
        error: error.message,
        stack: error.stack
      });
      
      logError(error, 'ready', {
        clientId: client.user?.id,
        clientTag: client.user?.tag
      });

      let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
      
      if (error.message === "DATABASE_INITIALIZATION_FAILED") {
        errorMessage = ERROR_MESSAGES.DATABASE_INITIALIZATION_FAILED;
      } else if (error.message === "MUTE_KICK_RESCHEDULE_FAILED") {
        errorMessage = ERROR_MESSAGES.MUTE_KICK_RESCHEDULE_FAILED;
      } else if (error.message === "REMINDER_RESCHEDULE_FAILED") {
        errorMessage = ERROR_MESSAGES.REMINDER_RESCHEDULE_FAILED;
      } else if (error.message === "ACTIVITY_SET_FAILED") {
        errorMessage = ERROR_MESSAGES.ACTIVITY_SET_FAILED;
      } else if (error.message === "STATUS_SET_FAILED") {
        errorMessage = ERROR_MESSAGES.STATUS_SET_FAILED;
      } else if (error.message === "VOICE_JOIN_TIMES_LOAD_FAILED") {
        errorMessage = ERROR_MESSAGES.VOICE_JOIN_TIMES_LOAD_FAILED;
      } else if (error.message === "PERMISSION_DENIED") {
        errorMessage = ERROR_MESSAGES.PERMISSION_DENIED;
      }
      
      throw new Error(errorMessage);
    }
  }
};

/**
 * Initializes required services for the bot.
 * @async
 * @function initializeServices
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
 */
async function initializeServices(client) {
}