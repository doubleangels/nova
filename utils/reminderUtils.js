const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getValue } = require('../utils/database');
const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const { getSharedKeyvStore } = require('./sqliteStore');

const reminderKeyv = new Keyv({
  store: getSharedKeyvStore(),
  namespace: 'nova_reminders'
});

reminderKeyv.on('error', err => logger.error('Reminder Keyv connection error occurred.', { err: err }));

/** Interval for r/needafriend weekly comment reminder (7 days). */
const NEEDAFRIEND_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
/** Interval for r/findaserver promotion cooldown (24 hours). */
const PROMOTE_REMINDER_MS = 24 * 60 * 60 * 1000;

/** Matches `/reminder status` when channel or role is missing. */
const REMINDER_INCOMPLETE_EMBED_COLOR = 0xc03728;

/**
 * @param {import('discord.js').Guild | null | undefined} guild
 * @returns {Promise<{ channelStr: string, roleStr: string }>}
 */
async function getReminderConfigFieldValues(guild) {
  const [channelId, roleId] = await Promise.all([
    getValue('reminder_channel'),
    getValue('reminder_role')
  ]);

  let channelStr = '⚠️ Not set!';
  if (channelId) {
    const channelObj = guild?.channels?.cache?.get(channelId);
    channelStr = channelObj ? `<#${channelId}>` : 'Invalid channel';
  }

  let roleStr = '⚠️ Not set!';
  if (roleId) {
    const roleObj = guild?.roles?.cache?.get(roleId);
    roleStr = roleObj ? `<@&${roleId}>` : 'Invalid role';
  }

  return { channelStr, roleStr };
}

/**
 * Embed shown when reminder channel/role are not configured (same style as `/reminder status`).
 * @param {import('discord.js').Guild | null | undefined} guild
 * @returns {Promise<EmbedBuilder>}
 */
async function buildReminderIncompleteEmbed(guild) {
  const { channelStr, roleStr } = await getReminderConfigFieldValues(guild);
  return new EmbedBuilder()
    .setColor(REMINDER_INCOMPLETE_EMBED_COLOR)
    .setTitle('Server Reminders Status')
    .setDescription('Reminder configuration is incomplete.')
    .addFields(
      { name: 'Channel', value: channelStr },
      { name: 'Role', value: roleStr }
    );
}

/**
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {Promise<void>}
 */
async function replyReminderNotConfigured(interaction) {
  const embed = await buildReminderIncompleteEmbed(interaction.guild);
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply(payload);
  }
}

/**
 * @returns {Promise<boolean>}
 */
async function isReminderConfigured() {
  const [reminderRole, reminderChannelId] = await Promise.all([
    getValue('reminder_role'),
    getValue('reminder_channel')
  ]);
  return Boolean(reminderRole && reminderChannelId);
}

/** Active in-process reminder timeouts keyed by type. Used to cancel stale timers. */
const activeReminderTimeouts = new Map();
/** Serializes cooldown check-and-set per type so concurrent commands cannot both acquire. */
const cooldownLockChains = new Map();

function cancelReminderTimeout(type) {
  const id = activeReminderTimeouts.get(type);
  if (id !== undefined) {
    clearTimeout(id);
    activeReminderTimeouts.delete(type);
  }
}

/** Per-type reminder messages (role ping resolved at fire time, not at schedule time). */
const REMINDER_MESSAGES = {
  bump: (role) => `🔔 <@&${role}> Time to bump the server! Use \`/bump\` to help us grow!`,
  promote: (role) => `🔔 <@&${role}> Time to promote the server! Use \`/promote\` to post on Reddit!`,
  needafriend: (role) => `🔔 <@&${role}> Time for the r/needafriend weekly ad thread! Use \`/needafriend\` to comment.`,
};

/**
 * Cleans up expired/invalid reminders for one type and returns the count removed.
 * @param {string} type
 * @param {import('dayjs').Dayjs} now
 * @returns {Promise<number>}
 */
