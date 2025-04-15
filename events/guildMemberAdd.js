const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { getValue, trackNewMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const Sentry = require('../sentry');

// We use this color for welcome embeds to maintain visual consistency.
const WELCOME_EMBED_COLOR = 0xCD41FF;

/**
 * Event handler for the 'guildMemberAdd' event.
 * We process new members by applying troll mode, mute mode, and backup mode settings.
 *
 * @param {GuildMember} member - The guild member who joined.
 * @param {Client} client - The Discord client.
 */
module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    try {
      logger.debug("guildMemberAdd event received:", { memberTag: member.user.tag, guildId: member.guild.id });

      // We skip processing for bot accounts to avoid unnecessary actions.
      if (member.user.bot) {
        logger.debug("Member is a bot; skipping processing:", { memberTag: member.user.tag });
        return;
      }

      // We retrieve all necessary configuration settings from the database.
      const [
        backupModeEnabled,
        backupModeRole,
        backupModeChannel,
        trollModeEnabled,
        trollModeAccountAgeStr,
        muteModeEnabled,
        muteKickTimeStr
      ] = await Promise.all([
        getValue("backup_mode_enabled"),
        getValue("backup_mode_role"),
        getValue("backup_mode_channel"),
        getValue("troll_mode_enabled"),
        getValue("troll_mode_account_age"),
        getValue("mute_mode_enabled"),
        getValue("mute_mode_kick_time_hours")
      ]);

      // We parse values with proper defaults to ensure reliable behavior.
      const isBackupModeEnabled = (backupModeEnabled || "false").toString().toLowerCase() === "true";
      const isTrollModeEnabled = (trollModeEnabled || "false").toString().toLowerCase() === "true";
      const isMuteModeEnabled = (muteModeEnabled || "false").toString().toLowerCase() === "true";
      const trollModeAccountAge = parseInt(trollModeAccountAgeStr) || 30;
      const muteKickTime = parseInt(muteKickTimeStr) || 4;

      const now = dayjs();
      const created = dayjs(member.user.createdTimestamp);
      const accountAgeDays = now.diff(created, 'day');
      logger.debug("New member joined:", {
        memberTag: member.user.tag,
        guildName: member.guild.name,
        accountAgeDays
      });

      // We implement troll mode by kicking members with accounts newer than the threshold.
      if (isTrollModeEnabled && accountAgeDays < trollModeAccountAge) {
        logger.debug("Troll mode active:", {
          memberTag: member.user.tag,
          accountAgeDays,
          requiredAge: trollModeAccountAge
        });
        try {
          await member.kick("Account is too new!");
          logger.info("Member kicked for troll mode:", { memberTag: member.user.tag });
        } catch (err) {
          logger.error("Failed to kick member in troll mode:", { memberTag: member.user.tag, error: err });
        }
        return;
      }

      // We track new members in mute mode and schedule automatic kicks if they don't verify.
      if (isMuteModeEnabled) {
        const joinTime = dayjs().toISOString();
        logger.debug("Mute mode active; tracking new member:", {
          memberTag: member.user.tag,
          joinTime
        });
        try {
          await trackNewMember(member.id, member.user.tag, joinTime);
          logger.debug("Member successfully tracked for mute mode:", { memberTag: member.user.tag });
          await scheduleMuteKick(member.id, member.user.tag, joinTime, muteKickTime, member.guild.id, client);
          logger.debug("Mute kick scheduled:", { memberTag: member.user.tag });
        } catch (err) {
          logger.error("Failed to track or schedule mute kick:", { memberTag: member.user.tag, error: err });
        }
      }

      // We handle backup mode by sending a welcome message and assigning a role.
      if (isBackupModeEnabled) {
        // We check that backup mode is fully configured before proceeding.
        if (!backupModeRole || !backupModeChannel) {
          logger.warn("Backup mode not fully configured; skipping welcome message and role assignment:", {
            backupModeRole,
            backupModeChannel
          });
          return;
        }

        // We retrieve the welcome channel from the guild's cache.
        const welcomeChannel = member.guild.channels.cache.get(String(backupModeChannel));
        if (!welcomeChannel) {
          logger.warn("Welcome channel not found:", { backupModeChannel });
          return;
        }

        // We build and send a welcome embed with instructions for the new member.
        const embed = new EmbedBuilder()
          .setTitle(`🎉 Welcome ${member.user.username}!`)
          .setDescription(
            "• **How old are you?**\n" +
            "• Where are you from?\n" +
            "• What do you do in your free time?\n" +
            "• What is your address?\n" +
            "• What do you do to earn your daily bread in the holy church of our lord and savior Cheesus Driftus?\n" +
            "• What's your blood type?\n" +
            "• What's your shoe size?\n" +
            "• Can we donate your organs to ... \"charity\"?\n\n" +
            "**Please tell us how old you are at least - this is an age restricted server! If you don't send at least one message, you might get automatically kicked.**"
          )
          .setColor(WELCOME_EMBED_COLOR);

        try {
          await welcomeChannel.send({ embeds: [embed] });
          logger.debug("Welcome message sent:", { channelName: welcomeChannel.name, memberTag: member.user.tag });
        } catch (err) {
          logger.error("Failed to send welcome message:", { channelName: welcomeChannel.name, error: err });
        }

        // We attempt to assign the backup role to the new member.
        const backupRole = member.guild.roles.cache.get(String(backupModeRole));
        if (backupRole) {
          try {
            await member.roles.add(backupRole);
            logger.debug("Backup role assigned:", { roleName: backupRole.name, memberTag: member.user.tag });
          } catch (err) {
            logger.error("Failed to assign backup role:", { roleName: backupRole.name, error: err });
          }
        } else {
          logger.warn("Backup role not found in guild:", { backupModeRole });
        }
      }
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
      logger.error("Error processing guildMemberAdd event:", { error });
    }
  }
};