const logger = require('../logger')('reminderUtils.js');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { logError, ERROR_MESSAGES } = require('../errors');

// We set up a pool for direct SQL queries for reminder_recovery.
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// We define these configuration constants for consistent reminder behavior across the application.
const CONFIRMATION_EMOJI = '❤️';
const REMINDER_EMOJI = '🔔';
const CONFIRMATION_MESSAGE = "Thanks for bumping! I'll remind you again <t:%s:R>.";
const REMINDER_MESSAGE = " Time to bump the server! Use `/bump` to help us grow!";

/**
 * Gets the latest reminder data
 * @returns {Promise<Object|null>} The reminder data if found, otherwise null.
 */
async function getLatestReminderData() {
  try {
    const result = await pool.query(
      `SELECT reminder_id, remind_at FROM main.reminder_recovery 
       WHERE remind_at > NOW() 
       ORDER BY remind_at ASC 
       LIMIT 1`
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    logger.error("Error getting latest reminder data:", { error: err });
    return null;
  }
}

/**
 * Schedules a bump reminder and stores it in the database.
 *
 * We retrieve necessary configuration values (role and channel IDs) from the database,
 * calculate a scheduled time using day.js based on the provided delay, store the reminder data,
 * and send an immediate confirmation message in the designated channel. We then schedule
 * a final reminder message to be sent after the delay.
 *
 * @param {Message} message - The Discord message object from which to access the client.
 * @param {number} delay - The delay in milliseconds before sending the final bump reminder.
 */
async function handleReminder(message, delay) {
  try {
    // We retrieve the role ID for pinging on the final reminder.
    const reminderRole = await getValue('reminder_role');
    if (!reminderRole) {
      logger.error("Configuration error: 'reminder_role' value not found.");
      return;
    }

    // We retrieve the channel ID where reminders should be sent.
    const reminderChannelId = await getValue('reminder_channel');
    if (!reminderChannelId) {
      logger.error("Configuration error: 'reminder_channel' value not found.");
      return;
    }

    const scheduledTime = dayjs().add(delay, 'millisecond');
    const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

    // We generate a unique identifier for the reminder to track it in the database.
    const reminderId = randomUUID();

    // We attempt to retrieve the channel object using the cached channels or by fetching it.
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

    // We send an immediate confirmation message in the designated channel to acknowledge the bump.
    await channel.send(`${CONFIRMATION_EMOJI} ${CONFIRMATION_MESSAGE.replace('%s', unixTimestamp)}`);
    logger.debug("Sent confirmation message in channel:", { channelId: reminderChannelId });

    // Delete any existing reminders before adding the new one
    await pool.query(
      `DELETE FROM main.reminder_recovery WHERE remind_at > NOW()`
    );
    logger.debug("Cleaned up existing reminders.");

    // Store only reminder_id and remind_at
    await pool.query(
      `INSERT INTO main.reminder_recovery (reminder_id, remind_at) VALUES ($1, $2)`,
      [reminderId, scheduledTime.toISOString()]
    );

    // We schedule the final reminder message after the specified delay.
    setTimeout(async () => {
      try {
        // Send the new bump reminder
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent scheduled bump reminder ping:", {
          role: reminderRole,
          channelId: reminderChannelId
        });

        // We delete the reminder from the recovery table after it's sent.
        await pool.query(
          `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
          [reminderId]
        );
        logger.debug("Cleaned up sent reminder from recovery table:", { reminderId });
      } catch (err) {
        logger.error("Error while sending scheduled bump reminder:", {
          error: err.message,
          stack: err.stack
        });
      }
    }, delay);

  } catch (error) {
    logError('Failed to handle reminder', error);
    throw new Error(ERROR_MESSAGES.REMINDER_CREATION_FAILED);
  }
}

/**
 * Reschedules stored bump reminders after a potential downtime or restart.
 *
 * We retrieve the stored reminder from the reminder_recovery table.
 * We then check the reminder's scheduled time using day.js and calculate the delay until it should be sent.
 * If the scheduled time has already passed, we skip rescheduling.
 * Otherwise, we set up a timeout to send the reminder message at the appropriate time.
 *
 * @param {Client} client - The Discord client instance used to fetch channels.
 */
async function rescheduleReminder(client) {
  try {
    // We retrieve the configuration values for the channel and role.
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

    // Get the latest reminder data for this channel.
    const reminderData = await getLatestReminderData();
    if (!reminderData) {
      logger.debug("No stored bump reminders found for rescheduling.");
      return;
    }
    
    // We retrieve the channel object from cache or by fetching from Discord.
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
    
    const scheduledTime = dayjs(reminderData.remind_at);
    const now = dayjs();
    const delay = scheduledTime.diff(now, 'millisecond');
    
    logger.debug("Calculated scheduled time and delay for reminder:", {
      scheduledTime: scheduledTime.toISOString(),
      currentTime: now.toISOString(),
      delay
    });
    
    // If the scheduled time has passed, we skip rescheduling.
    if (delay < 0) {
      logger.debug("Skipping overdue reminder:", { reminder_id: reminderData.reminder_id });
      return;
    }
    
    // We reschedule the reminder to send the bump message after the computed delay.
    setTimeout(async () => {
      try {
        // Send the new reminder message
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent rescheduled bump reminder:", { reminder_id: reminderData.reminder_id });

        // We delete the reminder from the recovery table after it's sent.
        await pool.query(
          `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
          [reminderData.reminder_id]
        );
        logger.debug("Cleaned up sent reminder from recovery table:", { reminderId: reminderData.reminder_id });
      } catch (err) {
        logger.error("Error while sending rescheduled bump reminder:", {
          error: err.message,
          stack: err.stack
        });
      }
    }, delay);
    
    logger.debug("Successfully rescheduled bump reminder:", {
      reminder_id: reminderData.reminder_id,
      delayMs: delay,
      scheduledFor: new Date(Date.now() + delay).toISOString()
    });
  } catch (error) {
    logError('Failed to reschedule reminder', error);
    throw new Error(ERROR_MESSAGES.REMINDER_RESCEDULE_FAILED);
  }
}

/**
 * We export the reminder utility functions for use throughout the application.
 * This module provides consistent reminder management capabilities.
 */
module.exports = {
  handleReminder,
  rescheduleReminder
};
