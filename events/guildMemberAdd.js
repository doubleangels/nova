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
const { logError, ERROR_MESSAGES } = require('../errors');

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

      // Check troll mode first
      const meetsAgeRequirement = await checkAccountAge(member);
      if (!meetsAgeRequirement) {
        await performKick(member);
        return; // Don't proceed with other checks if kicked
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
      throw new Error(ERROR_MESSAGES.MEMBER_JOIN_FAILED);
    }
  }
};