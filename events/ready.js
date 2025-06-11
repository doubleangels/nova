/**
 * Event handler for when the bot becomes ready.
 * Handles bot initialization, status updates, and startup tasks.
 * @module events/ready
 */

const { ActivityType, Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { loadVoiceJoinTimes } = require('./voiceStateUpdate');
const { initializeDatabase } = require('../utils/database');
const { logError } = require('../errors');

const deployCommands = require('../deploy-commands');

const READY_BOT_ACTIVITY = {
  name: "for ways to help! ❤️",
  type: ActivityType.Watching
};
const READY_BOT_STATUS = "online";

const READY_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred during bot initialization.";
const READY_ERROR_INITIALIZATION = "⚠️ Failed to initialize the bot.";
const READY_ERROR_DATABASE = "⚠️ Failed to initialize database connection.";
const READY_ERROR_MUTE_KICK = "⚠️ Failed to reschedule mute kicks.";
const READY_ERROR_REMINDER = "⚠️ Failed to reschedule reminders.";
const READY_ERROR_ACTIVITY = "⚠️ Failed to set bot activity.";
const READY_ERROR_STATUS = "⚠️ Failed to set bot status.";
const READY_ERROR_VOICE_JOIN = "⚠️ Failed to load voice join times.";
const READY_ERROR_PERMISSION = "⚠️ Insufficient permissions for bot initialization.";

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

/**
 * Event handler for bot ready events.
 * @type {Object}
 */
module.exports = {
  name: Events.ClientReady,
  once: true,
  /**
   * Executes when the bot becomes ready.
   * @async
   * @function execute
   * @param {Client} client - The Discord client instance
   * @throws {Error} If bot initialization fails
   */
  async execute(client) {
    try {
      client.user.setActivity(READY_BOT_ACTIVITY.name, { type: READY_BOT_ACTIVITY.type });
      logger.info(`Ready! Logged in as ${client.user.tag}`);

      await initializeDatabase();
      logger.info('Database connection initialized successfully.');

      await rescheduleAllMuteKicks(client);
      logger.info('Mute kicks rescheduled successfully.');

      await rescheduleReminder(client);
      logger.info('Reminders rescheduled successfully.');

      logger.info('Bot is ready and all systems are initialized.');
    } catch (error) {
      logger.error('Error in ready event:', {
        error: error.stack,
        message: error.message
      });
      
      logError(error, 'ready', {
        clientId: client.user?.id,
        clientTag: client.user?.tag
      });

      let errorMessage = READY_ERROR_UNEXPECTED;
      
      if (error.message === READY_ERROR_DATABASE) {
        errorMessage = READY_ERROR_DATABASE;
      } else if (error.message === READY_ERROR_MUTE_KICK) {
        errorMessage = READY_ERROR_MUTE_KICK;
      } else if (error.message === READY_ERROR_REMINDER) {
        errorMessage = READY_ERROR_REMINDER;
      } else if (error.message === READY_ERROR_ACTIVITY) {
        errorMessage = READY_ERROR_ACTIVITY;
      } else if (error.message === READY_ERROR_STATUS) {
        errorMessage = READY_ERROR_STATUS;
      } else if (error.message === READY_ERROR_VOICE_JOIN) {
        errorMessage = READY_ERROR_VOICE_JOIN;
      } else if (error.message === READY_ERROR_PERMISSION) {
        errorMessage = READY_ERROR_PERMISSION;
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