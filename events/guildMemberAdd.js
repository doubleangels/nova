const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { getValue, trackMuteMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const Sentry = require('../sentry');

// We use this color for welcome embeds to maintain visual consistency.
const WELCOME_EMBED_COLOR = 0xCD41FF;

/**
 * Event handler for the 'guildMemberAdd' event.
 * We handle new members joining the server, including mute mode verification.
 * 
 * @param {GuildMember} member - The member that joined the server.
 */
module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      // We skip processing for bot accounts since they aren't tracked in the mute system.
      if (member.user.bot) {
        logger.debug("Bot member joined; skipping mute tracking:", { botTag: member.user.tag });
        return;
      }

      // We log the start of the join process with the member's details for tracking.
      logger.debug("Processing guildMemberAdd event:", { 
        memberId: member.id,
        username: member.user.tag,
        guildName: member.guild.name 
      });

      // We check if mute mode is enabled for this server.
      const muteModeEnabled = await getValue('mute_mode_enabled');
      if (!muteModeEnabled) {
        logger.debug("Mute mode is disabled; skipping tracking:", { 
          memberId: member.id,
          username: member.user.tag
        });
        return;
      }

      // We get the mute timeout from the config or use a default of 10 minutes.
      const muteTimeout = await getValue('mute_timeout') || 10;
      logger.debug(`Using mute timeout of ${muteTimeout} minutes.`);

      // We record the join time for mute mode verification.
      const joinTime = new Date().toISOString();
      await trackMuteMember(member.id, member.user.tag, joinTime);
      
      logger.info("Started mute tracking for new member:", { 
        memberId: member.id,
        username: member.user.tag,
        joinTime,
        muteTimeout
      });

    } catch (error) {
      // Add Sentry error tracking
      Sentry.captureException(error, {
        extra: {
          event: 'guildMemberAdd',
          memberId: member.id,
          username: member.user?.tag || "Unknown"
        }
      });
      logger.error("Error processing guildMemberAdd event:", { 
        memberId: member.id, 
        username: member.user?.tag || "Unknown",
        error 
      });
    }
  }
};