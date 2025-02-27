const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { getValue } = require('../utils/supabase');

/**
 * Event handler for the 'ready' event.
 * Executed once when the bot comes online. It sets the bot's presence,
 * attempts to reschedule Disboard reminders, and reschedules all mute kicks.
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
          name: "for ways to assist!",
          type: ActivityType.Watching
        }],
        status: "online"
      });
      logger.debug("Bot presence and activity set", { activity: "Watching for ways to assist", status: "online" });
    } catch (error) {
      logger.error("Failed to set bot presence", { error });
    }

    try {
      // Retrieve the role ID for reminders from the database.
      const role = await getValue("reminder_role");
      if (!role) {
        logger.warn("Reminder role not configured; skipping Disboard reminder reschedule.");
      } else {
        logger.debug("Reminder role retrieved", { reminderRole: role });
        try {
          logger.debug("Attempting to reschedule Disboard reminder.");
          await rescheduleReminder("disboard", role, client);
          logger.debug("Disboard reminder successfully rescheduled.");
        } catch (innerError) {
          logger.error("Failed to reschedule Disboard reminder", { error: innerError });
        }
      }
    } catch (error) {
      logger.error("Error during Disboard reminder rescheduling", { error });
    }

    try {
      logger.debug("Attempting to reschedule all mute kicks for tracked members.");
      await rescheduleAllMuteKicks(client);
      logger.debug("Mute kick rescheduling completed successfully.");
    } catch (error) {
      logger.error("Error while rescheduling mute kicks", { error });
    }

    logger.info("Bot is ready and setup complete!");
  }
};
