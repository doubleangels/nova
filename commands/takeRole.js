const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

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

  async handleError(error, interaction) {
    logger.error('Error in takeRole command:', {
      error: error.message,
      stack: error.stack,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId
    });

    let errorMessage = "⚠️ An unexpected error occurred while taking the role.";
    
    if (error.message === "INSUFFICIENT_PERMISSIONS") {
      errorMessage = "⚠️ I don't have permission to manage roles.";
    } else if (error.message === "MANAGED_ROLE") {
      errorMessage = "⚠️ This role is managed by an integration and cannot be removed.";
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = "⚠️ Could not find the specified user.";
    } else if (error.message === "ROLE_NOT_ASSIGNED") {
      errorMessage = "⚠️ The user doesn't have this role.";
    }

    try {
      await interaction.editReply({ content: errorMessage });
    } catch (replyError) {
      logger.error('Failed to send error message:', {
        error: replyError.message,
        stack: replyError.stack
      });
    }
  },
  
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
      .setDescription(`✅ Successfully removed the ${role.name} role from <@${targetMember.id}>!`)
      .addFields(
        { name: 'Role', value: role.name, inline: true },
        { name: 'Role Color', value: `\`${role.hexColor}\``, inline: true }
      )
      .setFooter({ text: `Updated by ${interaction.user.tag}` })
      .setTimestamp();

    if (reason) {
      embed.addFields({ name: 'Reason', value: reason });
    }
    
    await interaction.editReply({ embeds: [embed] });
  },
  
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