const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const Keyv = require('keyv');
const { KeyvFile } = require('keyv-file');

// Initialize Keyv for reminder storage
const reminderKeyv = new Keyv({
  store: new KeyvFile({
    filename: './data/database.json'
  }),
  namespace: 'nova_reminders'
});

reminderKeyv.on('error', err => logger.error('Reminder Keyv connection error:', { error: err }));

/**
 * Helper function to get all reminder IDs for a type
 * @param {string} type - The type of reminder ('bump' or 'promote')
 * @returns {Promise<string[]>} Array of reminder IDs
 */
async function getReminderIds(type) {
  const listKey = `reminders:${type}:list`;
  return await reminderKeyv.get(listKey) || [];
}

/**
 * Helper function to add a reminder ID to the list
 * @param {string} type - The type of reminder
 * @param {string} reminderId - The reminder ID
 * @returns {Promise<void>}
 */
async function addReminderId(type, reminderId) {
  const listKey = `reminders:${type}:list`;
  const list = await getReminderIds(type);
  if (!list.includes(reminderId)) {
    list.push(reminderId);
    await reminderKeyv.set(listKey, list);
  }
}

/**
 * Helper function to remove a reminder ID from the list
 * @param {string} type - The type of reminder
 * @param {string} reminderId - The reminder ID
 * @returns {Promise<void>}
 */
async function removeReminderId(type, reminderId) {
  const listKey = `reminders:${type}:list`;
  const list = await getReminderIds(type);
  const filtered = list.filter(id => id !== reminderId);
  await reminderKeyv.set(listKey, filtered);
}

/**
 * Retrieves the latest reminder data for a specific type
 * @param {string} type - The type of reminder ('bump' or 'promote')
 * @returns {Promise<{reminder_id: string, remind_at: Date, type: string}|null>} The latest reminder data or null if none found
 */
async function getLatestReminderData(type) {
  try {
    const reminderIds = await getReminderIds(type);
    const now = new Date();
    let latestReminder = null;
    let latestTime = null;
    
    for (const reminderId of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${reminderId}`);
      if (reminder && reminder.remind_at) {
        const remindAt = new Date(reminder.remind_at);
        if (remindAt > now && (!latestTime || remindAt < latestTime)) {
          latestTime = remindAt;
          latestReminder = {
            reminder_id: reminder.reminder_id,
            remind_at: remindAt,
            type: reminder.type
          };
        }
      }
    }
    
    return latestReminder;
  } catch (err) {
    logger.error("Error getting latest reminder data:", { error: err });
    return null;
  }
}

/**
 * Handles the creation and scheduling of a reminder
 * @param {Message} message - The Discord message that triggered the reminder
 * @param {number} delay - The delay in milliseconds before the reminder
 * @param {string} [type='bump'] - The type of reminder ('bump' or 'promote')
 * @returns {Promise<void>}
 * @throws {Error} If reminder creation fails or configuration is missing
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

    // Clean up existing reminders first
    const reminderIds = await getReminderIds(type);
    let deletedCount = 0;
    for (const id of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = new Date(reminder.remind_at);
        if (remindAt > new Date()) {
          await reminderKeyv.delete(`reminder:${id}`);
          await removeReminderId(type, id);
          deletedCount++;
        }
      }
    }
    logger.debug("Cleaned up existing reminders of type:", { type, deletedCount });

    // Insert new reminder
    const reminderData = {
      reminder_id: reminderId,
      remind_at: scheduledTime.toISOString(),
      type: type
    };
    await reminderKeyv.set(`reminder:${reminderId}`, reminderData);
    await addReminderId(type, reminderId);
    logger.debug("Successfully inserted new reminder:", { reminderId, type, scheduledTime: scheduledTime.toISOString() });

    const confirmationMessage = type === 'promote'
      ? `🎯 Server promoted successfully! I'll remind you to promote again <t:${unixTimestamp}:R>.`
      : `Thanks for bumping! I'll remind you again <t:${unixTimestamp}:R>.`;
    
    await channel.send(`❤️ ${confirmationMessage}`);
    logger.debug("Sent confirmation message:", { type, unixTimestamp });

    setTimeout(async () => {
      try {
        const reminderMessage = type === 'promote' 
          ? `🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote\` to post on Reddit!`
          : `🔔 <@&${reminderRole}> Time to bump the server! Use \`/bump\` to help us grow!`;

        await channel.send(reminderMessage);
        logger.debug("Sent scheduled reminder ping:", {
          role: reminderRole,
          channelId: reminderChannelId,
          type
        });

        await reminderKeyv.delete(`reminder:${reminderId}`);
        await removeReminderId(type, reminderId);
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
 * Reschedules all active reminders after bot restart
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
 * @throws {Error} If rescheduling fails or configuration is missing
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

    if (bumpReminder) {
      const scheduledTime = dayjs(bumpReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to bump the server! Use \`/bump\` to help us grow!`);
            logger.debug("Sent rescheduled bump reminder:", { reminder_id: bumpReminder.reminder_id });

            await reminderKeyv.delete(`reminder:${bumpReminder.reminder_id}`);
            await removeReminderId('bump', bumpReminder.reminder_id);
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

    if (promoteReminder) {
      const scheduledTime = dayjs(promoteReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote\` to post on Reddit!`);
            logger.debug("Sent rescheduled promotion reminder:", { reminder_id: promoteReminder.reminder_id });

            await reminderKeyv.delete(`reminder:${promoteReminder.reminder_id}`);
            await removeReminderId('promote', promoteReminder.reminder_id);
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

/**
 * Handles errors that occur during reminder operations
 * @param {Error} error - The error that occurred
 * @param {string} context - The context where the error occurred
 * @throws {Error} A formatted error message based on the error type
 */
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
  rescheduleReminder,
  getLatestReminderData
};
