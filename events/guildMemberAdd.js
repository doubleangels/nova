/**
 * Event handler for when a new member joins the guild.
 * Tracks new members and handles mute mode functionality.
 * @module events/guildMemberAdd
 */

const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')('guildMemberAdd.js');
const dayjs = require('dayjs');
const { getValue, trackNewMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const { checkAccountAge, performKick } = require('../utils/trollModeUtils');
const Sentry = require('../sentry');
const { logError } = require('../errors');

/**
 * Error messages specific to the guild member add event.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while processing the new member.",
    MEMBER_JOIN_FAILED: "⚠️ Failed to process new member join.",
    TRACKING_FAILED: "⚠️ Failed to track new member data.",
    MUTE_KICK_FAILED: "⚠️ Failed to schedule mute kick for new member.",
    DATABASE_ERROR: "⚠️ Database error occurred while processing new member.",
    PERMISSION_DENIED: "⚠️ Insufficient permissions to process new member.",
    INVALID_MEMBER: "⚠️ Invalid member data received.",
    ACCOUNT_AGE_CHECK_FAILED: "⚠️ Failed to verify account age.",
    KICK_FAILED: "⚠️ Failed to kick member due to age requirement."
};

const WELCOME_EMBED_COLOR = 0xCD41FF;

/**
 * Event handler for guild member join events.
 * @type {Object}
 */
module.exports = {
  name: 'guildMemberAdd',
  /**
   * Executes when a new member joins the guild.
   * @async
   * @function execute
   * @param {GuildMember} member - The member that joined
   * @throws {Error} If member tracking or mute kick scheduling fails
   */
  async execute(member) {
    try {
      logger.info(`New member joined: ${member.user.tag} (ID: ${member.id})`);

      const meetsAgeRequirement = await checkAccountAge(member);
      if (!meetsAgeRequirement) {
        await performKick(member);
        return;
      }

      await trackNewMember(
        member.id,
        member.user.username,
        member.joinedAt.toISOString()
      );
      logger.debug(`Tracked new member: ${member.user.tag}`);

      const muteModeEnabled = await getValue('mute_mode_enabled');
      if (muteModeEnabled) {
        const muteKickTime = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
        
        await scheduleMuteKick(
          member.id,
          member.user.username,
          member.joinedAt.toISOString(),
          muteKickTime,
          member.guild.id,
          member.client
        );
        logger.info(`Scheduled mute kick for new member: ${member.user.tag}.`);
      }

      logger.info(`Successfully processed new member: ${member.user.tag}.`);
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          event: 'guildMemberAdd',
          memberId: member.id,
          memberTag: member.user.tag,
          guildId: member.guild.id
        }
      });
      logger.error(`Error processing new member ${member.user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
      
      logError(error, 'guildMemberAdd', {
        memberId: member.id,
        memberTag: member.user.tag,
        guildId: member.guild.id
      });

      let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
      
      if (error.message === "TRACKING_FAILED") {
        errorMessage = ERROR_MESSAGES.TRACKING_FAILED;
      } else if (error.message === "MUTE_KICK_FAILED") {
        errorMessage = ERROR_MESSAGES.MUTE_KICK_FAILED;
      } else if (error.message === "DATABASE_ERROR") {
        errorMessage = ERROR_MESSAGES.DATABASE_ERROR;
      } else if (error.message === "PERMISSION_DENIED") {
        errorMessage = ERROR_MESSAGES.PERMISSION_DENIED;
      } else if (error.message === "INVALID_MEMBER") {
        errorMessage = ERROR_MESSAGES.INVALID_MEMBER;
      } else if (error.message === "ACCOUNT_AGE_CHECK_FAILED") {
        errorMessage = ERROR_MESSAGES.ACCOUNT_AGE_CHECK_FAILED;
      } else if (error.message === "KICK_FAILED") {
        errorMessage = ERROR_MESSAGES.KICK_FAILED;
      }
      
      throw new Error(errorMessage);
    }
  }
};