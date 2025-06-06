/**
 * Event handler for voice state updates in Discord.
 * Handles voice channel events, mute status changes, and voice activity tracking.
 * @module events/voiceStateUpdate
 */

const path = require('path');
const logger = require('../logger')('voiceStateUpdate.js');
const { Pool } = require('pg');
const config = require('../config');
const { randomUUID } = require('crypto');
const { addVoiceSessionToStats, addVoiceSessionToChannelStats } = require('../utils/database');
const { logError, ERROR_MESSAGES } = require('../errors');
const Sentry = require('../sentry');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

/**
 * Event handler for voice state update events.
 * @type {Object}
 */
module.exports = {
  name: 'voiceStateUpdate',
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

      logger.info(`Processing voice state update for user ${newState.member.user.tag}`);
      
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
      Sentry.captureException(error, {
        extra: {
          event: 'voiceStateUpdate',
          userId: newState.member.user.id,
          guildId: newState.guild.id,
          channelId: newState.channelId
        }
      });
      logger.error(`Error processing voice state update:`, {
        error: error.message,
        stack: error.stack
      });
      
      logError(error, 'voiceStateUpdate', {
        userId: newState.member.user.id,
        guildId: newState.guild.id,
        channelId: newState.channelId
      });
      throw new Error(ERROR_MESSAGES.VOICE_STATE_UPDATE_FAILED);
    }
  }
}; 