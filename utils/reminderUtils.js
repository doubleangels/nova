const logger = require('../logger')('reminderUtils.js');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue, setReminderData, getReminderData, deleteReminderData } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');

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

// We define these configuration constants for consistent reminder behavior.
const MAX_REMINDER_LENGTH = 1000;
const MAX_REMINDER_COUNT = 5;

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
      logger.error("Failed to fetch channel.", { 
        channelId: reminderChannelId,
        error: channelError.message 
      });
      return;
    }

    // We send an immediate confirmation message in the designated channel to acknowledge the bump.
    await channel.send(`${CONFIRMATION_EMOJI} ${CONFIRMATION_MESSAGE.replace('%s', unixTimestamp)}`);
    logger.debug("Sent confirmation message in channel.", { channelId: reminderChannelId });

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
        logger.debug("Sent scheduled bump reminder ping.", {
          role: reminderRole,
          channelId: reminderChannelId
        });

        // We delete the reminder from the recovery table after it's sent.
        await pool.query(
          `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
          [reminderId]
        );
        logger.debug("Cleaned up sent reminder from recovery table.", { reminderId });
      } catch (err) {
        logger.error("Error while sending scheduled bump reminder.", { 
          error: err.message,
          stack: err.stack
        });
      }
    }, delay);

  } catch (error) {
    logger.error("Unhandled error in handleReminder.", { 
      error: error.message,
      stack: error.stack
    });
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
      logger.error("Failed to fetch channel for rescheduled reminder.", { 
        channelId: reminderChannelId,
        error: channelError.message 
      });
      return;
    }
    
    const scheduledTime = dayjs(reminderData.remind_at);
    const now = dayjs();
    const delay = scheduledTime.diff(now, 'millisecond');
    
    logger.debug("Calculated scheduled time and delay for reminder.", { 
      scheduledTime: scheduledTime.toISOString(), 
      currentTime: now.toISOString(),
      delay 
    });
    
    // If the scheduled time has passed, we skip rescheduling.
    if (delay < 0) {
      logger.debug("Skipping overdue reminder.", { reminder_id: reminderData.reminder_id });
      return;
    }
    
    // We reschedule the reminder to send the bump message after the computed delay.
    setTimeout(async () => {
      try {
        // Send the new reminder message
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent rescheduled bump reminder.", { reminder_id: reminderData.reminder_id });

        // We delete the reminder from the recovery table after it's sent.
        await pool.query(
          `DELETE FROM main.reminder_recovery WHERE reminder_id = $1`,
          [reminderData.reminder_id]
        );
        logger.debug("Cleaned up sent reminder from recovery table.", { reminderId: reminderData.reminder_id });
      } catch (err) {
        logger.error("Error while sending rescheduled bump reminder.", { 
          error: err.message,
          stack: err.stack
        });
      }
    }, delay);
    
    logger.debug("Successfully rescheduled bump reminder.", {
      reminder_id: reminderData.reminder_id,
      delayMs: delay,
      scheduledFor: new Date(Date.now() + delay).toISOString()
    });
  } catch (error) {
    logger.error("Unhandled error in rescheduleReminder.", { 
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * We create a new reminder for a user.
 * This function handles the creation and scheduling of user reminders.
 *
 * We validate the reminder text and user ID before creating the reminder.
 * We ensure the reminder text is not too long and the user hasn't exceeded their reminder limit.
 * We store the reminder in the database and schedule it for the specified time.
 *
 * @param {string} userId - The ID of the user creating the reminder.
 * @param {string} reminderText - The text content of the reminder.
 * @param {Date} reminderTime - When the reminder should be triggered.
 * @param {Client} client - The Discord client instance.
 * @returns {Promise<Object>} The created reminder object.
 * @throws {Error} If the reminder cannot be created.
 */
async function createReminder(userId, reminderText, reminderTime, client) {
  try {
    // We validate the reminder text length.
    if (reminderText.length > MAX_REMINDER_LENGTH) {
      throw new Error(`Reminder text must be ${MAX_REMINDER_LENGTH} characters or less.`);
    }

    // We check if the user has reached their reminder limit.
    const userReminders = await getUserReminders(userId);
    if (userReminders.length >= MAX_REMINDER_COUNT) {
      throw new Error(`You can only have ${MAX_REMINDER_COUNT} active reminders at a time.`);
    }

    // We create the reminder in the database.
    const reminder = await addReminder(userId, reminderText, reminderTime);
    
    // We schedule the reminder notification.
    scheduleReminderNotification(reminder, client);
    
    return reminder;
  } catch (error) {
    logger.error(`Error creating reminder for user ${userId}: ${error.message}`);
    throw error;
  }
}

/**
 * We schedule a reminder notification to be sent at the specified time.
 * This function handles the timing and delivery of reminder notifications.
 *
 * We calculate the delay until the reminder time and set a timeout to send the notification.
 * We ensure the reminder is still valid before sending the notification.
 *
 * @param {Object} reminder - The reminder object to schedule.
 * @param {Client} client - The Discord client instance.
 */
function scheduleReminderNotification(reminder, client) {
  const now = new Date();
  const reminderTime = new Date(reminder.reminder_time);
  const delay = reminderTime.getTime() - now.getTime();

  // We only schedule if the reminder time is in the future.
  if (delay > 0) {
    setTimeout(async () => {
      try {
        // We verify the reminder still exists before sending.
        const existingReminder = await getReminder(reminder.id);
        if (!existingReminder) {
          logger.debug(`Reminder ${reminder.id} no longer exists, skipping notification.`);
          return;
        }

        // We send the reminder notification.
        const user = await client.users.fetch(reminder.user_id);
        if (user) {
          const embed = new EmbedBuilder()
            .setColor(0xCD41FF)
            .setTitle('Reminder')
            .setDescription(reminder.reminder_text)
            .setTimestamp(reminderTime);
          
          await user.send({ embeds: [embed] });
          await deleteReminder(reminder.id);
        }
      } catch (error) {
        logger.error(`Error sending reminder notification for reminder ${reminder.id}: ${error.message}`);
      }
    }, delay);
  }
}

/**
 * We get all active reminders for a user.
 * This function retrieves and formats the user's reminders for display.
 *
 * We fetch the reminders from the database and format them for easy reading.
 * We include the reminder text, time, and ID in the formatted output.
 *
 * @param {string} userId - The ID of the user to get reminders for.
 * @returns {Promise<Array>} Array of formatted reminder objects.
 */
async function getUserReminders(userId) {
  try {
    const reminders = await getRemindersByUser(userId);
    return reminders.map(reminder => ({
      id: reminder.id,
      text: reminder.reminder_text,
      time: new Date(reminder.reminder_time),
      formattedTime: new Date(reminder.reminder_time).toLocaleString()
    }));
  } catch (error) {
    logger.error(`Error getting reminders for user ${userId}: ${error.message}`);
    throw error;
  }
}

/**
 * We delete a reminder by its ID.
 * This function handles the removal of reminders from the system.
 *
 * We verify the reminder exists and belongs to the user before deleting.
 * We remove the reminder from the database and cancel any pending notifications.
 *
 * @param {string} reminderId - The ID of the reminder to delete.
 * @param {string} userId - The ID of the user requesting the deletion.
 * @returns {Promise<boolean>} Whether the reminder was successfully deleted.
 */
async function deleteReminder(reminderId, userId) {
  try {
    const reminder = await getReminder(reminderId);
    if (!reminder) {
      throw new Error('Reminder not found.');
    }

    if (reminder.user_id !== userId) {
      throw new Error('You can only delete your own reminders.');
    }

    await removeReminder(reminderId);
    return true;
  } catch (error) {
    logger.error(`Error deleting reminder ${reminderId}: ${error.message}`);
    throw error;
  }
}

/**
 * We export the reminder utility functions for use throughout the application.
 * This module provides consistent reminder management capabilities.
 */
module.exports = {
  createReminder,
  getUserReminders,
  deleteReminder,
  scheduleReminderNotification,
  handleReminder,
  rescheduleReminder
};
