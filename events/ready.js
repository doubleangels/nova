const logger = require('../logger');
const { initializeRemindersTable, rescheduleReminder, rescheduleAllMuteKicks } = require('../utils/reminderUtils');
const { getValue } = require('../utils/supabase');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info("Bot is online! Setting up status and activity.");

    // Set bot presence and activity.
    try {
      await client.user.setPresence({
        activities: [{
          name: "for ways to assist!",
          type: "WATCHING"
        }],
        status: "online"
      });
      logger.debug("Bot presence and activity set successfully.");
    } catch (error) {
      logger.error(`Failed to set bot presence: ${error}`);
    }

    // Reschedule the Disboard reminder based on a specific role.
    try {
      const role = await getValue("reminder_role");
      if (!role) {
        logger.warn("No role set for reminders; skipping Disboard reminder reschedule.");
      } else {
        try {
          logger.debug("Attempting to reschedule Disboard reminder.");
          // The rescheduleReminder function should handle re-creating the reminder.
          await rescheduleReminder("disboard", role, client);
          logger.debug("Disboard reminder successfully rescheduled.");
        } catch (innerError) {
          logger.error(`Failed to reschedule Disboard reminder: ${innerError}`);
        }
      }
    } catch (error) {
      logger.error(`Error during Disboard reminder rescheduling: ${error}`);
    }

    logger.info("Bot is ready!");
  }
};
