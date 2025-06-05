const logger = require('../logger')('reminderUtils.js');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { logError, ERROR_MESSAGES } = require('../errors');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

const CONFIRMATION_EMOJI = '❤️';
const REMINDER_EMOJI = '🔔';
const CONFIRMATION_MESSAGE = "Thanks for bumping! I'll remind you again <t:%s:R>.";
const REMINDER_MESSAGE = " Time to bump the server! Use `/bump` to help us grow!";

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

async function handleReminder(message, delay) {
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

    await channel.send(`${CONFIRMATION_EMOJI} ${CONFIRMATION_MESSAGE.replace('%s', unixTimestamp)}`);
    logger.debug("Sent confirmation message in channel:", { channelId: reminderChannelId });

    await pool.query(
      `DELETE FROM main.reminder_recovery WHERE remind_at > NOW()`
    );
    logger.debug("Cleaned up existing reminders.");

    await pool.query(
      `INSERT INTO main.reminder_recovery (reminder_id, remind_at) VALUES ($1, $2)`,
      [reminderId, scheduledTime.toISOString()]
    );

    setTimeout(async () => {
      try {
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent scheduled bump reminder ping:", {
          role: reminderRole,
          channelId: reminderChannelId
        });

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

    const reminderData = await getLatestReminderData();
    if (!reminderData) {
      logger.debug("No stored bump reminders found for rescheduling.");
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
    
    const scheduledTime = dayjs(reminderData.remind_at);
    const now = dayjs();
    const delay = scheduledTime.diff(now, 'millisecond');
    
    logger.debug("Calculated scheduled time and delay for reminder:", {
      scheduledTime: scheduledTime.toISOString(),
      currentTime: now.toISOString(),
      delay
    });
    
    if (delay < 0) {
      logger.debug("Skipping overdue reminder:", { reminder_id: reminderData.reminder_id });
      return;
    }
    
    setTimeout(async () => {
      try {
        await channel.send(`${REMINDER_EMOJI} <@&${reminderRole}> ${REMINDER_MESSAGE}`);
        logger.debug("Sent rescheduled bump reminder:", { reminder_id: reminderData.reminder_id });

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

module.exports = {
  handleReminder,
  rescheduleReminder
};
