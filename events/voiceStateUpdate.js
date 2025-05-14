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
 * Event handler for the 'voiceStateUpdate' event.
 * We track when users join and leave voice channels to calculate time spent.
 * 
 * @param {VoiceState} oldState - The previous voice state.
 * @param {VoiceState} newState - The new voice state.
 */
module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      // We ignore bot users
      if (newState.member.user.bot) return;

      const userId = newState.member.id;
      const username = newState.member.user.tag;
      const guildName = newState.guild.name;

      // User joined a voice channel
      if (!oldState.channelId && newState.channelId) {
        const joinTime = Date.now();
        voiceJoinTimes.set(userId, joinTime);
        await saveVoiceJoinTimes(); // Save state after update
        
        // Log detailed join information
        logger.info("User joined voice channel:", {
          userId,
          username,
          guildName,
          channelName: newState.channel.name,
          channelId: newState.channelId,
          timestamp: new Date(joinTime).toISOString(),
          selfMute: newState.selfMute,
          selfDeaf: newState.selfDeaf,
          serverMute: newState.serverMute,
          serverDeaf: newState.serverDeaf
        });
      }
      // User left a voice channel
      else if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceJoinTimes.get(userId);
        if (joinTime) {
          const timeSpent = Math.floor((Date.now() - joinTime) / (1000 * 60)); // Convert to minutes
          if (timeSpent > 0) {
            await updateVoiceTime(userId, username, timeSpent);
            
            // Log detailed leave information
            logger.info("User left voice channel:", {
              userId,
              username,
              guildName,
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
          voiceJoinTimes.delete(userId);
          await saveVoiceJoinTimes(); // Save state after update
        }
      }
      // User switched voice channels
      else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const joinTime = voiceJoinTimes.get(userId);
        if (joinTime) {
          const timeSpent = Math.floor((Date.now() - joinTime) / (1000 * 60));
          if (timeSpent > 0) {
            await updateVoiceTime(userId, username, timeSpent);
            
            // Log detailed channel switch information
            logger.info("User switched voice channels:", {
              userId,
              username,
              guildName,
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
        voiceJoinTimes.set(userId, newJoinTime);
        await saveVoiceJoinTimes(); // Save state after update
      }
    } catch (error) {
      logger.error("Error in voiceStateUpdate event:", { error });
      Sentry.captureException(error, {
        extra: {
          userId: newState.member.id,
          oldChannelId: oldState.channelId,
          newChannelId: newState.channelId
        }
      });
    }
  }
};

// Export the load function so it can be called on bot startup
module.exports.loadVoiceJoinTimes = loadVoiceJoinTimes; 