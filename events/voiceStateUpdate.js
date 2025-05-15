const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { Pool } = require('pg');
const config = require('../config');
const { randomUUID } = require('crypto');
const { addVoiceSessionToStats, addVoiceSessionToChannelStats } = require('../utils/database');

// Setup a pool for direct SQL queries
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// Handle voice state changes
module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      // Ignore bots
      if (oldState.member.user.bot) return;

      // User joins a voice channel
      if (!oldState.channelId && newState.channelId) {
        await pool.query(
          `INSERT INTO main.voice_recovery (session_id, user_id, guild_id, channel_id, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), newState.member.id, newState.guild.id, newState.channelId]
        );
        logger.info("Started voice session", { userId: newState.member.id, guildId: newState.guild.id, channelId: newState.channelId });
      }

      // User leaves a voice channel
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
        // Update stats and clean up
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
          // Add to channel stats
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
        logger.info("Ended voice session", { userId: oldState.member.id, guildId: oldState.guild.id, channelId: oldState.channelId });
      }

      // User switches channels
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        // End the old session
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
        // Update stats and clean up
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
          // Add to channel stats
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
        // Start a new session
        await pool.query(
          `INSERT INTO main.voice_recovery (session_id, user_id, guild_id, channel_id, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), newState.member.id, newState.guild.id, newState.channelId]
        );
        logger.info("Switched voice session", { userId: newState.member.id, guildId: newState.guild.id, channelId: newState.channelId });
      }

      // (Optional) Add mute/deafen/streaming tracking here if desired

    } catch (error) {
      logger.error(`Error processing voice state update for ${oldState.member.user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
    }
  }
}; 