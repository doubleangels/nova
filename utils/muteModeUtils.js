const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { query, queryOne } = require('./database');
const Sentry = require('../sentry');

/**
 * We schedule a mute kick for a member who hasn't sent a message.
 * This ensures members are removed if they don't verify themselves.
 * 
 * @param {Client} client - The Discord client instance.
 * @param {string} memberId - The ID of the member to monitor.
 * @param {string} guildId - The ID of the guild where the member is.
 * @param {Date} kickTime - When to kick the member if they haven't sent a message.
 * @returns {Promise<string>} The ID of the scheduled kick.
 */
async function scheduleMuteKick(client, memberId, guildId, kickTime) {
  try {
    // We create a unique key for this kick.
    const key = `mute_kick_${memberId}_${guildId}`;
    
    // We schedule the kick using Discord's setTimeout.
    const kickId = setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) {
          logger.error("Guild not found for mute kick:", { guildId });
          return;
        }

        const member = await guild.members.fetch(memberId);
        if (!member) {
          logger.error("Member not found for mute kick:", { memberId });
          return;
        }

        // We check if the member has sent any messages.
        const result = await query(`
          SELECT message_count 
          FROM message_counts 
          WHERE member_id = $1
        `, [memberId]);

        if (result.rows.length === 0 || result.rows[0].message_count === 0) {
          // We kick the member if they haven't sent any messages.
          await member.kick('No message sent during mute mode verification period.');
          logger.info("Kicked member for not sending a message:", { 
            memberId,
            guildId
          });
        }
      } catch (error) {
        logger.error("Error executing mute kick:", { error });
        Sentry.captureException(error, {
          extra: { 
            function: 'scheduleMuteKick',
            memberId,
            guildId
          }
        });
      }
    }, kickTime.getTime() - Date.now());

    // We store the kick data in the database.
    await query(`
      INSERT INTO tracked_members (key, kick_time, kick_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE 
      SET kick_time = $2, kick_id = $3
    `, [key, kickTime.toISOString(), kickId.toString()]);

    logger.info("Scheduled mute kick:", { 
      memberId,
      guildId,
      kickTime: kickTime.toISOString()
    });

    return kickId.toString();
  } catch (error) {
    logger.error("Failed to schedule mute kick:", { error });
    Sentry.captureException(error, {
      extra: { 
        function: 'scheduleMuteKick',
        memberId,
        guildId
      }
    });
    throw error;
  }
}

/**
 * We reschedule all mute kicks from the database after a bot restart.
 * This ensures no kicks are lost when the bot restarts.
 * 
 * @param {Client} client - The Discord client instance.
 */
async function rescheduleAllMuteKicks(client) {
  try {
    // We get all active kicks from the database.
    const result = await query(`
      SELECT key, kick_time, kick_id
      FROM tracked_members
      WHERE kick_time > NOW()
    `);

    let rescheduledCount = 0;
    for (const row of result.rows) {
      try {
        const [memberId, guildId] = row.key.replace('mute_kick_', '').split('_');
        const kickTime = new Date(row.kick_time);
        
        // We only reschedule future kicks.
        if (kickTime > new Date()) {
          await scheduleMuteKick(client, memberId, guildId, kickTime);
          rescheduledCount++;
        }
      } catch (error) {
        logger.error("Failed to reschedule mute kick:", { 
          error,
          key: row.key 
        });
        Sentry.captureException(error, {
          extra: { 
            function: 'rescheduleAllMuteKicks',
            key: row.key
          }
        });
      }
    }

    logger.info(`Rescheduled ${rescheduledCount} mute kicks.`);
  } catch (error) {
    logger.error("Failed to reschedule mute kicks:", { error });
    Sentry.captureException(error, {
      extra: { function: 'rescheduleAllMuteKicks' }
    });
    throw error;
  }
}

// We export our mute mode utility functions.
module.exports = {
  scheduleMuteKick,
  rescheduleAllMuteKicks
};
