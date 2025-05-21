const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')('guildMemberAdd.js');
const dayjs = require('dayjs');
const { getValue, trackNewMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const Sentry = require('../sentry');

// We define the welcome embed color for consistent visual branding.
const WELCOME_EMBED_COLOR = 0xCD41FF;

/**
 * We handle new members joining the server.
 * This function manages the initial setup and tracking of new members.
 *
 * We perform several tasks when a member joins:
 * 1. We track the member in the database for moderation purposes.
 * 2. We schedule a mute kick if mute mode is enabled.
 * 3. We log the member's join information for monitoring.
 *
 * @param {GuildMember} member - The member that joined the server.
 */
module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      // We log the member's join information for monitoring and debugging.
      logger.info(`New member joined: ${member.user.tag} (ID: ${member.id})`);

      // We track the new member in our database for moderation tracking.
      await trackNewMember(
        member.id,
        member.user.username,
        member.joinedAt.toISOString()
      );
      logger.debug(`Tracked new member: ${member.user.tag}`);

      // We check if mute mode is enabled for new member moderation.
      const muteModeEnabled = await getValue('mute_mode_enabled');
      if (muteModeEnabled) {
        // We get the configured mute kick time from settings.
        const muteKickTime = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
        
        // We schedule a mute kick for the new member if they don't send a message.
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

      // We log successful processing of the new member.
      logger.info(`Successfully processed new member: ${member.user.tag}.`);
    } catch (error) {
      // We capture the error in Sentry for monitoring and debugging.
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