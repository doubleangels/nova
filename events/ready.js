const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const Sentry = require('../sentry');

// We import the deploy-commands module to register slash commands with Discord.
const deployCommands = require('../deploy-commands');

// We configure the bot's activity and status for a consistent presence.
const BOT_ACTIVITY = {
  name: "for ways to assist! ❤️",
  type: ActivityType.Watching
};
const BOT_STATUS = "online";

/**
 * Performs a setup task with proper error handling and logging.
 * We use this helper function to standardize our setup process and error handling.
 * 
 * @param {string} taskName - Name of the task for logging.
 * @param {Function} task - Async function to execute.
 * @param {string} startMessage - Message to log before starting.
 * @param {string} successMessage - Message to log on success.
 * @returns {Promise<boolean>} Whether the task completed successfully.
 */
async function performSetupTask(taskName, task, startMessage, successMessage) {
  try {
    logger.debug(startMessage);
    await task();
    logger.info(successMessage);
    return true;
  } catch (error) {
    // We track errors with Sentry for better monitoring and troubleshooting.
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
 * Event handler for the 'ready' event.
 * We execute this once when the bot comes online to initialize all necessary systems.
 * This sets the bot's presence, deploys slash commands, and reschedules any pending
 * reminders and mute kicks from previous sessions.
 *
 * @param {Client} client - The Discord client instance.
 */
module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    try {
      logger.info("Bot is online! Initializing setup procedures...");
      
      // We track setup tasks for a summary report to ensure everything initialized properly.
      const setupResults = {
        presence: false,
        commands: false,
        reminders: false,
        muteKicks: false
      };

      // We set the bot's presence to indicate its status to users.
      setupResults.presence = await performSetupTask(
        "set bot presence",
        async () => {
          await client.user.setPresence({
            activities: [{
              name: BOT_ACTIVITY.name,
              type: BOT_ACTIVITY.type
            }],
            status: BOT_STATUS
          });
        },
        "Setting bot presence and activity...",
        `Bot presence and activity set: ${BOT_ACTIVITY.type} ${BOT_ACTIVITY.name}, status: ${BOT_STATUS}`
      );

      // We deploy slash commands if enabled in the configuration.
      if (config.settings.deployCommandsOnStart) {
        setupResults.commands = await performSetupTask(
          "deploy slash commands",
          async () => await deployCommands(),
          "Attempting to deploy all slash commands to Discord API...",
          "Slash command deployment completed successfully."
        );
      } else {
        logger.debug("Slash command deployment skipped (disabled in config).");
      }

      // We reschedule Disboard reminders if enabled to maintain bump schedules across restarts.
      if (config.settings.rescheduleReminderOnStart) {
        setupResults.reminders = await performSetupTask(
          "reschedule bump reminders",
          async () => await rescheduleReminder(client),
          "Attempting to reschedule all bump reminders from the database...",
          "Bump reminder rescheduling completed successfully."
        );
      } else {
        logger.debug("Bump reminder rescheduling skipped (disabled in config).");
      }

      // We reschedule mute kicks if enabled to maintain moderation actions across restarts.
      if (config.settings.rescheduleAllMuteKicksOnStart) {
        setupResults.muteKicks = await performSetupTask(
          "reschedule mute kicks",
          async () => await rescheduleAllMuteKicks(client),
          "Attempting to reschedule all mute kicks for tracked members...",
          "Mute kick rescheduling completed successfully."
        );
      } else {
        logger.debug("Mute kick rescheduling skipped (disabled in config).");
      }

      // We log the setup completion status to provide a clear summary of initialization.
      const successCount = Object.values(setupResults).filter(Boolean).length;
      const totalTasks = Object.keys(setupResults).length;
      
      if (successCount === totalTasks) {
        logger.info("Bot is ready and all setup tasks completed successfully!");
      } else {
        logger.warn(`Bot is ready but only ${successCount}/${totalTasks} setup tasks completed successfully.`, { setupResults });
      }
    } catch (error) {
      // We capture any unexpected errors in the main execute function with Sentry.
      Sentry.captureException(error, {
        extra: {
          event: 'ready',
          clientId: client?.user?.id || 'unknown'
        }
      });
      logger.error("Error in ready event handler:", { error });
    }
  }
};