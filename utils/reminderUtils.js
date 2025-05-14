const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { query, queryOne } = require('./database');
const Sentry = require('../sentry');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue, setReminderData, getReminderData, deleteReminderData } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');

// Setup a pool for direct SQL queries for sent_reminders
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// We define these configuration constants for consistent reminder behavior across the application.
const BUMP_REMINDER_KEY = 'bump';
const CONFIRMATION_EMOJI = '❤️';
const REMINDER_EMOJI = '🔔';
const CONFIRMATION_MESSAGE = "Thanks for bumping! I'll remind you again in 2 hours.";
const REMINDER_MESSAGE = "It's time to bump again!";

/**
 * Cleans up old sent reminder records from the database
 * @param {string} channelId - The Discord channel ID
 * @param {string} messageId - The message ID that was just edited/handled
 */
async function cleanupOldSentReminders(channelId, messageId) {
  try {
    await pool.query(
      `DELETE FROM main.sent_reminders 
       WHERE channel_id = $1 
       AND message_id = $2`,
      [channelId, messageId]
    );
    logger.debug("Cleaned up old sent reminder record", { channelId, messageId });
  } catch (err) {
    logger.error("Error cleaning up old sent reminder:", { error: err });
  }
}

/**
 * We schedule a reminder for the next Disboard bump.
 * This ensures users are notified when it's time to bump the server.
 * 
 * @param {Client} client - The Discord client instance.
 * @param {string} channelId - The ID of the channel to send the reminder to.
 * @param {Date} scheduledTime - When to send the reminder.
 * @returns {Promise<string>} The ID of the scheduled reminder.
 */
async function scheduleReminder(client, channelId, scheduledTime) {
  try {
    // We create a unique key for this reminder.
    const key = `bump_reminder_${channelId}`;
    
    // We schedule the reminder using Discord's setTimeout.
    const reminderId = setTimeout(async () => {
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          logger.error("Channel not found for reminder:", { channelId });
          return;
        }

        // We create an embed message for the reminder.
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🔄 Time to Bump!')
          .setDescription('It\'s been 2 hours since the last bump. Use `/bump` to keep our server active!')
          .setTimestamp();

        await channel.send({ embeds: [embed] });
        logger.info("Sent bump reminder:", { channelId });

        // We schedule the next reminder.
        const nextScheduledTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now.
        await scheduleReminder(client, channelId, nextScheduledTime);
      } catch (error) {
        logger.error("Error sending bump reminder:", { error });
        Sentry.captureException(error, {
          extra: { 
            function: 'scheduleReminder',
            channelId
          }
        });
      }
    }, scheduledTime.getTime() - Date.now());

    // We store the reminder data in the database.
    await query(`
      INSERT INTO reminder_data (key, scheduled_time, reminder_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE 
      SET scheduled_time = $2, reminder_id = $3
    `, [key, scheduledTime.toISOString(), reminderId.toString()]);

    logger.info("Scheduled bump reminder:", { 
      channelId, 
      scheduledTime: scheduledTime.toISOString() 
    });

    return reminderId.toString();
  } catch (error) {
    logger.error("Failed to schedule reminder:", { error });
    Sentry.captureException(error, {
      extra: { 
        function: 'scheduleReminder',
        channelId
      }
    });
    throw error;
  }
}

/**
 * We reschedule all reminders from the database after a bot restart.
 * This ensures no reminders are lost when the bot restarts.
 * 
 * @param {Client} client - The Discord client instance.
 */
async function rescheduleReminder(client) {
  try {
    // We get all active reminders from the database.
    const result = await query(`
      SELECT key, scheduled_time, reminder_id
      FROM reminder_data
      WHERE scheduled_time > NOW()
    `);

    let rescheduledCount = 0;
    for (const row of result.rows) {
      try {
        const channelId = row.key.replace('bump_reminder_', '');
        const scheduledTime = new Date(row.scheduled_time);
        
        // We only reschedule future reminders.
        if (scheduledTime > new Date()) {
          await scheduleReminder(client, channelId, scheduledTime);
          rescheduledCount++;
        }
      } catch (error) {
        logger.error("Failed to reschedule reminder:", { 
          error,
          key: row.key 
        });
        Sentry.captureException(error, {
          extra: { 
            function: 'rescheduleReminder',
            key: row.key
          }
        });
      }
    }

    logger.info(`Rescheduled ${rescheduledCount} reminders.`);
  } catch (error) {
    logger.error("Failed to reschedule reminders:", { error });
    Sentry.captureException(error, {
      extra: { function: 'rescheduleReminder' }
    });
    throw error;
  }
}

module.exports = { scheduleReminder, rescheduleReminder, cleanupOldSentReminders };