async function cleanupExpiredRemindersForType(type, now) {
  const ids = await getReminderIds(type);
  const toRemove = [];

  for (const id of ids) {
    const reminder = await reminderKeyv.get(`reminder:${id}`);
    if (!reminder || !reminder.remind_at) {
      toRemove.push(id);
    } else {
      const remindAt = dayjs(reminder.remind_at);
      if (!remindAt.isValid() || !remindAt.isAfter(now)) {
        toRemove.push(id);
      }
    }
  }

  for (const id of toRemove) {
    await reminderKeyv.delete(`reminder:${id}`);
    await removeReminderId(type, id);
  }

  if (toRemove.length > 0) {
    logger.debug('Cleaned up expired reminders.', { type, count: toRemove.length });
  }
  return toRemove.length;
}

/**
 * Schedules (or re-schedules) an in-process timeout for one reminder.
 * Cancels any existing timer for that type first so a bot restart followed
 * by a new bump never fires two pings.
 * Config (role, channel) is re-read at fire time to pick up any admin changes.
 * @param {import('discord.js').Client} client
 * @param {string} type
 * @param {{ reminder_id: string, remind_at: string }} reminder
 */
function scheduleReminderTimeout(client, type, reminder) {
  const scheduledTime = dayjs(reminder.remind_at);
  const delay = scheduledTime.diff(dayjs(), 'millisecond');

  if (delay <= 0) {
    logger.warn(`${type} reminder is in the past; skipping reschedule.`, {
      reminder_id: reminder.reminder_id,
      scheduledTime: scheduledTime.toISOString()
    });
    return;
  }

  cancelReminderTimeout(type);

  const timeoutId = setTimeout(async () => {
    activeReminderTimeouts.delete(type);
    try {
      const currentRole = await getValue('reminder_role');
      const currentChannelId = await getValue('reminder_channel');
      if (!currentRole || !currentChannelId) {
        logger.warn('Reminder config missing at fire time; skipping.', { type });
        return;
      }
      let ch = client.channels.cache.get(currentChannelId);
      if (!ch) ch = await client.channels.fetch(currentChannelId).catch(() => null);
      if (!ch) {
        logger.warn('Reminder channel not found at fire time; skipping.', { type, currentChannelId });
        return;
      }
      /* istanbul ignore next */
      const msgFn = REMINDER_MESSAGES[type] ?? REMINDER_MESSAGES.bump;
      await ch.send(msgFn(currentRole));
      logger.info(`Sent rescheduled ${type} reminder.`, { reminder_id: reminder.reminder_id });
      await reminderKeyv.delete(`reminder:${reminder.reminder_id}`);
      await removeReminderId(type, reminder.reminder_id);
    } catch (err) {
      logger.error(`Error sending rescheduled ${type} reminder.`, { err });
    }
  }, delay);

  activeReminderTimeouts.set(type, timeoutId);
  logger.info(`Scheduled ${type} reminder.`, {
    reminder_id: reminder.reminder_id,
    delayMs: delay,
    delayMinutes: Math.round(delay / 1000 / 60),
    scheduledFor: scheduledTime.toISOString()
  });
}

/**
 * Helper function to get all reminder IDs for a type
 * @param {string} type - The type of reminder ('bump', 'promote', or 'needafriend')
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
 * @param {string} type - The type of reminder ('bump', 'promote', or 'needafriend')
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
    
    // Fetch all reminders in parallel
    const reminders = await Promise.all(
      reminderIds.map(id => reminderKeyv.get(`reminder:${id}`))
    );

    for (let i = 0; i < reminderIds.length; i++) {
      const reminderId = reminderIds[i];
      const reminder = reminders[i];
      
      if (reminder && reminder.remind_at) {
        // Parse remind_at using dayjs
        const remindAt = dayjs(reminder.remind_at);
        
        // ... rest of validation logic
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
 * Removes expired/invalid reminders for a type, then returns the next scheduled remind_at (ISO string) if any.
 * @param {string} type - 'bump' | 'promote' | 'needafriend'
 * @returns {Promise<string|null>}
 */
