const { ActivityType, Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { rescheduleReminder } = require('../utils/reminderUtils');
const { rescheduleAllMuteKicks } = require('../utils/muteModeUtils');
const { initializeDatabase, cleanupOldTrackingUsers, setInviteUsage } = require('../utils/database');

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
   * 3. Reschedules mute kicks and reminders
   * 
   * @param {Client} client - The Discord client instance
   * @throws {Error} If there's an error during initialization
   * @returns {Promise<void>}
   */
  async execute(client) {
    try {
      await initializeDatabase();
      logger.info('Database connection initialized successfully.');

      // Get bot status from environment variables
      let botActivity = DEFAULT_BOT_ACTIVITY;
      const botStatus = config.botStatus;
      const botStatusType = config.botStatusType || 'watching';
      
      if (botStatus) {
        const statusName = String(botStatus);
        
        // Map activity type string to ActivityType enum (case-insensitive)
        const activityTypeMap = {
          'playing': ActivityType.Playing,
          'streaming': ActivityType.Streaming,
          'listening': ActivityType.Listening,
          'watching': ActivityType.Watching,
          'competing': ActivityType.Competing,
          'custom': ActivityType.Custom
        };
        
        const typeKey = botStatusType.toLowerCase().trim();
        const activityType = activityTypeMap[typeKey] || ActivityType.Watching;
        botActivity = {
          name: statusName,
          type: activityType
        };
        logger.info('Loaded bot status from environment.', {
          statusName: statusName,
          statusType: botStatusType
        });
      } else {
        logger.info('No BOT_STATUS environment variable set, using default.');
      }

      logger.debug('Setting bot activity.', {
        activity: JSON.stringify(botActivity)
      });
      client.user.setActivity(botActivity.name, { type: botActivity.type });
      logger.info('Bot is ready and logged in.', {
        botTag: client.user.tag
      });

      // Parallelize independent initialization tasks
      await Promise.all([
        rescheduleAllMuteKicks(client),
        rescheduleReminder(client)
      ]);
      logger.info('Mute kicks and reminders rescheduled successfully.');

      // Run cleanup on startup
      try {
        await cleanupOldTrackingUsers(client);
        logger.info('Initial cleanup of old tracking users completed.');
      } catch (error) {
        logger.error('Failed to run initial cleanup.', {
          err: error
        });
      }

      // Schedule periodic cleanup every hour
      const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
      setInterval(async () => {
        try {
          await cleanupOldTrackingUsers(client);
        } catch (error) {
          logger.error('Error occurred during scheduled cleanup.', {
            err: error
          });
        }
      }, CLEANUP_INTERVAL_MS);
      logger.info('Scheduled periodic cleanup task.', {
        intervalMinutes: CLEANUP_INTERVAL_MS / 1000 / 60
      });

      // Initialize invite usage tracking for the guild
      try {
        await initializeInviteUsage(client);
        logger.info('Invite usage tracking initialized for the guild.');
      } catch (error) {
        logger.error('Failed to initialize invite usage tracking.', {
          err: error
        });
      }

      logger.info('Bot is ready and all systems are initialized.');
    } catch (error) {
      logger.error('Error occurred in ready event.', {
        err: error,
        clientId: client.user?.id,
        clientTag: client.user?.tag
      });

      let errorMessage = "⚠️ An unexpected error occurred during bot initialization.";
      
      if (error.message === "⚠️ Failed to initialize database connection.") {
        errorMessage = "⚠️ Failed to initialize database connection.";
      } else if (error.message === "⚠️ Failed to reschedule mute kicks.") {
        errorMessage = "⚠️ Failed to reschedule mute kicks.";
      } else if (error.message === "⚠️ Failed to reschedule reminders.") {
        errorMessage = "⚠️ Failed to reschedule reminders.";
      } else if (error.message === "⚠️ Failed to set bot activity.") {
        errorMessage = "⚠️ Failed to set bot activity.";
      } else if (error.message === "⚠️ Failed to set bot status.") {
        errorMessage = "⚠️ Failed to set bot status.";
      } else if (error.message === "⚠️ Failed to load voice join times.") {
        errorMessage = "⚠️ Failed to load voice join times.";
      } else if (error.message === "⚠️ Insufficient permissions for bot initialization.") {
        errorMessage = "⚠️ Insufficient permissions for bot initialization.";
      }
      
      throw new Error(errorMessage);
    }
  }
};

/**
 * Initializes invite usage tracking for the guild
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
 */
async function initializeInviteUsage(client) {
  // Bot is only in one guild, so get it directly
  const guild = client.guilds.cache.first();
  if (!guild) {
    logger.warn('No guild found for invite usage initialization.');
    return;
  }

  try {
    // Check if bot has permission to view invites
    if (!guild.members.me?.permissions.has('ManageGuild')) {
      logger.debug('Bot does not have ManageGuild permission, skipping invite usage initialization.', {
        guildName: guild.name
      });
      return;
    }

    const invites = await guild.invites.fetch().catch(() => null);
    if (invites) {
      const usage = {};
      invites.each(invite => {
        usage[invite.code] = invite.uses || 0;
      });
      await setInviteUsage(guild.id, usage);
      logger.debug('Initialized invite usage tracking for guild.', {
        guildName: guild.name,
        guildId: guild.id
      });
    }
  } catch (error) {
    logger.warn('Failed to initialize invite usage for guild.', {
      err: error,
      guildName: guild.name
    });
  }
}