const { EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, trackNewMember } = require('../utils/supabase');
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
      logger.debug("Processing guildMemberAdd event.");

      // Retrieve configuration settings from the database.
      const backupModeEnabled = ((await getValue("backup_mode_enabled")) || "false").toString().toLowerCase();
      const backupModeRole = await getValue("backup_mode_role");
      const backupModeChannel = await getValue("backup_mode_channel");
      const trollModeEnabled = ((await getValue("troll_mode_enabled")) || "false").toString().toLowerCase();
      const trollModeAccountAge = parseInt(await getValue("troll_mode_account_age")) || 30;
      const muteModeEnabled = ((await getValue("mute_mode_enabled")) || "false").toString().toLowerCase();
      const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours")) || 4;

      logger.debug(`Configuration settings retrieved: 
        backup_mode_enabled=${backupModeEnabled}, backup_mode_role=${backupModeRole}, backup_mode_channel=${backupModeChannel}, 
        troll_mode_enabled=${trollModeEnabled}, troll_mode_account_age=${trollModeAccountAge}, 
        mute_mode_enabled=${muteModeEnabled}, mute_kick_time=${muteKickTime}`);

      // Skip further processing for bot accounts.
      if (member.user.bot) {
        logger.debug(`Member ${member.user.tag} is a bot; skipping further processing.`);
        return;
      }

      // Calculate the account age in days.
      const now = Date.now();
      const created = member.user.createdTimestamp;
      const accountAgeDays = Math.floor((now - created) / (1000 * 3600 * 24));
      logger.debug(`New member joined: ${member.user.tag} in guild ${member.guild.name} | Account Age: ${accountAgeDays} days`);

      // If troll mode is enabled and account age is below threshold, kick the member.
      if (trollModeEnabled === "true" && accountAgeDays < trollModeAccountAge) {
        logger.debug(`Member ${member.user.tag} account age ${accountAgeDays} days is below threshold of ${trollModeAccountAge} days; attempting kick.`);
        try {
          await member.kick("Account is too new!");
          logger.debug(`Kicked ${member.user.tag} for having an account younger than ${trollModeAccountAge} days.`);
        } catch (err) {
          logger.error(`Failed to kick ${member.user.tag}: ${err}`);
        }
        return;
      }

      // If mute mode is enabled, track the new member and schedule a mute kick.
      if (muteModeEnabled === "true") {
        const joinTime = new Date().toISOString();
        logger.debug(`Attempting to track ${member.user.tag} for mute mode. Join time: ${joinTime}`);
        try {
          await trackNewMember(member.id, member.user.tag, joinTime);
          logger.debug(`Successfully tracked ${member.user.tag} for mute mode.`);
          await scheduleMuteKick(member.id, member.user.tag, joinTime, muteKickTime, member.guild.id, client);
          logger.debug(`Scheduled mute kick for ${member.user.tag}.`);
        } catch (err) {
          logger.error(`Failed to track ${member.user.tag} for mute mode: ${err}`);
        }
      }

      // If backup mode is enabled, send a welcome message and assign a role.
      if (backupModeEnabled === "true") {
        // Ensure backup mode is fully configured.
        if (!backupModeRole || !backupModeChannel) {
          logger.debug("Backup mode is not fully configured. Skipping role assignment and welcome message.");
          return;
        }

        // Get the welcome channel from the guild's channel cache.
        const welcomeChannel = member.guild.channels.cache.get(String(backupModeChannel));
        if (!welcomeChannel) {
          logger.warn(`Channel with ID ${backupModeChannel} not found. Welcome message skipped.`);
          return;
        }

        // Build a welcome message embed.
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

        // Send the welcome embed to the configured channel.
        await welcomeChannel.send({ embeds: [embed] });
        logger.debug(`Sent welcome message in ${welcomeChannel.name} for ${member.user.tag}.`);

        // Attempt to assign the backup role if it exists.
        const backupRole = member.guild.roles.cache.get(String(backupModeRole));
        if (backupRole) {
          await member.roles.add(backupRole);
          logger.debug(`Assigned role '${backupRole.name}' to ${member.user.tag}.`);
        } else {
          logger.warn(`Role with ID ${backupModeRole} not found in the guild. Role assignment skipped.`);
        }
      }
    } catch (error) {
      // Log any errors that occur during processing.
      logger.error(`Error during guildMemberAdd event: ${error}`);
    }
  }
};
