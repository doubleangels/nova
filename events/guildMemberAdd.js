const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { getValue, trackNewMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');

/**
 * Event handler for the 'guildMemberAdd' event.
 * Processes new members by applying troll mode, mute mode, and backup mode settings.
 *
 * @param {GuildMember} member - The guild member who joined.
 * @param {Client} client - The Discord client.
 */
module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    try {
      logger.debug("guildMemberAdd event received:", { memberTag: member.user.tag, guildId: member.guild.id });

      // Retrieve configuration settings from the database.
      const backupModeEnabled = ((await getValue("backup_mode_enabled")) || "false").toString().toLowerCase();
      const backupModeRole = await getValue("backup_mode_role");
      const backupModeChannel = await getValue("backup_mode_channel");
      const trollModeEnabled = ((await getValue("troll_mode_enabled")) || "false").toString().toLowerCase();
      const trollModeAccountAge = parseInt(await getValue("troll_mode_account_age")) || 30;
      const muteModeEnabled = ((await getValue("mute_mode_enabled")) || "false").toString().toLowerCase();
      const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours")) || 4;

      // Skip processing for bot accounts.
      if (member.user.bot) {
        logger.debug("Member is a bot; skipping processing:", { memberTag: member.user.tag });
        return;
      }

      const now = dayjs();
      const created = dayjs(member.user.createdTimestamp);
      const accountAgeDays = now.diff(created, 'day');
      logger.debug("New member joined:", {
        memberTag: member.user.tag,
        guildName: member.guild.name,
        accountAgeDays
      });

      // Troll mode: Kick member if account age is below threshold.
      if (trollModeEnabled === "true" && accountAgeDays < trollModeAccountAge) {
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

      // Mute mode: Track new member and schedule a mute kick.
      if (muteModeEnabled === "true") {
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

      // Backup mode: Send a welcome message and assign a role.
      if (backupModeEnabled === "true") {
        // Check that backup mode is fully configured.
        if (!backupModeRole || !backupModeChannel) {
          logger.warn("Backup mode not fully configured; skipping welcome message and role assignment:", {
            backupModeRole,
            backupModeChannel
          });
          return;
        }

        // Retrieve the welcome channel.
        const welcomeChannel = member.guild.channels.cache.get(String(backupModeChannel));
        if (!welcomeChannel) {
          logger.warn("Welcome channel not found:", { backupModeChannel });
          return;
        }

        // Build and send the welcome embed.
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
          .setColor(0xCD41FF);

        await welcomeChannel.send({ embeds: [embed] });
        logger.debug("Welcome message sent:", { channelName: welcomeChannel.name, memberTag: member.user.tag });

        // Attempt to assign the backup role.
        const backupRole = member.guild.roles.cache.get(String(backupModeRole));
        if (backupRole) {
          await member.roles.add(backupRole);
          logger.debug("Backup role assigned:", { roleName: backupRole.name, memberTag: member.user.tag });
        } else {
          logger.warn("Backup role not found in guild:", { backupModeRole });
        }
      }
    } catch (error) {
      logger.error("Error processing guildMemberAdd event:", { error });
    }
  }
};
