const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for removing roles from users.
 * Handles role removal with permission checks and logging.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('takerole')
    .setDescription('Remove a role from a user')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to remove')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to remove the role from')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing the role'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  
  /**
   * Executes the takeRole command.
   * This function:
   * 1. Fetches the target guild member
   * 2. Removes the specified role
   * 3. Sends confirmation embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error removing the role
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      const reason = interaction.options.getString('reason');

      const targetMember = await this.fetchGuildMember(interaction, targetUser.id);
      if (!targetMember) {
        throw new Error("USER_NOT_FOUND");
      }

      await this.removeRoleFromMember(interaction, targetMember, role, reason);
    } catch (error) {
      await this.handleError(error, interaction);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * 
   * @param {Error} error - The error that occurred
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async handleError(error, interaction) {
    logger.error('Error in takeRole command', {
      err: error,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId
    });

    let errorMessage = "⚠️ An unexpected error occurred while taking the role. Please try again later.";
    
    if (error.message === "INSUFFICIENT_PERMISSIONS") {
      errorMessage = "⚠️ I don't have permission to manage roles.";
    } else if (error.message === "MANAGED_ROLE") {
      errorMessage = "⚠️ This role is managed by an integration and cannot be removed.";
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = "⚠️ The specified user could not be found in this server.";
    } else if (error.message === "ROLE_NOT_ASSIGNED") {
      errorMessage = "⚠️ The user doesn't have this role.";
    }

    try {
      await interaction.editReply({ content: errorMessage, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      logger.error('Failed to send error message.', { err: replyError });
    }
  },
  
  /**
   * Removes a role from a guild member.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {GuildMember} targetMember - The member to remove the role from
   * @param {Role} role - The role to remove
   * @param {string} [reason] - The reason for removing the role
   * @throws {Error} If the role cannot be removed
   * @returns {Promise<void>}
   */
  async removeRoleFromMember(interaction, targetMember, role, reason) {
    if (!targetMember.roles.cache.has(role.id)) {
      throw new Error("ROLE_NOT_ASSIGNED");
    }

    if (role.managed) {
      throw new Error("MANAGED_ROLE");
    }

    await targetMember.roles.remove(role, reason);

    const embed = new EmbedBuilder()
      .setColor(role.color)
      .setTitle('Role Removed')
      .setDescription(`Successfully removed the <@&${role.id}> role from <@${targetMember.id}>.`)
      .addFields(
        { name: 'Role', value: `<@&${role.id}>`, inline: true },
        { name: 'Role Color', value: `\`${role.hexColor}\``, inline: true }
      );

    if (reason) {
      embed.addFields({ name: 'Reason', value: reason });
    }
    
    await interaction.editReply({
      content: `<@&${role.id}>`,
      embeds: [embed]
    });
  },
  
  /**
   * Fetches a guild member by their user ID.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {string} userId - The ID of the user to fetch
   * @returns {Promise<GuildMember|null>} The guild member or null if not found
   */
  async fetchGuildMember(interaction, userId) {
    try {
      return await interaction.guild.members.fetch(userId);
    } catch (error) {
      logger.warn("Target user not found in guild:", {
        userId: userId,
        guildId: interaction.guildId
      });
      return null;
    }
  }
};