async function getNextReminderTimeAfterCleanup(type) {
  try {
    const reminderIds = await getReminderIds(type);
    const now = dayjs();

    const reminders = await Promise.all(reminderIds.map(id => reminderKeyv.get(`reminder:${id}`)));

    const idsToRemove = reminderIds.filter((id, i) => {
      const reminder = reminders[i];
      if (!reminder || !reminder.remind_at) return true;
      const remindAt = dayjs(reminder.remind_at);
      return !remindAt.isValid() || remindAt <= now;
    });

    if (idsToRemove.length > 0) {
      await Promise.all(idsToRemove.map(id => reminderKeyv.delete(`reminder:${id}`)));
      const remainingIds = reminderIds.filter((rid) => !idsToRemove.includes(rid));
      await reminderKeyv.set(`reminders:${type}:list`, remainingIds);
      logger.debug('Cleaned up expired/invalid reminders.', { type, count: idsToRemove.length });
    }

    const latestReminder = await getLatestReminderData(type);
    if (latestReminder?.remind_at) {
      return latestReminder.remind_at;
    }
    return null;
  } catch (error) {
    logger.error('Error in getNextReminderTimeAfterCleanup.', { err: error, type });
    return null;
  }
}

/**
 * @template T
 * @param {string} type
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runSerializedByType(type, fn) {
  const previous = cooldownLockChains.get(type) ?? Promise.resolve();
  let releaseNext;
  const gate = new Promise((resolve) => {
    releaseNext = resolve;
  });
  cooldownLockChains.set(type, previous.then(() => gate));
  await previous;
  try {
    return await fn();
  } finally {
    releaseNext();
  }
}

/**
 * Persists a command cooldown/reminder record (no Discord notifications).
 * @param {string} type
 * @param {number} delayMs
 * @returns {Promise<{ reminderId: string, remind_at: string, delayMs: number, type: string }>}
 */
async function persistCommandCooldown(type, delayMs) {
  const scheduledTime = dayjs().add(delayMs, 'millisecond');
  const reminderId = randomUUID();

  const reminderIds = await getReminderIds(type);
  const now = dayjs();
  let deletedCount = 0;
  let expiredCount = 0;

  const idsToRemove = [];
  for (const id of reminderIds) {
    const reminder = await reminderKeyv.get(`reminder:${id}`);
    if (reminder && reminder.remind_at) {
      const remindAt = dayjs(reminder.remind_at);
      await reminderKeyv.delete(`reminder:${id}`);
      idsToRemove.push(id);

      if (remindAt.isValid() && remindAt.isAfter(now)) {
        deletedCount++;
      } else {
        expiredCount++;
      }
    } else {
      await reminderKeyv.delete(`reminder:${id}`);
      idsToRemove.push(id);
      deletedCount++;
    }
  }

  if (idsToRemove.length > 0) {
    const listKey = `reminders:${type}:list`;
    const updatedList = reminderIds.filter((id) => !idsToRemove.includes(id));
    await reminderKeyv.set(listKey, updatedList);
    logger.debug('Updated reminder list for type.', {
      type,
      removedCount: idsToRemove.length,
      remainingCount: updatedList.length
    });
  }

  if (deletedCount > 0 || expiredCount > 0) {
    logger.debug('Cleaned up existing reminders of the given type.', {
      type,
      deletedCount,
      expiredCount,
      totalCleaned: deletedCount + expiredCount
    });
  }

  const reminderData = {
    reminder_id: reminderId,
    remind_at: scheduledTime.toISOString(),
    type
  };

  await reminderKeyv.set(`reminder:${reminderId}`, reminderData);
  await reminderKeyv.set(`reminders:${type}:list`, [reminderId]);

  logger.info('Successfully saved reminder in the database.', {
    reminderId,
    type,
    scheduledTime: scheduledTime.toISOString(),
    delayMs,
    delayMinutes: Math.round(delayMs / 1000 / 60)
  });

  return {
    reminderId,
    remind_at: reminderData.remind_at,
    delayMs,
    type
  };
}

/**
 * Removes all stored cooldown/reminder records for a type.
 * @param {string} type
 * @returns {Promise<void>}
 */
async function clearCommandCooldown(type) {
  cancelReminderTimeout(type);
  const reminderIds = await getReminderIds(type);
  for (const id of reminderIds) {
    await reminderKeyv.delete(`reminder:${id}`);
  }
  await reminderKeyv.set(`reminders:${type}:list`, []);
}

