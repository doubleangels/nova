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
 * Performs a setup task with proper error handling and logging
 * 
 * @param {string} taskName - Name of the task for logging
 * @param {Function} task - Async function to execute
 * @param {string} startMessage - Message to log before starting
 * @param {string} successMessage - Message to log on success
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
    
    // Track setup tasks for summary report
    const setupResults = {
      presence: false,
      commands: false,
      reminders: false,
      muteKicks: false
    };

    // Set bot presence
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

    // Deploy slash commands if enabled
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

    // Reschedule reminders if enabled
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

    // Reschedule mute kicks if enabled
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

    // Log setup completion with status summary
    const successCount = Object.values(setupResults).filter(Boolean).length;
    const totalTasks = Object.keys(setupResults).length;
    
    if (successCount === totalTasks) {
      logger.info("Bot is ready and all setup tasks completed successfully!");
    } else {
      logger.warn(`Bot is ready but only ${successCount}/${totalTasks} setup tasks completed successfully.`, { setupResults });
    }
  }
};