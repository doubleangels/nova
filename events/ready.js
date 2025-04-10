const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');

// Import the deploy-commands module.
const deployCommands = require('../deploy-commands');

// Bot activity configuration.
const BOT_ACTIVITY = {
  name: "for ways to assist! ❤️",
  type: ActivityType.Watching
};
const BOT_STATUS = "online";

/**
 * Event handler for the 'ready' event.
 * Executed once when the bot comes online. It sets the bot's presence,
 * attempts to reschedule Disboard reminders, reschedules all mute kicks,
 * and deploys slash commands.
 *
 * @param {Client} client - The Discord client instance.
 */
module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info("Bot is online! Initializing setup procedures...");

    try {
      // Set the bot's presence with a custom activity.
      await client.user.setPresence({
        activities: [{
          name: BOT_ACTIVITY.name,
          type: BOT_ACTIVITY.type
        }],
        status: BOT_STATUS
      });
      logger.debug("Bot presence and activity set:", { activity: `${BOT_ACTIVITY.type} ${BOT_ACTIVITY.name}`, status: BOT_STATUS });
    } catch (error) {
      logger.error("Failed to set bot presence:", { error });
    }

    if (config.settings.deployCommandsOnStart) {
      try {
        logger.debug("Attempting to deploy all slash commands to Discord API.");
        await deployCommands();
        logger.info("Slash command deployment completed successfully.");
      } catch (error) {
        logger.error("Failed to deploy slash commands:", { error });
      }
    }

    if (config.settings.rescheduleReminderOnStart) {
      try {
        logger.debug("Attempting to reschedule all bump reminders from the database.");
        await rescheduleReminder(client);
        logger.info("Bump reminder rescheduling completed successfully.");
      } catch (error) {
        logger.error("Error while rescheduling bump reminders:", { error });
      }
    }

    if (config.settings.rescheduleAllMuteKicksOnStart) {
      try {
        logger.debug("Attempting to reschedule all mute kicks for tracked members.");
        await rescheduleAllMuteKicks(client);
        logger.info("Mute kick rescheduling completed successfully.");
      } catch (error) {
        logger.error("Error while rescheduling mute kicks:", { error });
      }
    }

    logger.info("Bot is ready and setup complete!");
  }
};