/**
 * Atomically checks cooldown and reserves it before long-running work (e.g. Reddit API).
 * @param {string} type
 * @param {number} delayMs
 * @returns {Promise<{ acquired: true, reminderId: string, remind_at: string, delayMs: number, type: string } | { acquired: false, nextTime: string }>}
 */
async function tryAcquireCommandCooldown(type, delayMs) {
  return runSerializedByType(type, async () => {
    if (!(await isReminderConfigured())) {
      return { acquired: false, notConfigured: true };
    }

    const nextTime = await getNextReminderTimeAfterCleanup(type);
    if (nextTime && dayjs().isBefore(dayjs(nextTime))) {
      return { acquired: false, nextTime };
    }

    const saved = await persistCommandCooldown(type, delayMs);
    return { acquired: true, ...saved };
  });
}

/**
 * Rolls back a reserved cooldown when the command fails before completing.
 * @param {string} type
 * @returns {Promise<void>}
 */
async function releaseCommandCooldown(type) {
  return runSerializedByType(type, () => clearCommandCooldown(type));
}

/**
 * Sends confirmation/reminder pings and schedules the in-process timeout.
 * @param {import('discord.js').Client} client
 * @param {string} type
 * @param {{ reminderId: string, remind_at: string, delayMs: number }} reminder
 * @param {boolean} [skipConfirmation=false]
 * @returns {Promise<void>}
 */
async function scheduleCommandCooldownNotifications(client, type, reminder, skipConfirmation = false) {
  const unixTimestamp = Math.floor(dayjs(reminder.remind_at).valueOf() / 1000);

  const reminderRole = await getValue('reminder_role');
  if (!reminderRole) {
    logger.warn('Reminder notifications were not scheduled because reminder_role is not set. Use /reminder to configure.');
    return;
  }

  const reminderChannelId = await getValue('reminder_channel');
  if (!reminderChannelId) {
    logger.warn('Reminder notifications were not scheduled because reminder_channel is not set. Use /reminder to configure.');
    return;
  }

  let channel;
  try {
    channel = client.channels.cache.get(reminderChannelId);
    if (!channel) {
      channel = await client.channels.fetch(reminderChannelId);
    }
  } catch (channelError) {
    logger.error('Failed to fetch channel; reminder was saved but notifications were skipped.', {
      err: channelError,
      channelId: reminderChannelId
    });
    return;
  }

  if (!skipConfirmation) {
    try {
      let confirmationMessage;
      if (type === 'promote') {
        confirmationMessage = `🎯 Server promoted successfully! I'll remind you to promote again <t:${unixTimestamp}:R>.`;
      } else if (type === 'needafriend') {
        confirmationMessage = `🎯 Weekly r/needafriend comment posted successfully! I'll remind you to comment again <t:${unixTimestamp}:R>.`;
      } else {
        confirmationMessage = `Thanks for bumping! I'll remind you again <t:${unixTimestamp}:R>.`;
      }

      await channel.send(`❤️ ${confirmationMessage}`);
      logger.debug('Sent confirmation message.', { type, unixTimestamp });
    } catch (sendError) {
      logger.warn('Failed to send confirmation message, reminder was still saved.', {
        err: sendError,
        type,
        reminderId: reminder.reminderId
      });
    }
  } else {
    logger.debug('Skipping confirmation message as requested.', {
      type,
      reminderId: reminder.reminderId
    });
  }

  cancelReminderTimeout(type);

  const timeoutId = setTimeout(async () => {
    activeReminderTimeouts.delete(type);
    try {
      const currentRole = await getValue('reminder_role');
      const currentChannelId = await getValue('reminder_channel');
      if (!currentRole || !currentChannelId) {
        logger.warn('Reminder config missing at fire time; skipping.', { type });
        return;
      }
      let ch = client.channels.cache.get(currentChannelId);
      if (!ch) ch = await client.channels.fetch(currentChannelId).catch(() => null);
      if (!ch) {
        logger.warn('Reminder channel not found at fire time; skipping.', { type, currentChannelId });
        return;
      }
      /* istanbul ignore next */
      const msgFn = REMINDER_MESSAGES[type] ?? REMINDER_MESSAGES.bump;
      await ch.send(msgFn(currentRole));
      logger.debug('Sent scheduled reminder ping.', { type });
      await reminderKeyv.delete(`reminder:${reminder.reminderId}`);
      await removeReminderId(type, reminder.reminderId);
      logger.debug('Cleaned up sent reminder from recovery table.', { reminderId: reminder.reminderId });
    } catch (err) {
      logger.error('Error occurred while sending scheduled reminder.', { err, type });
    }
  }, reminder.delayMs);
  activeReminderTimeouts.set(type, timeoutId);
}

