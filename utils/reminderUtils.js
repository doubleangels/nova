const logger = require('../logger')('reminderUtils.js');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue, setReminderData, getReminderData, deleteReminderData } = require('../utils/database');

// Configuration constants.
const BUMP_REMINDER_KEY = 'bump';
const CONFIRMATION_EMOJI = '❤️';
const REMINDER_EMOJI = '🔔';
const CONFIRMATION_MESSAGE = "Thanks for bumping! I'll remind you again in 2 hours.";
const REMINDER_MESSAGE = "It's time to bump again!";

/**
 * Schedules a bump reminder and stores it in the database.
 *
 * This function retrieves necessary configuration values (role and channel IDs) from the database,
 * calculates a scheduled time using day.js based on the provided delay, stores the reminder data, and sends an immediate
 * confirmation message in the designated channel. It then schedules a final reminder message to be sent after the delay.
 *
 * @param {Message} message - The Discord message object from which to access the client.
 * @param {number} delay - The delay in milliseconds before sending the final bump reminder.
 */
async function handleReminder(message, delay) {
  try {
    // Retrieve the role ID for pinging on the final reminder.
    const reminderRole = await getValue('reminder_role');
    if (!reminderRole) {
      logger.error("Configuration error: 'reminder_role' value not found.");
      return;
    }

    // Retrieve the channel ID where reminders should be sent.
    const reminderChannelId = await getValue('reminder_channel');
    if (!reminderChannelId) {
      logger.error("Configuration error: 'reminder_channel' value not found.");
      return;
    }

    const scheduledTime = dayjs().add(delay, 'millisecond');

    // Generate a unique identifier for the reminder.
    const reminderId = randomUUID();

    // Store the reminder data in the database.
    await setReminderData(BUMP_REMINDER_KEY, scheduledTime.toISOString(), reminderId);
    logger.debug("Inserted reminder data into database.", {
      key: BUMP_REMINDER_KEY,
      scheduled_time: scheduledTime.toISOString(),
      reminder_id: reminderId
    });

    // Attempt to retrieve the channel object using the cached channels or by fetching it.
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

    // Send an immediate confirmation message in the designated channel.
    await channel.send(`${CONFIRMATION_EMOJI} ${CONFIRMATION_MESSAGE}`);
    logger.debug("Sent confirmation message in channel.", { channelId: reminderChannelId });

    // Schedule the final reminder message after the specified delay.
    setTimeout(async () => {
      try {
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent scheduled bump reminder ping.", {
          role: reminderRole,
          channelId: reminderChannelId
        });
        
        // Clean up the reminder data after sending.
        await deleteReminderData(BUMP_REMINDER_KEY);
        logger.debug("Deleted reminder data after sending reminder.", { reminder_id: reminderId });
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
 * This function retrieves the stored reminder for the key "bump" from the database.
 * It then checks the reminder's scheduled time using day.js and calculates the delay until it should be sent.
 * If the scheduled time has already passed, it removes the reminder from the database.
 * Otherwise, it sets up a timeout to send the reminder message at the appropriate time.
 *
 * @param {Client} client - The Discord client instance used to fetch channels.
 */
async function rescheduleReminder(client) {
  try {
    // Retrieve the stored reminder for the "bump" key.
    const reminder = await getReminderData(BUMP_REMINDER_KEY);
    if (!reminder || reminder.length === 0) {
      logger.debug("No stored bump reminders found for rescheduling.");
      return;
    }
    
    // Retrieve the configuration values for the channel and role.
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
    
    // Retrieve the channel object from cache or by fetching from Discord.
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
    
    const scheduledTime = dayjs(reminder.scheduled_time);
    const now = dayjs();
    const delay = scheduledTime.diff(now, 'millisecond');
    
    logger.debug("Calculated scheduled time and delay for reminder.", { 
      scheduledTime: scheduledTime.toISOString(), 
      currentTime: now.toISOString(),
      delay 
    });
    
    // If the scheduled time has passed, remove the overdue reminder.
    if (delay < 0) {
      await deleteReminderData(BUMP_REMINDER_KEY);
      logger.debug("Deleted overdue bump reminder.", { reminder_id: reminder.reminder_id });
      return;
    }
    
    // Reschedule the reminder to send the bump message after the computed delay.
    setTimeout(async () => {
      try {
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent rescheduled bump reminder.", { reminder_id: reminder.reminder_id });
        
        // Clean up the reminder data after sending.
        await deleteReminderData(BUMP_REMINDER_KEY);
        logger.debug("Deleted reminder data after sending rescheduled reminder.", { 
          reminder_id: reminder.reminder_id 
        });
      } catch (err) {
        logger.error("Error while sending rescheduled bump reminder.", { 
          error: err.message,
          stack: err.stack
        });
      }
    }, delay);
    
    logger.debug("Successfully rescheduled bump reminder.", {
      reminder_id: reminder.reminder_id,
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

module.exports = { handleReminder, rescheduleReminder };
