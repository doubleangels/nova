const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { query, queryOne } = require('./database');
const Sentry = require('../sentry');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');

// We define these configuration constants for consistent reminder behavior across the application.
const BUMP_REMINDER_KEY = 'bump';
const CONFIRMATION_EMOJI = '❤️';
const REMINDER_EMOJI = '🔔';
const CONFIRMATION_MESSAGE = "Thanks for bumping! I'll remind you again in 2 hours.";
const REMINDER_MESSAGE = "It's time to bump again!";

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
    // We create a unique ID for this reminder.
    const reminderId = randomUUID();
    
    // We store the reminder data in the recovery table.
    await query(`
      INSERT INTO recovery (
        id, 
        channel_id, 
        scheduled_time, 
        status, 
        type
      )
      VALUES ($1, $2, $3, 'pending', 'reminder')
      ON CONFLICT (channel_id, scheduled_time) DO UPDATE 
      SET status = 'pending'
    `, [reminderId, channelId, scheduledTime.toISOString()]);

    // We schedule the reminder using Discord's setTimeout.
    const timeoutId = setTimeout(async () => {
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

        // We update the reminder status to completed.
        await query(`
          UPDATE recovery 
          SET status = 'completed' 
          WHERE id = $1
        `, [reminderId]);

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

    logger.info("Scheduled bump reminder:", { 
      channelId, 
      scheduledTime: scheduledTime.toISOString() 
    });

    return reminderId;
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
      SELECT id, channel_id, scheduled_time
      FROM recovery
      WHERE type = 'reminder'
      AND status = 'pending'
      AND scheduled_time > NOW()
    `);

    let rescheduledCount = 0;
    for (const row of result.rows) {
      try {
        const scheduledTime = new Date(row.scheduled_time);
        
        // We only reschedule future reminders.
        if (scheduledTime > new Date()) {
          await scheduleReminder(client, row.channel_id, scheduledTime);
          rescheduledCount++;
        }
      } catch (error) {
        logger.error("Failed to reschedule reminder:", { 
          error,
          reminderId: row.id 
        });
        Sentry.captureException(error, {
          extra: { 
            function: 'rescheduleReminder',
            reminderId: row.id
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

/**
 * We clean up old reminder records from the database.
 * This prevents the database from growing too large with completed reminders.
 * 
 * @param {string} channelId - The Discord channel ID.
 * @param {string} messageId - The message ID that was just edited/handled.
 */
async function cleanupOldReminders(channelId, messageId) {
  try {
    await query(`
      DELETE FROM recovery 
      WHERE channel_id = $1 
      AND type = 'reminder'
      AND status = 'completed'
      AND scheduled_time < NOW() - INTERVAL '1 day'
    `, [channelId]);
    
    logger.debug("Cleaned up old reminder records", { channelId });
  } catch (err) {
    logger.error("Error cleaning up old reminders:", { error: err });
  }
}

module.exports = { 
  scheduleReminder, 
  rescheduleReminder, 
  cleanupOldReminders 
};