/**
 * Handles the creation and scheduling of a reminder
 * @param {Message|Object} message - The Discord message that triggered the reminder, or an object with a client property
 * @param {number} delay - The delay in milliseconds before the reminder
 * @param {string} [type='bump'] - The type of reminder ('bump', 'promote', or 'needafriend')
 * @param {boolean} [skipConfirmation=false] - If true, skip sending the confirmation message to the channel
 * @returns {Promise<void>}
 * @throws {Error} If reminder creation fails or configuration is missing
 */
async function handleReminder(message, delay, type = 'bump', skipConfirmation = false) {
  try {
    if (!(await isReminderConfigured())) {
      logger.debug('Reminder is not configured; skipping reminder scheduling.', { type });
      return;
    }

    const saved = await persistCommandCooldown(type, delay);
    await scheduleCommandCooldownNotifications(message.client, type, saved, skipConfirmation);
  } catch (error) {
    logger.error('Unexpected error in handleReminder.', { err: error });
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
      logger.warn("Reminders cannot be rescheduled because the reminder channel is not configured.");
      return;
    }
    if (!reminderRole) {
      logger.warn("Reminders cannot be rescheduled because the reminder role is not configured.");
      return;
    }

    const now = dayjs();

    const [expiredBump, expiredPromote, expiredNeedfriend] = await Promise.all([
      cleanupExpiredRemindersForType('bump', now),
      cleanupExpiredRemindersForType('promote', now),
      cleanupExpiredRemindersForType('needafriend', now)
    ]);

    if (expiredBump > 0 || expiredPromote > 0 || expiredNeedfriend > 0) {
      logger.info('Cleaned up expired reminders.', {
        expiredBumpCount: expiredBump,
        expiredPromoteCount: expiredPromote,
        expiredNeedafriendCount: expiredNeedfriend
      });
    }

    const [bumpReminder, promoteReminder, needafriendReminder] = await Promise.all([
      getLatestReminderData('bump'),
      getLatestReminderData('promote'),
      getLatestReminderData('needafriend')
    ]);

    logger.info("Latest reminder data was retrieved.", {
      hasBumpReminder: !!bumpReminder,
      hasPromoteReminder: !!promoteReminder,
      hasNeedafriendReminder: !!needafriendReminder,
      bumpReminder: bumpReminder ? { id: bumpReminder.reminder_id, remind_at: bumpReminder.remind_at } : null,
      promoteReminder: promoteReminder ? { id: promoteReminder.reminder_id, remind_at: promoteReminder.remind_at } : null,
      needafriendReminder: needafriendReminder ? { id: needafriendReminder.reminder_id, remind_at: needafriendReminder.remind_at } : null
    });

    if (!bumpReminder && !promoteReminder && !needafriendReminder) {
      logger.warn("No active reminders found for rescheduling. All reminders may have expired or none were stored.");
      return;
    }

    if (bumpReminder) scheduleReminderTimeout(client, 'bump', bumpReminder);
    if (promoteReminder) scheduleReminderTimeout(client, 'promote', promoteReminder);
    if (needafriendReminder) scheduleReminderTimeout(client, 'needafriend', needafriendReminder);

    logger.info("Reminder rescheduling completed.");
  } catch (error) {
    logger.error("Error occurred in rescheduleReminder.", {
      err: error
    });
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
  getLatestReminderData,
  getNextReminderTimeAfterCleanup,
  tryAcquireCommandCooldown,
  releaseCommandCooldown,
  scheduleCommandCooldownNotifications,
  isReminderConfigured,
  buildReminderIncompleteEmbed,
  replyReminderNotConfigured,
  addReminderId,
  handleError,
  NEEDAFRIEND_REMINDER_MS,
  PROMOTE_REMINDER_MS
};
