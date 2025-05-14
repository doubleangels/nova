const { Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { query, queryOne } = require('../utils/database');
const Sentry = require('../sentry');

// We store voice join times in memory for quick access during voice state updates.
const voiceJoinTimes = new Map();

/**
 * We load voice join times from the database to maintain voice tracking across bot restarts.
 * This ensures we don't lose track of users who were in voice channels when the bot restarted.
 */
async function loadVoiceJoinTimes() {
  try {
    const result = await query(`
      SELECT user_id, joined_at 
      FROM recovery 
      WHERE left_at IS NULL
    `);
    
    for (const row of result.rows) {
      voiceJoinTimes.set(row.user_id, new Date(row.joined_at));
    }
    
    logger.info(`Loaded ${result.rows.length} voice join times from database.`);
  } catch (error) {
    logger.error("Failed to load voice join times:", { error });
    Sentry.captureException(error, {
      extra: { function: 'loadVoiceJoinTimes' }
    });
  }
}

/**
 * We handle voice state updates to track when users join and leave voice channels.
 * This allows us to calculate voice time and maintain accurate voice activity records.
 * 
 * @param {VoiceState} oldState - The previous voice state of the user.
 * @param {VoiceState} newState - The new voice state of the user.
 */
module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    try {
      const userId = newState.member.id;
      const guildId = newState.guild.id;
      
      // We handle the case when a user joins a voice channel.
      if (!oldState.channelId && newState.channelId) {
        const now = new Date();
        voiceJoinTimes.set(userId, now);
        
        try {
          await query(`
            INSERT INTO recovery (id, user_id, guild_id, joined_at)
            VALUES (gen_random_uuid(), $1, $2, $3)
          `, [userId, guildId, now]);
          
          logger.debug("User joined voice channel:", { 
            userId, 
            guildId, 
            channelId: newState.channelId 
          });
        } catch (error) {
          logger.error("Failed to record voice join time:", { error });
          Sentry.captureException(error, {
            extra: { 
              function: 'voiceStateUpdate',
              action: 'join',
              userId,
              guildId
            }
          });
        }
      }
      
      // We handle the case when a user leaves a voice channel.
      if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceJoinTimes.get(userId);
        if (joinTime) {
          const now = new Date();
          const duration = now - joinTime;
          voiceJoinTimes.delete(userId);
          
          try {
            await query(`
              UPDATE recovery 
              SET left_at = $1, duration = $2
              WHERE user_id = $3 
              AND guild_id = $4 
              AND left_at IS NULL
            `, [now, duration, userId, guildId]);
            
            // Add/update time tracked in voice_time table
            const minutesSpent = Math.round(duration / 60000);
            const username = newState.member.user.username;
            const memberId = userId;
            const lastUpdated = now;
            try {
              await query(`
                INSERT INTO voice_time (member_id, username, minutes_spent, last_updated)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (member_id) DO UPDATE
                SET 
                  username = EXCLUDED.username,
                  minutes_spent = voice_time.minutes_spent + EXCLUDED.minutes_spent,
                  last_updated = EXCLUDED.last_updated
              `, [memberId, username, minutesSpent, lastUpdated]);
              logger.debug("Updated voice_time table:", { memberId, username, minutesSpent, lastUpdated });
            } catch (error) {
              logger.error("Failed to update voice_time table:", { error });
              Sentry.captureException(error, {
                extra: { function: 'voiceStateUpdate', action: 'voice_time_upsert', memberId }
              });
            }
            
            logger.debug("User left voice channel:", { 
              userId, 
              guildId, 
              duration 
            });
          } catch (error) {
            logger.error("Failed to record voice leave time:", { error });
            Sentry.captureException(error, {
              extra: { 
                function: 'voiceStateUpdate',
                action: 'leave',
                userId,
                guildId
              }
            });
          }
        }
      }
    } catch (error) {
      logger.error("Error in voice state update:", { error });
      Sentry.captureException(error, {
        extra: { 
          function: 'voiceStateUpdate',
          userId: newState.member.id,
          guildId: newState.guild.id
        }
      });
    }
  }
};

// We export the loadVoiceJoinTimes function for use in the ready event.
module.exports.loadVoiceJoinTimes = loadVoiceJoinTimes; 