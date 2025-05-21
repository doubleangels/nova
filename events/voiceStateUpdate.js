const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { Pool } = require('pg');
const config = require('../config');
const { randomUUID } = require('crypto');
const { addVoiceSessionToStats, addVoiceSessionToChannelStats } = require('../utils/database');

// We set up a connection pool for direct SQL queries to the database.
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

/**
 * We handle voice state changes in the server.
 * This function manages voice channel sessions and statistics.
 *
 * We perform several tasks for each voice state change:
 * 1. We track when users join voice channels.
 * 2. We record when users leave voice channels.
 * 3. We handle channel switching events.
 * 4. We maintain voice session statistics.
 *
 * @param {VoiceState} oldState - The previous voice state.
 * @param {VoiceState} newState - The new voice state.
 */
module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      // We ignore voice state changes from bot accounts.
      if (oldState.member.user.bot) return;

      // We handle users joining a voice channel.
      if (!oldState.channelId && newState.channelId) {
        await pool.query(
          `INSERT INTO main.voice_recovery (session_id, user_id, guild_id, channel_id, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), newState.member.id, newState.guild.id, newState.channelId]
        );
        logger.info("Started voice session:", { userId: newState.member.id, guildId: newState.guild.id, channelId: newState.channelId });
      }

      // We handle users leaving a voice channel.
      if (oldState.channelId && !newState.channelId) {
        await pool.query(
          `UPDATE main.voice_recovery
           SET ended_at = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at)), is_active = FALSE
           WHERE session_id = (
             SELECT session_id FROM main.voice_recovery
             WHERE user_id = $1 AND guild_id = $2 AND is_active = TRUE
             ORDER BY started_at DESC
             LIMIT 1
           )`,
          [oldState.member.id, oldState.guild.id]
        );
        // We update voice statistics and clean up the session.
        const { rows } = await pool.query(
          `SELECT session_id, duration_seconds, channel_id FROM main.voice_recovery
           WHERE user_id = $1 AND guild_id = $2 AND is_active = FALSE
           ORDER BY ended_at DESC LIMIT 1`,
          [oldState.member.id, oldState.guild.id]
        );
        if (rows.length && rows[0].duration_seconds) {
          await addVoiceSessionToStats(
            oldState.member.id,
            oldState.member.user.tag,
            rows[0].duration_seconds
          );
          // We add the session to channel-specific statistics.
          let channelName = '';
          try {
            const channelObj = oldState.guild.channels.cache.get(String(rows[0].channel_id));
            channelName = channelObj ? channelObj.name : '';
          } catch {}
          if (rows[0].channel_id) {
            await addVoiceSessionToChannelStats(
              rows[0].channel_id,
              channelName,
              rows[0].duration_seconds
            );
          }
          await pool.query(
            `DELETE FROM main.voice_recovery WHERE session_id = $1`,
            [rows[0].session_id]
          );
        }
        logger.info("Ended voice session:", { userId: oldState.member.id, guildId: oldState.guild.id, channelId: oldState.channelId });
      }

      // We handle users switching between voice channels.
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        // We end the previous voice session.
        await pool.query(
          `UPDATE main.voice_recovery
           SET ended_at = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at)), is_active = FALSE
           WHERE session_id = (
             SELECT session_id FROM main.voice_recovery
             WHERE user_id = $1 AND guild_id = $2 AND is_active = TRUE
             ORDER BY started_at DESC
             LIMIT 1
           )`,
          [oldState.member.id, oldState.guild.id]
        );
        // We update statistics and clean up the old session.
        const { rows } = await pool.query(
          `SELECT session_id, duration_seconds, channel_id FROM main.voice_recovery
           WHERE user_id = $1 AND guild_id = $2 AND is_active = FALSE
           ORDER BY ended_at DESC LIMIT 1`,
          [oldState.member.id, oldState.guild.id]
        );
        if (rows.length && rows[0].duration_seconds) {
          await addVoiceSessionToStats(
            oldState.member.id,
            oldState.member.user.tag,
            rows[0].duration_seconds
          );
          // We add the session to channel-specific statistics.
          let channelName = '';
          try {
            const channelObj = oldState.guild.channels.cache.get(String(rows[0].channel_id));
            channelName = channelObj ? channelObj.name : '';
          } catch {}
          if (rows[0].channel_id) {
            await addVoiceSessionToChannelStats(
              rows[0].channel_id,
              channelName,
              rows[0].duration_seconds
            );
          }
          await pool.query(
            `DELETE FROM main.voice_recovery WHERE session_id = $1`,
            [rows[0].session_id]
          );
        }
        // We start a new voice session for the new channel.
        await pool.query(
          `INSERT INTO main.voice_recovery (session_id, user_id, guild_id, channel_id, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), newState.member.id, newState.guild.id, newState.channelId]
        );
        logger.info("Switched voice session:", { userId: newState.member.id, guildId: newState.guild.id, channelId: newState.channelId });
      }

      // We can add additional tracking for mute/deafen/streaming states if needed.

    } catch (error) {
      logger.error(`Error processing voice state update for ${oldState.member.user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
    }
  }
}; 