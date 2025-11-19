const { ActivityType, Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { initializeDatabase, getValue } = require('../utils/database');

const DEFAULT_BOT_ACTIVITY = {
  name: "for ways to help! ❤️",
  type: ActivityType.Watching
};

module.exports = {
  name: Events.ClientReady,
  once: true,

  /**
   * Handles the event when the bot is ready.
   * This function:
   * 1. Sets the bot's activity status
   * 2. Initializes the database connection
   * 3. Reschedules mute kicks
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
      throw error;
    }
  }
};

