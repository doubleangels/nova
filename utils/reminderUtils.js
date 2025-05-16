const logger = require('../logger')('reminderUtils.js');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue, setReminderData, getReminderData, deleteReminderData } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');

// Database connection pool
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// Constants for bump reminder feature
const BUMP_REMINDER_KEY = 'bump';
const CONFIRMATION_EMOJI = '❤️';
const REMINDER_EMOJI = '🔔';
const CONFIRMATION_MESSAGE = "Thanks for bumping! I'll remind you again <t:%s:R>.";
const REMINDER_MESSAGE = " Time to bump the server! Use `/bump` to help us grow!";

// Constants for user reminders
const DEFAULT_REMINDER_INTERVAL = 30;
const MAX_REMINDER_LENGTH = 1000;
const MAX_REMINDER_COUNT = 5;

/**
 * Retrieves the most recent scheduled reminder from the database.
 * 
 * @async
 * @returns {Promise<Object|null>} Most recent reminder data or null if none found
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
 * Handles scheduling a new bump reminder for a server.
 * Sets up a reminder with confirmation message and scheduled notification.
 * 
 * @async
 * @param {Message} message - Discord message object that triggered the reminder
 * @param {number} delay - Time in milliseconds until the reminder should trigger
 * @returns {Promise<void>}
 */
async function handleReminder(message, delay) {
  try {
    // Retrieve reminder configuration values
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

    // Calculate scheduled time for the reminder
    const scheduledTime = dayjs().add(delay, 'millisecond');
    const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

    // Generate a unique ID for this reminder
    const reminderId = randomUUID();

    // Get the reminder channel
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

    // Send confirmation message
    await channel.send(`${CONFIRMATION_EMOJI} ${CONFIRMATION_MESSAGE.replace('%s', unixTimestamp)}`);
    logger.debug("Sent confirmation message in channel.", { channelId: reminderChannelId });

    // Clean up any existing reminders
    await pool.query(
      `DELETE FROM main.reminder_recovery WHERE remind_at > NOW()`
    );
    logger.debug("Cleaned up existing reminders.");

    // Store the new reminder in the database for recovery
    await pool.query(
      `INSERT INTO main.reminder_recovery (reminder_id, remind_at) VALUES ($1, $2)`,
      [reminderId, scheduledTime.toISOString()]
    );

    // Schedule the reminder notification
    setTimeout(async () => {
      try {
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent scheduled bump reminder ping.", {
          role: reminderRole,
          channelId: reminderChannelId
        });

        // Clean up the reminder data after sending
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
 * Reschedules existing reminders when the bot restarts.
 * Used for recovery to ensure reminders persist across bot restarts.
 * 
 * @async
 * @param {Client} client - Discord client object
 * @returns {Promise<void>}
 */
async function rescheduleReminder(client) {
  try {
    // Retrieve reminder configuration
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

    // Get the most recent reminder that needs to be rescheduled
    const reminderData = await getLatestReminderData();
    if (!reminderData) {
      logger.debug("No stored bump reminders found for rescheduling.");
      return;
    }
    
    // Get the reminder channel
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
    
    // Calculate how much time is left until the reminder should trigger
    const scheduledTime = dayjs(reminderData.remind_at);
    const now = dayjs();
    const delay = scheduledTime.diff(now, 'millisecond');
    
    logger.debug("Calculated scheduled time and delay for reminder.", { 
      scheduledTime: scheduledTime.toISOString(), 
      currentTime: now.toISOString(),
      delay 
    });
    
    // Skip overdue reminders
    if (delay < 0) {
      logger.debug("Skipping overdue reminder.", { reminder_id: reminderData.reminder_id });
      return;
    }
    
    // Schedule the reminder
    setTimeout(async () => {
      try {
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent rescheduled bump reminder.", { reminder_id: reminderData.reminder_id });

        // Clean up the reminder data after sending
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
 * Creates a new user-defined reminder.
 * 
 * @async
 * @param {string} userId - Discord user ID
 * @param {string} reminderText - Text content of the reminder
 * @param {Date|string} reminderTime - When to send the reminder
 * @param {Client} client - Discord client object
 * @returns {Promise<Object>} The created reminder object
 * @throws {Error} If reminder validation fails or database operation fails
 */
async function createReminder(userId, reminderText, reminderTime, client) {
  try {
    // Validate reminder text length
    if (reminderText.length > MAX_REMINDER_LENGTH) {
      throw new Error(`Reminder text must be ${MAX_REMINDER_LENGTH} characters or less.`);
    }

    // Check user's reminder count against the maximum allowed
    const userReminders = await getUserReminders(userId);
    if (userReminders.length >= MAX_REMINDER_COUNT) {
      throw new Error(`You can only have ${MAX_REMINDER_COUNT} active reminders at a time.`);
    }

    // Add the reminder to the database
    const reminder = await addReminder(userId, reminderText, reminderTime);
    
    // Schedule notification for the reminder
    scheduleReminderNotification(reminder, client);
    
    return reminder;
  } catch (error) {
    logger.error(`Error creating reminder for user ${userId}: ${error.message}`);
    throw error;
  }
}

/**
 * Schedules a notification for a user reminder.
 * Sets up a timeout to send a DM to the user when the reminder is due.
 * 
 * @param {Object} reminder - Reminder object with id, user_id, reminder_text, and reminder_time
 * @param {Client} client - Discord client object
 * @returns {void}
 */
function scheduleReminderNotification(reminder, client) {
  const now = new Date();
  const reminderTime = new Date(reminder.reminder_time);
  const delay = reminderTime.getTime() - now.getTime();

  if (delay > 0) {
    setTimeout(async () => {
      try {
        // Verify reminder still exists in database
        const existingReminder = await getReminder(reminder.id);
        if (!existingReminder) {
          logger.debug(`Reminder ${reminder.id} no longer exists, skipping notification.`);
          return;
        }

        // Send DM to user
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
 * Retrieves all reminders for a specific user.
 * 
 * @async
 * @param {string} userId - Discord user ID
 * @returns {Promise<Array>} List of the user's reminders with formatted data
 * @throws {Error} If database operation fails
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
 * Deletes a specific reminder.
 * Validates ownership before deletion.
 * 
 * @async
 * @param {string} reminderId - ID of the reminder to delete
 * @param {string} userId - Discord user ID requesting deletion
 * @returns {Promise<boolean>} True if deletion was successful
 * @throws {Error} If reminder doesn't exist, user doesn't own the reminder, or database operation fails
 */
async function deleteReminder(reminderId, userId) {
  try {
    // Verify reminder exists
    const reminder = await getReminder(reminderId);
    if (!reminder) {
      throw new Error('Reminder not found.');
    }

    // Verify user owns the reminder
    if (reminder.user_id !== userId) {
      throw new Error('You can only delete your own reminders.');
    }

    // Delete the reminder
    await removeReminder(reminderId);
    return true;
  } catch (error) {
    logger.error(`Error deleting reminder ${reminderId}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createReminder,
  getUserReminders,
  deleteReminder,
  scheduleReminderNotification,
  handleReminder,
  rescheduleReminder
}; 