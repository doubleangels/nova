const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { getValue } = require('../utils/supabase');

/**
 * Event handler for the 'ready' event.
 * This function is executed once when the bot comes online. It sets the bot's presence,
 * attempts to reschedule Disboard reminders, and reschedules all mute kicks.
 *
 * @param {Client} client - The Discord client instance.
 */
module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info("Bot is online! Setting up status and activity.");

    try {
      // Set the bot's presence with a custom activity.
      await client.user.setPresence({
        activities: [{
          name: "for ways to assist!",
          type: ActivityType.Watching
        }],
        status: "online"
      });
      logger.debug("Bot presence and activity set successfully.");
    } catch (error) {
      logger.error(`Failed to set bot presence: ${error}`);
    }

    try {
      // Retrieve the role ID for reminders from the database.
      const role = await getValue("reminder_role");
      if (!role) {
        logger.warn("No role set for reminders; skipping Disboard reminder reschedule.");
      } else {
        try {
          logger.debug("Attempting to reschedule Disboard reminder.");
          // Reschedule the Disboard reminder with the retrieved role.
          await rescheduleReminder("disboard", role, client);
          logger.debug("Disboard reminder successfully rescheduled.");
        } catch (innerError) {
          logger.error(`Failed to reschedule Disboard reminder: ${innerError}`);
        }
      }
    } catch (error) {
      logger.error(`Error during Disboard reminder rescheduling: ${error}`);
    }

    try {
      logger.debug("Attempting to reschedule all mute kicks.");
      // Reschedule all mute kicks for tracked members.
      await rescheduleAllMuteKicks(client);
      logger.debug("Mute kick rescheduling completed successfully.");
    } catch (error) {
      logger.error(`Error while rescheduling mute kicks: ${error}`);
    }

    logger.info("Bot is ready!");
  }
};
