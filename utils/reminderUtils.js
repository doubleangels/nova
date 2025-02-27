const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getReminderData, deleteReminderData, setReminderData, getValue } = require('../utils/supabase');

/**
 * Calculates the remaining time until the scheduled time.
 *
 * @param {string} scheduledTime - The ISO string representing the scheduled time.
 * @returns {string} A formatted string "HH:MM:SS" representing the remaining time, "⏰ Expired!" if the time is past,
 *                   "Not set!" if scheduledTime is falsy, or an error message if an error occurs.
 */
function calculateRemainingTime(scheduledTime) {
  if (!scheduledTime) return 'Not set!';
  try {
    const now = new Date();
    const scheduled = new Date(scheduledTime);
    const diffMs = scheduled - now; // Difference in milliseconds.
    if (diffMs <= 0) return '⏰ Expired!';
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    // Format each time component to have at least two digits.
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } catch (error) {
    logger.error('Error calculating remaining time:', { error });
    return '⚠️ Error calculating time!';
  }
}

/**
 * Sends a scheduled message to a reminder channel.
 *
 * This function sends an initial message (if provided), waits for a specified interval,
 * sends a reminder message, and then cleans up the reminder data.
 *
 * @param {Object} options - An object containing the following properties:
 *   @property {string|null} initialMessage - The message to send immediately (if any).
 *   @property {string} reminderMessage - The message to send after the interval.
 *   @property {number} interval - The delay (in seconds) before sending the reminder.
 *   @property {string} key - The reminder key used for tracking.
 *   @property {Client} client - The Discord client instance.
 */
async function sendScheduledMessage({ initialMessage, reminderMessage, interval, key, client }) {
  try {
    logger.debug(`sendScheduledMessage for key "${key}" invoked. Interval: ${interval} sec; Initial message: ${initialMessage}; Reminder message: ${reminderMessage}`);
    
    // Retrieve the reminder channel ID.
    const channelId = await getValue('reminder_channel');
    if (!channelId) {
      logger.warn("No valid reminder channel found; aborting scheduled message.");
      return;
    }
    
    // Get the channel from the client.
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      logger.warn(`Channel with ID "${channelId}" not found.`);
      return;
    }
    
    // Send the initial message if provided.
    if (initialMessage) {
      logger.debug(`Sending initial message: ${initialMessage}`);
      await channel.send(initialMessage);
    }
    
    logger.debug(`Waiting ${interval} seconds before sending reminder.`);
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    
    logger.debug(`Sending reminder: ${reminderMessage}`);
    await channel.send(reminderMessage);
    
    // Clean up reminder data.
    const reminderData = await getReminderData(key);
    if (reminderData) {
      await deleteReminderData(key);
      logger.debug(`Cleaned up reminder data (ID: ${reminderData.reminder_id}).`);
    } else {
      logger.debug(`No reminder data found to clean up for key "${key}".`);
    }
  } catch (e) {
    logger.error(`Error in sendScheduledMessage:`, { error: e });
  }
}

/**
 * Handles setting up a reminder.
 *
 * If no reminder is scheduled for the given key, creates a new reminder entry
 * in the database with a scheduled time calculated from the interval and sends a scheduled message.
 *
 * @param {string} key - The key for the reminder (e.g., "disboard").
 * @param {string|null} initialMessage - The message to send immediately, if any.
 * @param {string} reminderMessage - The reminder message to send after the interval.
 * @param {number} interval - The interval in seconds before the reminder is sent.
 * @param {Client} client - The Discord client instance.
 */
async function handleReminder(key, initialMessage, reminderMessage, interval, client) {
  try {
    logger.debug(`handleReminder invoked with interval: ${interval} seconds.`);
    
    const existingData = await getReminderData(key);
    if (existingData && existingData.scheduled_time) {
      logger.debug(`Reminder already exists (ID: ${existingData.reminder_id}). Skipping setup.`);
      return;
    }
    
    const { randomUUID } = require('crypto');
    const reminderId = randomUUID();
    const scheduledTime = new Date(Date.now() + interval * 1000).toISOString();
    
    // Save reminder data.
    await setReminderData(key, scheduledTime, reminderId);
    logger.debug(`Reminder data saved: ID "${reminderId}", scheduled at "${scheduledTime}".`);
    
    // Retrieve role for mention.
    const role = await getValue("reminder_role");
    if (role) {
      logger.debug(`Role "${role}" retrieved; scheduling sendScheduledMessage.`);
      await sendScheduledMessage({
        initialMessage,
        reminderMessage: `🔔 <@&${role}> ${reminderMessage}`,
        interval,
        key,
        client
      });
    } else {
      logger.warn("No reminder role found; skipping reminder message.");
    }
  } catch (e) {
    logger.error("Error handling reminder:", { error: e });
  }
}

/**
 * Reschedules a reminder for a specific key (only supports "disboard").
 *
 * If a reminder exists and is still scheduled in the future,
 * calculates the remaining time and sets a delayed task to send the reminder.
 *
 * @param {string} key - The key for the reminder (e.g., "disboard").
 * @param {string} role - The role ID to mention in the reminder.
 * @param {Client} client - The Discord client instance.
 */
async function rescheduleReminder(key, role, client) {
  try {
    logger.debug(`Attempting to reschedule reminder with role "${role}".`);
    
    const reminderData = await getReminderData(key);
    if (!reminderData) {
      logger.debug("No reminder data found.");
      return;
    }
    
    const { scheduled_time: scheduledTime, reminder_id: reminderId } = reminderData;
    if (scheduledTime && reminderId) {
      const scheduledDt = new Date(scheduledTime);
      const now = new Date();
      if (scheduledDt <= now) {
        logger.debug(`Reminder (ID: ${reminderId}) has expired. Removing it.`);
        await deleteReminderData(key);
        return;
      }
      
      const remainingTimeMs = scheduledDt - now;
      const remainingTimeSeconds = remainingTimeMs / 1000;
      logger.debug(`Rescheduling reminder (ID: ${reminderId}) to fire in ${remainingTimeSeconds} seconds.`);
      
      // Schedule the reminder.
      setTimeout(async () => {
        await sendScheduledMessage({
          initialMessage: null,
          reminderMessage: `🔔 <@&${role}> It's time to bump on Disboard!`,
          interval: 0,
          key,
          client
        });
      }, remainingTimeMs);
      
      logger.debug(`Reschedule task created for reminder (ID: ${reminderId}) with delay of ${remainingTimeSeconds} seconds.`);
    } else {
      logger.warn("Insufficient reminder data; cannot reschedule.");
    }
  } catch (e) {
    logger.error("Error while rescheduling the reminder:", { error: e });
  }
}

module.exports = {
  calculateRemainingTime,
  sendScheduledMessage,
  handleReminder,
  rescheduleReminder
};
