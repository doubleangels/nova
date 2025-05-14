const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')('guildMemberAdd.js');
const dayjs = require('dayjs');
const { getValue, trackNewMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const Sentry = require('../sentry');

// We use this color for welcome embeds to maintain visual consistency.
const WELCOME_EMBED_COLOR = 0xCD41FF;

/**
 * We handle new members joining the server.
 * This function manages the initial setup and tracking of new members.
 *
 * We perform several tasks when a member joins:
 * 1. Track the member in the database
 * 2. Schedule a mute kick if mute mode is enabled
 * 3. Log the member's join information
 *
 * @param {GuildMember} member - The member that joined the server
 */
module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      // We log the member's join information.
      logger.info(`New member joined: ${member.user.tag} (ID: ${member.id})`);

      // We track the new member in our database.
      await trackNewMember(
        member.id,
        member.user.username,
        member.joinedAt.toISOString()
      );
      logger.debug(`Tracked new member: ${member.user.tag}`);

      // We check if mute mode is enabled.
      const muteModeEnabled = await getValue('mute_mode_enabled');
      if (muteModeEnabled) {
        // We get the configured mute kick time.
        const muteKickTime = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
        
        // We schedule a mute kick for the new member.
        await scheduleMuteKick(
          member.id,
          member.user.username,
          member.joinedAt.toISOString(),
          muteKickTime,
          member.guild.id,
          member.client
        );
        logger.info(`Scheduled mute kick for new member: ${member.user.tag}`);
      }

      logger.info(`Successfully processed new member: ${member.user.tag}`);
    } catch (error) {
      // Add Sentry error tracking
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
    }
  }
};