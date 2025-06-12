/**
 * Reminder utilities module for handling server bump reminders.
 * Manages reminder scheduling, persistence, and notifications.
 * @module utils/reminderUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { EmbedBuilder } = require('discord.js');

const REMINDER_POOL = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

/**
 * Retrieves the latest reminder data from the database.
 * @async
 * @function getLatestReminderData
 * @param {string} type - The type of reminder to retrieve ('bump' or 'promote')
 * @returns {Promise<Object|null>} The latest reminder data or null if none found
 * @throws {Error} If database query fails
 */
async function getLatestReminderData(type) {
  try {
    const result = await REMINDER_POOL.query(
      `SELECT reminder_id, remind_at, type FROM main.reminder_recovery 
       WHERE remind_at > NOW() AND type = $1
       ORDER BY remind_at ASC 
       LIMIT 1`,
      [type]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    logger.error("Error getting latest reminder data:", { error: err });
    return null;
  }
}

/**
 * Handles the creation and scheduling of a new reminder.
 * @async
 * @function handleReminder
 * @param {Message} message - The message that triggered the reminder
 * @param {number} delay - The delay in milliseconds before the reminder
 * @param {string} type - The type of reminder ('bump' or 'promote')
 * @throws {Error} If reminder creation fails
 */
async function handleReminder(message, delay, type = 'bump') {
  try {
    const reminderRole = await getValue('reminder_role');
    if (!reminderRole) {
      logger.error("Configuration error: 'reminder_role' value not found.");
      return;
    }

    const reminderChannelId = await getValue('reminder_channel');
    if (!reminderChannelId) {
      logger.error("Configuration error: 'reminder_channel' value not found.");
      return;
    }

    const scheduledTime = dayjs().add(delay, 'millisecond');
    const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

    const reminderId = randomUUID();

    let channel;
    try {
      channel = message.client.channels.cache.get(reminderChannelId);
      if (!channel) {
        channel = await message.client.channels.fetch(reminderChannelId);
      }
    } catch (channelError) {
      logger.error("Failed to fetch channel:", {
        channelId: reminderChannelId,
        error: channelError.message
      });
      return;
    }

    await REMINDER_POOL.query(
      `DELETE FROM main.reminder_recovery WHERE remind_at > NOW() AND type = $1`,
      [type]
    );
    logger.debug("Cleaned up existing reminders of type:", type);

    await REMINDER_POOL.query(
      `INSERT INTO main.reminder_recovery (reminder_id, remind_at, type) VALUES ($1, $2, $3)`,
      [reminderId, scheduledTime.toISOString(), type]
    );

    // Send confirmation message
    const confirmationMessage = type === 'promote'
      ? `🎯 Server promoted successfully! I'll remind you to promote again <t:${unixTimestamp}:R>.`
      : `Thanks for bumping! I'll remind you again <t:${unixTimestamp}:R>.`;
    
    await channel.send(`❤️ ${confirmationMessage}`);
    logger.debug("Sent confirmation message:", { type, unixTimestamp });

    setTimeout(async () => {
      try {
        const reminderMessage = type === 'promote' 
          ? `🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote post\` to post on Reddit!`
          : `🔔 <@&${reminderRole}> Time to bump the server! Use \`/bump\` to help us grow!`;

        await channel.send(reminderMessage);
        logger.debug("Sent scheduled reminder ping:", {
          role: reminderRole,
          channelId: reminderChannelId,
          type
        });

        await REMINDER_POOL.query(
          `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
          [reminderId]
        );
        logger.debug("Cleaned up sent reminder from recovery table:", { reminderId });
      } catch (err) {
        logger.error("Error while sending scheduled reminder:", {
          error: err.message,
          stack: err.stack,
          type
        });
      }
    }, delay);

  } catch (error) {
    handleError(error, 'handleReminder');
  }
}

/**
 * Reschedules any existing reminders on bot startup.
 * @async
 * @function rescheduleReminder
 * @param {Client} client - The Discord client instance
 * @throws {Error} If rescheduling fails
 */
async function rescheduleReminder(client) {
  try {
    const reminderChannelId = await getValue("reminder_channel");
    const reminderRole = await getValue("reminder_role");
    
    if (!reminderChannelId) {
      logger.error("Configuration error: Missing reminder channel value.");
      return;
    }
    
    if (!reminderRole) {
      logger.error("Configuration error: Missing reminder role value.");
      return;
    }

    // Get both bump and promotion reminders
    const [bumpReminder, promoteReminder] = await Promise.all([
      getLatestReminderData('bump'),
      getLatestReminderData('promote')
    ]);

    if (!bumpReminder && !promoteReminder) {
      logger.debug("No stored reminders found for rescheduling.");
      return;
    }
    
    let channel;
    try {
      channel = client.channels.cache.get(reminderChannelId);
      if (!channel) {
        channel = await client.channels.fetch(reminderChannelId);
      }
    } catch (channelError) {
      logger.error("Failed to fetch channel for rescheduled reminder:", {
        channelId: reminderChannelId,
        error: channelError.message
      });
      return;
    }

    // Reschedule bump reminder if exists
    if (bumpReminder) {
      const scheduledTime = dayjs(bumpReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to bump the server! Use \`/bump\` to help us grow!`);
            logger.debug("Sent rescheduled bump reminder:", { reminder_id: bumpReminder.reminder_id });

            await REMINDER_POOL.query(
              `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
              [bumpReminder.reminder_id]
            );
          } catch (err) {
            logger.error("Error while sending rescheduled bump reminder:", {
              error: err.message,
              stack: err.stack
            });
          }
        }, delay);
        
        logger.debug("Successfully rescheduled bump reminder:", {
          reminder_id: bumpReminder.reminder_id,
          delayMs: delay,
          scheduledFor: new Date(Date.now() + delay).toISOString()
        });
      }
    }

    // Reschedule promotion reminder if exists
    if (promoteReminder) {
      const scheduledTime = dayjs(promoteReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote post\` to post on Reddit!`);
            logger.debug("Sent rescheduled promotion reminder:", { reminder_id: promoteReminder.reminder_id });

            await REMINDER_POOL.query(
              `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
              [promoteReminder.reminder_id]
            );
          } catch (err) {
            logger.error("Error while sending rescheduled promotion reminder:", {
              error: err.message,
              stack: err.stack
            });
          }
        }, delay);
        
        logger.debug("Successfully rescheduled promotion reminder:", {
          reminder_id: promoteReminder.reminder_id,
          delayMs: delay,
          scheduledFor: new Date(Date.now() + delay).toISOString()
        });
      }
    }
  } catch (error) {
    handleError(error, 'rescheduleReminder');
  }
}

async function handleError(error, context) {
  logger.error(`Error in ${context}:`, {
    error: error.message,
    stack: error.stack
  });

  if (error.message === "DATABASE_ERROR") {
    throw new Error("⚠️ Database error occurred while processing reminder.");
  } else if (error.message === "REMINDER_CREATION_FAILED") {
    throw new Error("⚠️ Failed to create reminder.");
  } else if (error.message === "REMINDER_DELETION_FAILED") {
    throw new Error("⚠️ Failed to delete reminder.");
  } else if (error.message === "REMINDER_UPDATE_FAILED") {
    throw new Error("⚠️ Failed to update reminder.");
  } else if (error.message === "INVALID_TIME") {
    throw new Error("⚠️ Invalid time format provided.");
  } else if (error.message === "INVALID_DATE") {
    throw new Error("⚠️ Invalid date format provided.");
  } else if (error.message === "PAST_DATE") {
    throw new Error("⚠️ Cannot set reminder for past date.");
  } else if (error.message === "INVALID_INTERVAL") {
    throw new Error("⚠️ Invalid interval provided.");
  } else {
    throw new Error("⚠️ An unexpected error occurred while processing reminder.");
  }
}

module.exports = {
  handleReminder,
  rescheduleReminder
};