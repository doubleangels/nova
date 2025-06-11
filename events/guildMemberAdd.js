/**
 * Event handler for when a new member joins the guild.
 * Tracks new members and handles mute mode functionality.
 * @module events/guildMemberAdd
 */

const { EmbedBuilder, Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { getValue, trackNewMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const { checkAccountAge, performKick } = require('../utils/trollModeUtils');
const { logError } = require('../errors');

const MEMBER_ADD_EMBED_COLOR = 0xCD41FF;

const MEMBER_ADD_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing the new member.";
const MEMBER_ADD_ERROR_JOIN_FAILED = "⚠️ Failed to process new member join.";
const MEMBER_ADD_ERROR_TRACKING = "⚠️ Failed to track new member data.";
const MEMBER_ADD_ERROR_MUTE_KICK = "⚠️ Failed to schedule mute kick for new member.";
const MEMBER_ADD_ERROR_DATABASE = "⚠️ Database error occurred while processing new member.";
const MEMBER_ADD_ERROR_PERMISSION = "⚠️ Insufficient permissions to process new member.";
const MEMBER_ADD_ERROR_INVALID = "⚠️ Invalid member data received.";
const MEMBER_ADD_ERROR_AGE_CHECK = "⚠️ Failed to verify account age.";
const MEMBER_ADD_ERROR_KICK = "⚠️ Failed to kick member due to age requirement.";

/**
 * Event handler for guild member join events.
 * @type {Object}
 */
module.exports = {
  name: Events.GuildMemberAdd,
  /**
   * Executes when a new member joins the guild.
   * @async
   * @function execute
   * @param {GuildMember} member - The member that joined
   * @throws {Error} If member tracking or mute kick scheduling fails
   */
  async execute(member) {
    try {
      logger.info(`New member joined: ${member.user.tag}`);

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
      logger.error('Error processing new member:', {
        error: error.stack,
        message: error.message,
        userId: member.user.id
      });

      let errorMessage = MEMBER_ADD_ERROR_UNEXPECTED;
      
      if (error.message === MEMBER_ADD_ERROR_TRACKING) {
        errorMessage = MEMBER_ADD_ERROR_TRACKING;
      } else if (error.message === MEMBER_ADD_ERROR_MUTE_KICK) {
        errorMessage = MEMBER_ADD_ERROR_MUTE_KICK;
      } else if (error.message === MEMBER_ADD_ERROR_DATABASE) {
        errorMessage = MEMBER_ADD_ERROR_DATABASE;
      } else if (error.message === MEMBER_ADD_ERROR_PERMISSION) {
        errorMessage = MEMBER_ADD_ERROR_PERMISSION;
      } else if (error.message === MEMBER_ADD_ERROR_INVALID) {
        errorMessage = MEMBER_ADD_ERROR_INVALID;
      } else if (error.message === MEMBER_ADD_ERROR_AGE_CHECK) {
        errorMessage = MEMBER_ADD_ERROR_AGE_CHECK;
      } else if (error.message === MEMBER_ADD_ERROR_KICK) {
        errorMessage = MEMBER_ADD_ERROR_KICK;
      }
      
      throw new Error(errorMessage);
    }
  }
};