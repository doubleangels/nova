const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');

// Import the deploy-commands module
const deployCommands = require('../deploy-commands');

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
          name: "for ways to assist! ❤️",
          type: ActivityType.Watching
        }],
        status: "online"
      });
      logger.debug("Bot presence and activity set:", { activity: "Watching for ways to assist", status: "online" });
    } catch (error) {
      logger.error("Failed to set bot presence:", { error });
    }

    try {
      // Deploy slash commands
      logger.debug("Deploying slash commands to Discord...");
      await deployCommands();
      logger.debug("Slash commands deployed successfully");
    } catch (error) {
      logger.error("Failed to deploy slash commands:", { error });
    }

    try {
      logger.debug("Attempting to reschedule all mute kicks for tracked members.");
      await rescheduleAllMuteKicks(client);
      logger.debug("Mute kick rescheduling completed successfully.");
    } catch (error) {
      logger.error("Error while rescheduling mute kicks:", { error });
    }

    try {
      logger.debug("Attempting to reschedule all bump reminders from the database.");
      await rescheduleReminder(client);
      logger.debug("Bump reminder rescheduling completed successfully.");
    } catch (error) {
      logger.error("Error while rescheduling bump reminders:", { error });
    }

    logger.info("Bot is ready and setup complete!");
  }
};
