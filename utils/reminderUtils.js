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

reminderKeyv.on('error', err => logger.error('Reminder Keyv connection error occurred.', { err: err }));

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
    const now = dayjs();
    let latestReminder = null;
    let latestTime = null;
    
    logger.debug('Checking reminders for latest active reminder.', {
      reminderCount: reminderIds.length,
      type: type,
      currentTime: now.toISOString()
    });
    
    for (const reminderId of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${reminderId}`);
      if (reminder && reminder.remind_at) {
        // Parse remind_at using dayjs
        const remindAt = dayjs(reminder.remind_at);
        
        // Check if the date is valid
        if (!remindAt.isValid()) {
          logger.warn('Invalid date found for reminder.', {
            reminderId: reminderId,
            remindAt: reminder.remind_at
          });
          continue;
        }
        
        logger.debug('Checking reminder status.', {
          reminderId: reminderId,
          remindAt: remindAt.toISOString(),
          now: now.toISOString(),
          isFuture: remindAt.isAfter(now)
        });
        
        if (remindAt.isAfter(now) && (!latestTime || remindAt.isBefore(latestTime))) {
          latestTime = remindAt;
          latestReminder = {
            reminder_id: reminder.reminder_id,
            remind_at: remindAt.toISOString(),
            type: reminder.type
          };
          logger.debug('Found new latest reminder.', {
            reminderId: reminderId,
            scheduledFor: remindAt.toISOString()
          });
        }
      } else {
        logger.debug('Reminder is missing or has no remind_at field.', {
          reminderId: reminderId,
          reminder: reminder
        });
      }
    }
    
    if (latestReminder) {
      logger.debug('Latest reminder found for type.', {
        type: type,
        reminderId: latestReminder.reminder_id,
        scheduledFor: latestReminder.remind_at
      });
    } else {
      logger.debug('No active reminders found for type.', {
        type: type
      });
    }
    
    return latestReminder;
  } catch (err) {
    logger.error("Error occurred while getting latest reminder data.", {
      err: err
    });
    return null;
  }
}

/**
 * Handles the creation and scheduling of a reminder
 * @param {Message|Object} message - The Discord message that triggered the reminder, or an object with a client property
 * @param {number} delay - The delay in milliseconds before the reminder
 * @param {string} [type='bump'] - The type of reminder ('bump' or 'promote')
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
      logger.error("Failed to fetch channel", {
        err: channelError,
        channelId: reminderChannelId
      });
      return;
    }

    // Clean up existing reminders first (both future and expired)
    // We only want one active reminder per type at a time
    const reminderIds = await getReminderIds(type);
    const now = dayjs();
    let deletedCount = 0;
    let expiredCount = 0;
    
    // Delete all existing reminders and track which ones to remove from the list
    const idsToRemove = [];
    for (const id of reminderIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = dayjs(reminder.remind_at);
        
        // Delete the reminder data
        await reminderKeyv.delete(`reminder:${id}`);
        idsToRemove.push(id);
        
        if (remindAt.isValid() && remindAt.isAfter(now)) {
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
      logger.debug('Updated reminder list for type.', {
        type: type,
        removedCount: idsToRemove.length,
        remainingCount: updatedList.length
      });
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
    logger.debug('Saved reminder data.', {
      reminderId: reminderId
    });
    
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
    logger.debug('Set reminder list for type to contain only new reminder.', {
      type: type,
      reminderCount: newList.length,
      list: newList
    });
    
    // Verify the reminder is in the list
    const verifyList = await reminderKeyv.get(listKey) || [];
    if (!verifyList.includes(reminderId)) {
      logger.warn('Reminder was not found in list after setting, attempting to fix.', {
        reminderId: reminderId,
        list: verifyList
      });
      // Try to set it again
      await reminderKeyv.set(listKey, [reminderId]);
      
      // Verify again
      const verifyList2 = await reminderKeyv.get(listKey) || [];
      if (!verifyList2.includes(reminderId)) {
        logger.error('CRITICAL: Failed to persist reminder to list after multiple attempts.', {
          reminderId: reminderId,
          list: verifyList2
        });
        throw new Error(`Failed to persist reminder ${reminderId} to list`);
      } else {
        logger.info('Successfully set reminder in list after retry.', {
          reminderId: reminderId
        });
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
        } else {
          confirmationMessage = `Thanks for bumping! I'll remind you again <t:${unixTimestamp}:R>.`;
        }
        
        await channel.send(`❤️ ${confirmationMessage}`);
        logger.debug("Sent confirmation message.", {
          type: type,
          unixTimestamp: unixTimestamp
        });
      } catch (sendError) {
        // Non-fatal: reminder is already saved, just log the error
        logger.warn("Failed to send confirmation message, reminder was still saved.", {
          err: sendError,
          type: type,
          reminderId: reminderId
        });
      }
    } else {
      logger.debug("Skipping confirmation message as requested.", {
        type: type,
        reminderId: reminderId
      });
    }

    setTimeout(async () => {
      try {
        let reminderMessage;
        if (type === 'promote') {
          reminderMessage = `🔔 <@&${reminderRole}> Time to promote the server! Use \`/promote\` to post on Reddit!`;
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
        logger.debug("Cleaned up sent reminder from recovery table.", {
          reminderId: reminderId
        });
      } catch (err) {
        logger.error("Error while sending scheduled reminder", {
          err: err,
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
    const promoteIds = await getReminderIds('promote');
    
    logger.info('Found reminder IDs in database.', {
      bumpCount: bumpIds.length,
      promoteCount: promoteIds.length,
      bumpIds: bumpIds,
      promoteIds: promoteIds
    });
    
    // Clean up expired reminders
    const now = dayjs();
    let expiredBumpCount = 0;
    let expiredPromoteCount = 0;
    
    // Clean up expired bump reminders
    // Collect IDs to remove first, then remove them all at once to avoid modifying list while iterating
    const bumpIdsToRemove = [];
    for (const id of bumpIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = dayjs(reminder.remind_at);
        
        if (!remindAt.isValid() || !remindAt.isAfter(now)) {
          // Expired reminder, mark for cleanup
          bumpIdsToRemove.push(id);
          expiredBumpCount++;
          logger.debug('Marked expired bump reminder for cleanup.', {
            reminderId: id,
            scheduledFor: remindAt.toISOString()
          });
        } else {
          logger.debug('Bump reminder is active.', {
            reminderId: id, 
            reminder_id: reminder.reminder_id,
            remind_at: remindAt.toISOString(),
            type: reminder.type
          });
        }
      } else {
        // Invalid reminder data, mark for cleanup
        bumpIdsToRemove.push(id);
        expiredBumpCount++;
        logger.debug('Marked invalid bump reminder for cleanup.', {
          reminderId: id,
          reminder: reminder
        });
      }
    }
    
    // Remove all expired/invalid bump reminders at once
    for (const id of bumpIdsToRemove) {
      await reminderKeyv.delete(`reminder:${id}`);
      await removeReminderId('bump', id);
      logger.debug('Cleaned up bump reminder.', {
        reminderId: id
      });
    }
    
    // Clean up expired promote reminders
    // Collect IDs to remove first, then remove them all at once to avoid modifying list while iterating
    const promoteIdsToRemove = [];
    for (const id of promoteIds) {
      const reminder = await reminderKeyv.get(`reminder:${id}`);
      if (reminder && reminder.remind_at) {
        const remindAt = dayjs(reminder.remind_at);
        
        if (!remindAt.isValid() || !remindAt.isAfter(now)) {
          // Expired reminder, mark for cleanup
          promoteIdsToRemove.push(id);
          expiredPromoteCount++;
          logger.debug('Marked expired promote reminder for cleanup.', {
            reminderId: id,
            scheduledFor: remindAt.toISOString()
          });
        } else {
          logger.debug('Promote reminder is active.', {
            reminderId: id, 
            reminder_id: reminder.reminder_id,
            remind_at: remindAt.toISOString(),
            type: reminder.type
          });
        }
      } else {
        // Invalid reminder data, mark for cleanup
        promoteIdsToRemove.push(id);
        expiredPromoteCount++;
        logger.debug('Marked invalid promote reminder for cleanup.', {
          reminderId: id,
          reminder: reminder
        });
      }
    }
    
    // Remove all expired/invalid promote reminders at once
    for (const id of promoteIdsToRemove) {
      await reminderKeyv.delete(`reminder:${id}`);
      await removeReminderId('promote', id);
      logger.debug('Cleaned up promote reminder.', {
        reminderId: id
      });
    }
    
    if (expiredBumpCount > 0 || expiredPromoteCount > 0) {
      logger.info('Cleaned up expired reminders.', {
        expiredBumpCount: expiredBumpCount,
        expiredPromoteCount: expiredPromoteCount
      });
    }

    const [bumpReminder, promoteReminder] = await Promise.all([
      getLatestReminderData('bump'),
      getLatestReminderData('promote')
    ]);

    logger.info("Latest reminder data retrieved:", {
      hasBumpReminder: !!bumpReminder,
      hasPromoteReminder: !!promoteReminder,
      bumpReminder: bumpReminder ? { id: bumpReminder.reminder_id, remind_at: bumpReminder.remind_at } : null,
      promoteReminder: promoteReminder ? { id: promoteReminder.reminder_id, remind_at: promoteReminder.remind_at } : null
    });

    if (!bumpReminder && !promoteReminder) {
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
      logger.error("Failed to fetch channel for rescheduled reminder", {
        err: channelError,
        channelId: reminderChannelId
      });
      return;
    }

    if (bumpReminder) {
      const scheduledTime = dayjs(bumpReminder.remind_at);
      const now = dayjs();
      const delay = scheduledTime.diff(now, 'millisecond');
      
      logger.info("Processing disboard reminder for rescheduling:", {
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
            logger.info("Sent rescheduled bump reminder.", {
              reminder_id: bumpReminder.reminder_id
            });

            await reminderKeyv.delete(`reminder:${bumpReminder.reminder_id}`);
            await removeReminderId('bump', bumpReminder.reminder_id);
          } catch (err) {
            logger.error("Error while sending rescheduled bump reminder", {
              err: err
            });
          }
        }, delay);
        
        logger.info("Successfully rescheduled disboard reminder:", {
          reminder_id: bumpReminder.reminder_id,
          delayMs: delay,
          delayMinutes: Math.round(delay / 1000 / 60),
          scheduledFor: dayjs().add(delay, 'millisecond').toISOString()
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
            logger.info("Sent rescheduled promotion reminder.", {
              reminder_id: promoteReminder.reminder_id
            });

            await reminderKeyv.delete(`reminder:${promoteReminder.reminder_id}`);
            await removeReminderId('promote', promoteReminder.reminder_id);
          } catch (err) {
            logger.error("Error while sending rescheduled promotion reminder", {
              err: err
            });
          }
        }, delay);
        
        logger.info("Successfully rescheduled promotion reminder:", {
          reminder_id: promoteReminder.reminder_id,
          delayMs: delay,
          delayMinutes: Math.round(delay / 1000 / 60),
          scheduledFor: dayjs().add(delay, 'millisecond').toISOString()
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
    logger.error("Error in rescheduleReminder", {
      err: error
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
  logger.error('Error occurred in context.', {
    err: error,
    context: context
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
