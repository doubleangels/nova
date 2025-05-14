const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { updateVoiceTime, getValue, setValue } = require('../utils/database');
const Sentry = require('../sentry');
const { Pool } = require('pg');
const config = require('../config');
const { randomUUID } = require('crypto');

// Setup a pool for direct SQL queries
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// We store the join times for users in voice channels
const voiceJoinTimes = new Map();

/**
 * Loads voice join times from the recovery table on bot startup.
 * We ensure we don't lose track of users who were in voice when the bot restarted.
 */
async function loadVoiceJoinTimes() {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, join_time FROM main.voice_recovery WHERE type = 'voice_join'`
    );
    
    for (const row of rows) {
      voiceJoinTimes.set(row.user_id, row.join_time);
    }
    
    logger.info(`Loaded ${voiceJoinTimes.size} voice join times from voice_recovery table`);
  } catch (error) {
    logger.error("Error loading voice join times:", { error });
    Sentry.captureException(error, {
      extra: {
        function: 'loadVoiceJoinTimes'
      }
    });
  }
}

/**
 * Saves voice join times to the recovery table.
 * We ensure we can recover the state if the bot restarts.
 */
async function saveVoiceJoinTimes() {
  try {
    // First, clear existing voice join times
    await pool.query(
      `DELETE FROM main.voice_recovery WHERE type = 'voice_join'`
    );
    
    // Then insert all current voice join times
    for (const [userId, joinTime] of voiceJoinTimes.entries()) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO main.voice_recovery (id, type, user_id, join_time) 
         VALUES ($1, 'voice_join', $2, to_timestamp($3 / 1000.0) AT TIME ZONE 'UTC')`,
        [id, userId, joinTime]
      );
    }
  } catch (error) {
    logger.error("Error saving voice join times:", { error });
    Sentry.captureException(error, {
      extra: {
        function: 'saveVoiceJoinTimes'
      }
    });
  }
}

/**
 * We handle voice state changes in the server.
 * This function manages voice channel events and tracking.
 *
 * We perform several tasks for each voice state change:
 * 1. Track voice channel joins and leaves
 * 2. Handle voice channel moderation
 * 3. Update user voice statistics
 *
 * @param {VoiceState} oldState - The previous voice state
 * @param {VoiceState} newState - The new voice state
 */
module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      // We ignore state changes from bots.
      if (oldState.member.user.bot) return;

      // We handle voice channel joins.
      if (!oldState.channelId && newState.channelId) {
        logger.debug(`User ${oldState.member.user.tag} joined voice channel ${newState.channel.name}`);
        // We track voice channel joins here.
        const joinTime = Date.now();
        voiceJoinTimes.set(oldState.member.id, joinTime);
        await saveVoiceJoinTimes(); // Save state after update
        
        // Log detailed join information
        logger.info("User joined voice channel:", {
          userId: oldState.member.id,
          username: oldState.member.user.tag,
          guildName: newState.guild.name,
          channelName: newState.channel.name,
          channelId: newState.channelId,
          timestamp: new Date(joinTime).toISOString(),
          selfMute: newState.selfMute,
          selfDeaf: newState.selfDeaf,
          serverMute: newState.serverMute,
          serverDeaf: newState.serverDeaf
        });
      }

      // We handle voice channel leaves.
      if (oldState.channelId && !newState.channelId) {
        logger.debug(`User ${oldState.member.user.tag} left voice channel ${oldState.channel.name}`);
        // We track voice channel leaves here.
        const joinTime = voiceJoinTimes.get(oldState.member.id);
        if (joinTime) {
          const timeSpent = Math.floor((Date.now() - joinTime) / (1000 * 60)); // Convert to minutes
          if (timeSpent > 0) {
            await updateVoiceTime(oldState.member.id, oldState.member.user.tag, timeSpent);
            
            // Log detailed leave information
            logger.info("User left voice channel:", {
              userId: oldState.member.id,
              username: oldState.member.user.tag,
              guildName: newState.guild.name,
              channelName: oldState.channel.name,
              channelId: oldState.channelId,
              timeSpentMinutes: timeSpent,
              timestamp: new Date().toISOString(),
              selfMute: oldState.selfMute,
              selfDeaf: oldState.selfDeaf,
              serverMute: oldState.serverMute,
              serverDeaf: oldState.serverDeaf
            });
          }
          voiceJoinTimes.delete(oldState.member.id);
          await saveVoiceJoinTimes(); // Save state after update
        }
      }

      // We handle voice channel switches.
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        logger.debug(`User ${oldState.member.user.tag} switched from ${oldState.channel.name} to ${newState.channel.name}`);
        // We track voice channel switches here.
        const joinTime = voiceJoinTimes.get(oldState.member.id);
        if (joinTime) {
          const timeSpent = Math.floor((Date.now() - joinTime) / (1000 * 60));
          if (timeSpent > 0) {
            await updateVoiceTime(oldState.member.id, oldState.member.user.tag, timeSpent);
            
            // Log detailed channel switch information
            logger.info("User switched voice channels:", {
              userId: oldState.member.id,
              username: oldState.member.user.tag,
              guildName: newState.guild.name,
              oldChannelName: oldState.channel.name,
              oldChannelId: oldState.channelId,
              newChannelName: newState.channel.name,
              newChannelId: newState.channelId,
              timeSpentMinutes: timeSpent,
              timestamp: new Date().toISOString(),
              selfMute: newState.selfMute,
              selfDeaf: newState.selfDeaf,
              serverMute: newState.serverMute,
              serverDeaf: newState.serverDeaf
            });
          }
        }
        const newJoinTime = Date.now();
        voiceJoinTimes.set(oldState.member.id, newJoinTime);
        await saveVoiceJoinTimes(); // Save state after update
      }

      // We handle mute state changes.
      if (oldState.mute !== newState.mute) {
        logger.debug(`User ${oldState.member.user.tag} ${newState.mute ? 'muted' : 'unmuted'} in ${newState.channel?.name || 'no channel'}`);
        // We track mute state changes here.
      }

      // We handle deafen state changes.
      if (oldState.deaf !== newState.deaf) {
        logger.debug(`User ${oldState.member.user.tag} ${newState.deaf ? 'deafened' : 'undeafened'} in ${newState.channel?.name || 'no channel'}`);
        // We track deafen state changes here.
      }

      // We handle streaming state changes.
      if (oldState.streaming !== newState.streaming) {
        logger.debug(`User ${oldState.member.user.tag} ${newState.streaming ? 'started' : 'stopped'} streaming in ${newState.channel?.name || 'no channel'}`);
        // We track streaming state changes here.
      }

    } catch (error) {
      logger.error(`Error processing voice state update for ${oldState.member.user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
      Sentry.captureException(error, {
        extra: {
          userId: oldState.member.id,
          oldChannelId: oldState.channelId,
          newChannelId: newState.channelId
        }
      });
    }
  }
};

// Export the load function so it can be called on bot startup
module.exports.loadVoiceJoinTimes = loadVoiceJoinTimes; 