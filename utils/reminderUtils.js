const path = require('path');
const fs = require('fs');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Keyv for reminder storage using SQLite
// SQLite provides ACID guarantees and immediate persistence
// This is critical for reminders to survive bot restarts
// Using the same database.sqlite file as the main database, but with a different namespace
const sqlitePath = path.join(dataDir, 'database.sqlite');
const reminderKeyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
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
 * @param {string} type - The type of reminder ('bump', 'discadia', or 'promote')
 * @returns {Promise<{reminder_id: string, remind_at: Date, type: string}|null>} The latest reminder data or null if none found
 */
async function getLatestReminderData(type) {
  try {
    const reminderIds = await getReminderIds(type);
    const now = new Date();
    let latestReminder = null;
    let latestTime = null;
    
    logger.debug(`Checking ${reminderIds.length} reminder(s) of type "${type}" for latest active reminder. Current time: ${now.toISOString()}`);
    
    for (const reminderId of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${reminderId}`);
      if (reminder && reminder.remind_at) {
        // Handle both Date objects and ISO strings
        const remindAt = reminder.remind_at instanceof Date 
          ? reminder.remind_at 
          : new Date(reminder.remind_at);
        
        // Check if the date is valid
        if (isNaN(remindAt.getTime())) {
          logger.warn(`Invalid date found for reminder ${reminderId}: ${reminder.remind_at}`);
          continue;
        }
        
        logger.debug(`Reminder ${reminderId}: remind_at=${remindAt.toISOString()}, now=${now.toISOString()}, isFuture=${remindAt > now}`);
        
        if (remindAt > now && (!latestTime || remindAt < latestTime)) {
          latestTime = remindAt;
          latestReminder = {
            reminder_id: reminder.reminder_id,
            remind_at: remindAt,
            type: reminder.type
          };
          logger.debug(`Found new latest reminder: ${reminderId}, scheduled for ${remindAt.toISOString()}`);
        }
      } else {
        logger.debug(`Reminder ${reminderId} is missing or has no remind_at field:`, { reminder });
      }
    }
    
    if (latestReminder) {
      logger.debug(`Latest reminder found for type "${type}": ${latestReminder.reminder_id}, scheduled for ${latestReminder.remind_at.toISOString()}`);
    } else {
      logger.debug(`No active reminders found for type "${type}".`);
    }
    
    return latestReminder;
  } catch (err) {
    logger.error("Error getting latest reminder data:", { error: err });
    return null;
  }
}

/**
 * Handles the creation and scheduling of a reminder
 * @param {Message|Object} message - The Discord message that triggered the reminder, or an object with a client property
 * @param {number} delay - The delay in milliseconds before the reminder
 * @param {string} [type='bump'] - The type of reminder ('bump', 'discadia', or 'promote')
 * @param {boolean} [skipConfirmation=false] - If true, skip sending the confirmation message to the channel
 * @returns {Promise<void>}
 * @throws {Error} If reminder creation fails or configuration is missing
 */
async function handleReminder(message, delay, type = 'bump', skipConfirmation = false) {
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

    // Clean up existing reminders first (both future and expired)
    // We only want one active reminder per type at a time
    const reminderIds = await getReminderIds(type);
    const now = new Date();
    let deletedCount = 0;
    let expiredCount = 0;
    
    // Delete all existing reminders and track which ones to remove from the list
    const idsToRemove = [];
    for (const id of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = reminder.remind_at instanceof Date 
          ? reminder.remind_at 
          : new Date(reminder.remind_at);
        
        // Delete the reminder data
        await reminderKeyv.delete(`reminder:${id}`);
        idsToRemove.push(id);
        
        if (remindAt > now) {
          deletedCount++; // Future reminder that was replaced
        } else {
          expiredCount++; // Expired reminder that was cleaned up
        }
      } else {
        // Reminder data is missing or invalid, clean it up
        await reminderKeyv.delete(`reminder:${id}`);
        idsToRemove.push(id);
        deletedCount++;
      }
    }
    
    // Update the list all at once to avoid race conditions
    if (idsToRemove.length > 0) {
      const listKey = `reminders:${type}:list`;
      const updatedList = reminderIds.filter(id => !idsToRemove.includes(id));
      await reminderKeyv.set(listKey, updatedList);
      logger.debug(`Updated reminder list for type "${type}": removed ${idsToRemove.length} ID(s), ${updatedList.length} remaining`);
    }
    
    if (deletedCount > 0 || expiredCount > 0) {
      logger.debug("Cleaned up existing reminders of type:", { 
        type, 
        deletedCount, 
        expiredCount,
        totalCleaned: deletedCount + expiredCount
      });
    }

    // Insert new reminder
    const reminderData = {
      reminder_id: reminderId,
      remind_at: scheduledTime.toISOString(),
      type: type
    };
    
    // Save reminder data - SQLite provides ACID guarantees for immediate persistence
    await reminderKeyv.set(`reminder:${reminderId}`, reminderData);
    logger.debug(`Saved reminder data for ${reminderId}.`);
    
    // Verify the reminder was saved by reading it back
    const savedReminder = await reminderKeyv.get(`reminder:${reminderId}`);
    if (!savedReminder || savedReminder.reminder_id !== reminderId) {
      logger.error("Failed to verify reminder was saved to database:", {
        reminderId,
        savedReminder,
        expectedId: reminderId
      });
      throw new Error("Failed to verify reminder was saved to database");
    }
    
    // Update the list to contain ONLY this new reminder ID
    // Since we cleaned up all old reminders above, the list should now only contain this one
    const listKey = `reminders:${type}:list`;
    const newList = [reminderId];
    await reminderKeyv.set(listKey, newList);
    logger.debug(`Set reminder list for type "${type}" to contain only new reminder. List now contains ${newList.length} reminder(s):`, { list: newList });
    
    // Verify the reminder is in the list
    const verifyList = await reminderKeyv.get(listKey) || [];
    if (!verifyList.includes(reminderId)) {
      logger.warn(`Reminder ${reminderId} was not found in list after setting! Attempting to fix...`, { 
        list: verifyList,
        expectedId: reminderId
      });
      // Try to set it again
      await reminderKeyv.set(listKey, [reminderId]);
      
      // Verify again
      const verifyList2 = await reminderKeyv.get(listKey) || [];
      if (!verifyList2.includes(reminderId)) {
        logger.error(`CRITICAL: Failed to persist reminder ${reminderId} to list after multiple attempts!`, {
          list: verifyList2,
          expectedId: reminderId
        });
        throw new Error(`Failed to persist reminder ${reminderId} to list`);
      } else {
        logger.info(`Successfully set reminder ${reminderId} in list after retry.`);
      }
    }
    
    logger.info("Successfully saved and verified reminder in database:", { 
      reminderId, 
      type, 
      scheduledTime: scheduledTime.toISOString(),
      delayMs: delay,
      delayMinutes: Math.round(delay / 1000 / 60),
      savedReminder: savedReminder
    });

    // Send confirmation message unless skipped (e.g., when called from /fix command)
    if (!skipConfirmation) {
      try {
        let confirmationMessage;
        if (type === 'promote') {
          confirmationMessage = `🎯 Server promoted successfully! I'll remind you to promote again <t:${unixTimestamp}:R>.`;
        } else if (type === 'discadia') {
          confirmationMessage = `Thanks for bumping with Discadia! I'll remind you again <t:${unixTimestamp}:R>.`;
        } else {
          confirmationMessage = `Thanks for bumping! I'll remind you again <t:${unixTimestamp}:R>.`;
        }
        
        await channel.send(`❤️ ${confirmationMessage}`);
        logger.debug("Sent confirmation message:", { type, unixTimestamp });
      } catch (sendError) {
        // Non-fatal: reminder is already saved, just log the error
        logger.warn("Failed to send confirmation message (reminder was still saved):", {
          error: sendError.message,
          type,
          reminderId
        });
      }
    } else {
      logger.debug("Skipping confirmation message as requested:", { type, reminderId });
    }

    setTimeout(async () => {
      try {
        let reminderMessage;
        if (type === 'promote') {
          reminderMessage = `🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote\` to post on Reddit!`;
        } else if (type === 'discadia') {
          reminderMessage = `🔔 <@&${reminderRole}> Time to bump the server with Discadia! Use \`/bump\` to help us grow!`;
        } else {
          reminderMessage = `🔔 <@&${reminderRole}> Time to bump the server! Use \`/bump\` to help us grow!`;
        }

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
    logger.info("Starting reminder rescheduling on bot startup...");
    
    const reminderChannelId = await getValue("reminder_channel");
    const reminderRole = await getValue("reminder_role");
    
    if (!reminderChannelId) {
      logger.warn("Configuration error: Missing reminder channel value. Reminders cannot be rescheduled.");
      return;
    }
    
    if (!reminderRole) {
      logger.warn("Configuration error: Missing reminder role value. Reminders cannot be rescheduled.");
      return;
    }

    logger.debug("Fetching stored reminders from database...");
    
    // Get all reminder IDs to check what's in the database
    const bumpIds = await getReminderIds('bump');
    const discadiaIds = await getReminderIds('discadia');
    const promoteIds = await getReminderIds('promote');
    
    logger.info(`Found ${bumpIds.length} bump reminder ID(s), ${discadiaIds.length} discadia reminder ID(s), and ${promoteIds.length} promote reminder ID(s) in database.`, {
      bumpIds: bumpIds,
      discadiaIds: discadiaIds,
      promoteIds: promoteIds
    });
    
    // Clean up expired reminders
    const now = new Date();
    let expiredBumpCount = 0;
    let expiredDiscadiaCount = 0;
    let expiredPromoteCount = 0;
    
    // Clean up expired bump reminders
    // Collect IDs to remove first, then remove them all at once to avoid modifying list while iterating
    const bumpIdsToRemove = [];
    for (const id of bumpIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = reminder.remind_at instanceof Date 
          ? reminder.remind_at 
          : new Date(reminder.remind_at);
        
        if (remindAt <= now) {
          // Expired reminder, mark for cleanup
          bumpIdsToRemove.push(id);
          expiredBumpCount++;
          logger.debug(`Marked expired bump reminder for cleanup: ${id} (was scheduled for ${remindAt.toISOString()})`);
        } else {
          logger.debug(`Bump reminder ${id} is active:`, { 
            reminder_id: reminder.reminder_id,
            remind_at: remindAt.toISOString(),
            type: reminder.type
          });
        }
      } else {
        // Invalid reminder data, mark for cleanup
        bumpIdsToRemove.push(id);
        expiredBumpCount++;
        logger.debug(`Marked invalid bump reminder for cleanup: ${id}`, { reminder });
      }
    }
    
    // Remove all expired/invalid bump reminders at once
    for (const id of bumpIdsToRemove) {
      await reminderKeyv.delete(`reminder:${id}`);
      await removeReminderId('bump', id);
      logger.debug(`Cleaned up bump reminder: ${id}`);
    }
    
    // Clean up expired discadia reminders
    // Collect IDs to remove first, then remove them all at once to avoid modifying list while iterating
    const discadiaIdsToRemove = [];
    for (const id of discadiaIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = reminder.remind_at instanceof Date 
          ? reminder.remind_at 
          : new Date(reminder.remind_at);
        
        if (remindAt <= now) {
          // Expired reminder, mark for cleanup
          discadiaIdsToRemove.push(id);
          expiredDiscadiaCount++;
          logger.debug(`Marked expired discadia reminder for cleanup: ${id} (was scheduled for ${remindAt.toISOString()})`);
        } else {
          logger.debug(`Discadia reminder ${id} is active:`, { 
            reminder_id: reminder.reminder_id,
            remind_at: remindAt.toISOString(),
            type: reminder.type
          });
        }
      } else {
        // Invalid reminder data, mark for cleanup
        discadiaIdsToRemove.push(id);
        expiredDiscadiaCount++;
        logger.debug(`Marked invalid discadia reminder for cleanup: ${id}`, { reminder });
      }
    }
    
    // Remove all expired/invalid discadia reminders at once
    for (const id of discadiaIdsToRemove) {
      await reminderKeyv.delete(`reminder:${id}`);
      await removeReminderId('discadia', id);
      logger.debug(`Cleaned up discadia reminder: ${id}`);
    }
    
    // Clean up expired promote reminders
    // Collect IDs to remove first, then remove them all at once to avoid modifying list while iterating
    const promoteIdsToRemove = [];
    for (const id of promoteIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = reminder.remind_at instanceof Date 
          ? reminder.remind_at 
          : new Date(reminder.remind_at);
        
        if (remindAt <= now) {
          // Expired reminder, mark for cleanup
          promoteIdsToRemove.push(id);
          expiredPromoteCount++;
          logger.debug(`Marked expired promote reminder for cleanup: ${id} (was scheduled for ${remindAt.toISOString()})`);
        } else {
          logger.debug(`Promote reminder ${id} is active:`, { 
            reminder_id: reminder.reminder_id,
            remind_at: remindAt.toISOString(),
            type: reminder.type
          });
        }
      } else {
        // Invalid reminder data, mark for cleanup
        promoteIdsToRemove.push(id);
        expiredPromoteCount++;
        logger.debug(`Marked invalid promote reminder for cleanup: ${id}`, { reminder });
      }
    }
    
    // Remove all expired/invalid promote reminders at once
    for (const id of promoteIdsToRemove) {
      await reminderKeyv.delete(`reminder:${id}`);
      await removeReminderId('promote', id);
      logger.debug(`Cleaned up promote reminder: ${id}`);
    }
    
    if (expiredBumpCount > 0 || expiredDiscadiaCount > 0 || expiredPromoteCount > 0) {
      logger.info(`Cleaned up ${expiredBumpCount} expired bump reminder(s), ${expiredDiscadiaCount} expired discadia reminder(s), and ${expiredPromoteCount} expired promote reminder(s).`);
    }

    const [bumpReminder, discadiaReminder, promoteReminder] = await Promise.all([
      getLatestReminderData('bump'),
      getLatestReminderData('discadia'),
      getLatestReminderData('promote')
    ]);

    logger.info("Latest reminder data retrieved:", {
      hasBumpReminder: !!bumpReminder,
      hasDiscadiaReminder: !!discadiaReminder,
      hasPromoteReminder: !!promoteReminder,
      bumpReminder: bumpReminder ? { id: bumpReminder.reminder_id, remind_at: bumpReminder.remind_at } : null,
      discadiaReminder: discadiaReminder ? { id: discadiaReminder.reminder_id, remind_at: discadiaReminder.remind_at } : null,
      promoteReminder: promoteReminder ? { id: promoteReminder.reminder_id, remind_at: promoteReminder.remind_at } : null
    });

    if (!bumpReminder && !discadiaReminder && !promoteReminder) {
      logger.warn("No active reminders found for rescheduling. All reminders may have expired or none were stored.");
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
      
      logger.info("Processing bump reminder for rescheduling:", {
        reminder_id: bumpReminder.reminder_id,
        scheduledTime: scheduledTime.toISOString(),
        now: now.toISOString(),
        delayMs: delay,
        delayMinutes: Math.round(delay / 1000 / 60)
      });
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to bump the server! Use \`/bump\` to help us grow!`);
            logger.info("Sent rescheduled bump reminder:", { reminder_id: bumpReminder.reminder_id });

            await reminderKeyv.delete(`reminder:${bumpReminder.reminder_id}`);
            await removeReminderId('bump', bumpReminder.reminder_id);
          } catch (err) {
            logger.error("Error while sending rescheduled bump reminder:", {
              error: err.message,
              stack: err.stack
            });
          }
        }, delay);
        
        logger.info("Successfully rescheduled bump reminder:", {
          reminder_id: bumpReminder.reminder_id,
          delayMs: delay,
          delayMinutes: Math.round(delay / 1000 / 60),
          scheduledFor: new Date(Date.now() + delay).toISOString()
        });
      } else {
        logger.warn("Bump reminder is in the past, skipping reschedule:", {
          reminder_id: bumpReminder.reminder_id,
          scheduledTime: scheduledTime.toISOString(),
          now: now.toISOString(),
          delayMs: delay
        });
      }
    }

    if (discadiaReminder) {
      const scheduledTime = dayjs(discadiaReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      logger.info("Processing discadia reminder for rescheduling:", {
        reminder_id: discadiaReminder.reminder_id,
        scheduledTime: scheduledTime.toISOString(),
        now: now.toISOString(),
        delayMs: delay,
        delayMinutes: Math.round(delay / 1000 / 60)
      });
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to bump the server with Discadia! Use \`/bump\` to help us grow!`);
            logger.info("Sent rescheduled discadia reminder:", { reminder_id: discadiaReminder.reminder_id });

            await reminderKeyv.delete(`reminder:${discadiaReminder.reminder_id}`);
            await removeReminderId('discadia', discadiaReminder.reminder_id);
          } catch (err) {
            logger.error("Error while sending rescheduled discadia reminder:", {
              error: err.message,
              stack: err.stack
            });
          }
        }, delay);
        
        logger.info("Successfully rescheduled discadia reminder:", {
          reminder_id: discadiaReminder.reminder_id,
          delayMs: delay,
          delayMinutes: Math.round(delay / 1000 / 60),
          scheduledFor: new Date(Date.now() + delay).toISOString()
        });
      } else {
        logger.warn("Discadia reminder is in the past, skipping reschedule:", {
          reminder_id: discadiaReminder.reminder_id,
          scheduledTime: scheduledTime.toISOString(),
          now: now.toISOString(),
          delayMs: delay
        });
      }
    }

    if (promoteReminder) {
      const scheduledTime = dayjs(promoteReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      logger.info("Processing promote reminder for rescheduling:", {
        reminder_id: promoteReminder.reminder_id,
        scheduledTime: scheduledTime.toISOString(),
        now: now.toISOString(),
        delayMs: delay,
        delayMinutes: Math.round(delay / 1000 / 60)
      });
      
      if (delay > 0) {
        setTimeout(async () => {
          try {
            await channel.send(`🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote\` to post on Reddit!`);
            logger.info("Sent rescheduled promotion reminder:", { reminder_id: promoteReminder.reminder_id });

            await reminderKeyv.delete(`reminder:${promoteReminder.reminder_id}`);
            await removeReminderId('promote', promoteReminder.reminder_id);
          } catch (err) {
            logger.error("Error while sending rescheduled promotion reminder:", {
              error: err.message,
              stack: err.stack
            });
          }
        }, delay);
        
        logger.info("Successfully rescheduled promotion reminder:", {
          reminder_id: promoteReminder.reminder_id,
          delayMs: delay,
          delayMinutes: Math.round(delay / 1000 / 60),
          scheduledFor: new Date(Date.now() + delay).toISOString()
        });
      } else {
        logger.warn("Promote reminder is in the past, skipping reschedule:", {
          reminder_id: promoteReminder.reminder_id,
          scheduledTime: scheduledTime.toISOString(),
          now: now.toISOString(),
          delayMs: delay
        });
      }
    }
    
    logger.info("Reminder rescheduling completed.");
  } catch (error) {
    logger.error("Error in rescheduleReminder:", {
      error: error.message,
      stack: error.stack
    });
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
