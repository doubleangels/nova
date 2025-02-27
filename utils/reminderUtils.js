const logger = require('../logger');
const { getReminderData, deleteReminderData, setReminderData, getValue } = require('../utils/supabase');

/**
 * Calculates the remaining time until a scheduled time.
 * @param {string} scheduledTime - An ISO-formatted date string.
 * @returns {string} A formatted time string "HH:MM:SS" if pending,
 *                   "⏰ Expired!" if the time has passed,
 *                   or an error message.
 */
function calculateRemainingTime(scheduledTime) {
  if (!scheduledTime) return 'Not set!';
  try {
    const now = new Date();
    const scheduled = new Date(scheduledTime);
    const diffMs = scheduled - now;
    if (diffMs <= 0) return '⏰ Expired!';
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } catch (error) {
    logger.error('Error calculating remaining time:', error);
    return '⚠️ Error calculating time!';
  }
}

/**
 * Wraps an asynchronous task in a try/catch block.
 * @param {Function} taskFn - The async function to execute safely.
 */
async function safeTask(taskFn) {
  try {
    await taskFn();
  } catch (error) {
    logger.error("Error in safeTask:", error);
  }
}

/**
 * Sends an initial message (if provided), waits for the specified interval,
 * then sends a reminder message and cleans up the reminder data.
 *
 * @param {Object} options
 * @param {string|null} options.initialMessage - Message to send immediately.
 * @param {string} options.reminderMessage - Reminder message to send after the delay.
 * @param {number} options.interval - Delay in seconds before sending the reminder.
 * @param {string} options.key - The reminder key used to fetch and delete reminder data.
 * @param {object} options.client - The Discord client used to send messages.
 */
async function sendScheduledMessage({ initialMessage, reminderMessage, interval, key, client }) {
  try {
    logger.debug(`sendScheduledMessage called with key '${key}', interval ${interval}, initialMessage: ${initialMessage}, reminderMessage: ${reminderMessage}`);
    
    // Retrieve the reminder channel ID from configuration.
    const channelId = await getValue('reminder_channel');
    if (!channelId) {
      logger.warn("No valid reminder channel found; cannot send scheduled message.");
      return;
    }
    
    // Use the Discord client to get the channel.
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      logger.warn(`Channel with ID ${channelId} not found.`);
      return;
    }
    
    // Send the initial message if provided.
    if (initialMessage) {
      logger.debug(`Sending initial message for '${key}': ${initialMessage}`);
      await channel.send(initialMessage);
    }
    
    logger.debug(`Waiting ${interval} seconds before sending reminder for '${key}'.`);
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    
    logger.debug(`Sending reminder message for '${key}': ${reminderMessage}`);
    await channel.send(reminderMessage);
    
    // Clean up the reminder data.
    const reminderData = await getReminderData(key);
    if (reminderData) {
      await deleteReminderData(key);
      logger.debug(`Reminder ${reminderData.reminder_id} for '${key}' has been cleaned up.`);
    } else {
      logger.debug(`No reminder data to clean up for key '${key}'.`);
    }
  } catch (e) {
    logger.error(`Error in sendScheduledMessage for key '${key}':`, e);
  }
}

/**
 * Handles the creation and scheduling of a reminder.
 * Checks if a reminder for the given key already exists.
 * If not, creates a new reminder entry with a unique reminder ID and
 * schedules the sending of messages using sendScheduledMessage.
 *
 * @param {string} key - The reminder key.
 * @param {string|null} initialMessage - The message to send immediately.
 * @param {string} reminderMessage - The reminder message to send after the interval.
 * @param {number} interval - Delay in seconds before sending the reminder.
 * @param {object} client - The Discord client used to send messages.
 */
async function handleReminder(key, initialMessage, reminderMessage, interval, client) {
  try {
    logger.debug(`handleReminder invoked for key '${key}' with interval ${interval}.`);
    
    // Check if a reminder is already scheduled for this key.
    const existingData = await getReminderData(key);
    if (existingData && existingData.scheduled_time) {
      logger.debug(`${key.charAt(0).toUpperCase() + key.slice(1)} already has a timer set. Skipping new reminder.`);
      return;
    }
    
    // Generate a unique reminder ID.
    const { randomUUID } = require('crypto');
    const reminderId = randomUUID();
    const scheduledTime = new Date(Date.now() + interval * 1000).toISOString();
    
    await setReminderData(key, scheduledTime, reminderId);
    logger.debug(`Reminder data set for key '${key}' with reminder_id '${reminderId}' and scheduled_time '${scheduledTime}'.`);
    
    // Retrieve the role used for mentions from configuration.
    const role = await getValue("reminder_role");
    if (role) {
      logger.debug(`Role '${role}' retrieved for reminder key '${key}'. Scheduling sendScheduledMessage.`);
      await sendScheduledMessage({
        initialMessage,
        reminderMessage: `🔔 <@&${role}> ${reminderMessage}`,
        interval,
        key,
        client
      });
    } else {
      logger.warn(`No role found for reminder key '${key}'; cannot mention in reminder message.`);
    }
  } catch (e) {
    logger.error(`Error handling reminder for key '${key}':`, e);
  }
}

/**
 * Reschedules an existing reminder.
 * Checks the reminder data for Disboard and calculates the remaining time.
 * If the reminder is still pending, creates a safe task to send the scheduled message;
 * if expired, cleans up the reminder data.
 *
 * @param {string} key - The reminder key (only "disboard" is supported).
 * @param {string} role - The role ID to mention in the reminder message.
 * @param {object} client - The Discord client used to send messages.
 */
async function rescheduleReminder(key, role, client) {
  try {
    logger.debug(`Attempting to reschedule reminder for key '${key}' with role '${role}'.`);
    
    if (key !== "disboard") {
      logger.debug(`Reminder key '${key}' is not supported. Only 'disboard' is handled.`);
      return;
    }
    
    const reminderData = await getReminderData(key);
    if (!reminderData) {
      logger.debug("No reminder data found for Disboard.");
      return;
    }
    
    const { scheduled_time: scheduledTime, reminder_id: reminderId } = reminderData;
    if (scheduledTime && reminderId) {
      const scheduledDt = new Date(scheduledTime);
      const now = new Date();
      if (scheduledDt <= now) {
        logger.debug(`Reminder ${reminderId} for Disboard has already expired. Removing it.`);
        await deleteReminderData(key);
        return;
      }
      
      const remainingTimeMs = scheduledDt - now;
      const remainingTimeSeconds = remainingTimeMs / 1000;
      logger.debug(`Rescheduling Disboard reminder ${reminderId} in ${remainingTimeSeconds} seconds.`);
      
      setTimeout(async () => {
        await safeTask(async () => {
          await sendScheduledMessage({
            initialMessage: null,
            reminderMessage: `🔔 <@&${role}> It's time to bump on Disboard!`,
            interval: remainingTimeSeconds,
            key,
            client
          });
        });
      }, remainingTimeMs);
      
      logger.debug(`Reschedule task created for reminder ${reminderId} with a delay of ${remainingTimeSeconds} seconds.`);
    } else {
      logger.warn(`Insufficient reminder data for key '${key}'; cannot reschedule.`);
    }
  } catch (e) {
    logger.error(`Error while attempting to reschedule the Disboard reminder: ${e}`);
  }
}

module.exports = {
  calculateRemainingTime,
  safeTask,
  sendScheduledMessage,
  handleReminder,
  rescheduleReminder
};
