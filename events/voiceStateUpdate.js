/**
 * Event handler for voice state updates in Discord.
 * Handles voice channel events, mute status changes, and voice activity tracking.
 * @module events/voiceStateUpdate
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { Pool } = require('pg');
const config = require('../config');
const { randomUUID } = require('crypto');
const { addVoiceSessionToStats, addVoiceSessionToChannelStats } = require('../utils/database');
const { logError } = require('../errors');
const { Events } = require('discord.js');

const VOICE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing voice state update.";
const VOICE_ERROR_STATE_UPDATE = "⚠️ Failed to process voice state update.";
const VOICE_ERROR_DATABASE = "⚠️ Database error occurred while processing voice state.";
const VOICE_ERROR_SESSION_START = "⚠️ Failed to start voice session.";
const VOICE_ERROR_SESSION_END = "⚠️ Failed to end voice session.";
const VOICE_ERROR_SESSION_SWITCH = "⚠️ Failed to switch voice session.";
const VOICE_ERROR_STATS_UPDATE = "⚠️ Failed to update voice statistics.";
const VOICE_ERROR_CHANNEL_STATS = "⚠️ Failed to update channel statistics.";
const VOICE_ERROR_PERMISSION = "⚠️ Insufficient permissions to process voice state.";
const VOICE_ERROR_INVALID_STATE = "⚠️ Invalid voice state data received.";
const VOICE_ERROR_RECOVERY = "⚠️ Failed to recover voice session data.";

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

/**
 * Event handler for voice state update events.
 * @type {Object}
 */
module.exports = {
  name: Events.VoiceStateUpdate,
  /**
   * Executes when a voice state is updated.
   * @async
   * @function execute
   * @param {VoiceState} oldState - The voice state before the update
   * @param {VoiceState} newState - The voice state after the update
   * @throws {Error} If voice state processing fails
   */
  async execute(oldState, newState) {
    try {
      if (oldState.member.user.bot || newState.member.user.bot) {
        logger.debug('Bot voice state change, ignoring');
        return;
      }

      logger.debug(`Processing voice state update for ${newState.member.user.tag}`);
      
      if (!oldState.channelId && newState.channelId) {
        await pool.query(
          `INSERT INTO main.voice_recovery (session_id, user_id, guild_id, channel_id, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), newState.member.id, newState.guild.id, newState.channelId]
        );
        logger.info("Started voice session:", { userId: newState.member.id, guildId: newState.guild.id, channelId: newState.channelId });
      }

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

      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
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
        await pool.query(
          `INSERT INTO main.voice_recovery (session_id, user_id, guild_id, channel_id, started_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), newState.member.id, newState.guild.id, newState.channelId]
        );
        logger.info("Switched voice session:", { userId: newState.member.id, guildId: newState.guild.id, channelId: newState.channelId });
      }

      logger.info(`Successfully processed voice state update for ${newState.member.user.tag}`);

    } catch (error) {
      logger.error('Error processing voice state update:', {
        error: error.stack,
        message: error.message,
        userId: newState.member.user.id
      });
      
      logError(error, 'voiceStateUpdate', {
        userId: newState.member.user.id,
        guildId: newState.guild.id,
        channelId: newState.channelId
      });

      let errorMessage = VOICE_ERROR_UNEXPECTED;
      
      if (error.message === "DATABASE_ERROR") {
        errorMessage = VOICE_ERROR_DATABASE;
      } else if (error.message === "SESSION_START_FAILED") {
        errorMessage = VOICE_ERROR_SESSION_START;
      } else if (error.message === "SESSION_END_FAILED") {
        errorMessage = VOICE_ERROR_SESSION_END;
      } else if (error.message === "SESSION_SWITCH_FAILED") {
        errorMessage = VOICE_ERROR_SESSION_SWITCH;
      } else if (error.message === "STATS_UPDATE_FAILED") {
        errorMessage = VOICE_ERROR_STATS_UPDATE;
      } else if (error.message === "CHANNEL_STATS_UPDATE_FAILED") {
        errorMessage = VOICE_ERROR_CHANNEL_STATS;
      } else if (error.message === "PERMISSION_DENIED") {
        errorMessage = VOICE_ERROR_PERMISSION;
      } else if (error.message === "INVALID_STATE") {
        errorMessage = VOICE_ERROR_INVALID_STATE;
      } else if (error.message === "RECOVERY_FAILED") {
        errorMessage = VOICE_ERROR_RECOVERY;
      }
      
      throw new Error(errorMessage);
    }
  }
}; 