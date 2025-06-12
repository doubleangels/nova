const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

/**
 * Command module for configuring channels to only allow GIFs and stickers.
 * Prevents text messages in designated channels.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('notext')
    .setDescription('Configure a channel to only allow GIFs and stickers.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set a channel to only allow GIFs and stickers.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want to configure?')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove no-text configuration from a channel.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want to remove the configuration from?')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  /**
   * Executes the no-text command.
   * This function:
   * 1. Validates channel permissions
   * 2. Sets or removes no-text configuration
   * 3. Sends confirmation embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error configuring the channel
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      const channel = interaction.options.getChannel('channel');

      if (!channel) {
        return await interaction.reply({
          content: "⚠️ Please select a text channel.",
          ephemeral: true
        });
      }

      const permissions = channel.permissionsFor(interaction.client.user);
      if (!permissions.has(PermissionFlagsBits.ManageMessages)) {
        return await interaction.reply({
          content: "⚠️ I need permission to manage messages in the selected channel.",
          ephemeral: true
        });
      }

      if (subcommand === 'set') {
        const currentChannel = await getValue('notext_channel');
        if (currentChannel === channel.id) {
          return await interaction.reply({
            content: "⚠️ This channel is already configured as a no-text channel.",
            ephemeral: true
          });
        }

        try {
          await setValue('notext_channel', channel.id);
        } catch (error) {
          logger.error("Failed to save no-text channel configuration:", { error: error.message });
          return await interaction.reply({
            content: "⚠️ Failed to save channel configuration. Please try again later.",
            ephemeral: true
          });
        }

        const embed = {
          color: 0xcd41ff,
          title: '🎭 No Text Channel Configuration',
          description: `✅ Channel ${channel} has been configured to only allow GIFs and stickers.`,
          timestamp: new Date().toISOString(),
          footer: {
            text: `Updated by ${interaction.user.tag}`
          }
        };

        await interaction.reply({ embeds: [embed] });
        logger.info("/notext command completed successfully:", { 
          channelId: channel.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          action: 'set'
        });

      } else if (subcommand === 'remove') {
        const currentChannel = await getValue('notext_channel');
        if (currentChannel !== channel.id) {
          return await interaction.reply({
            content: "⚠️ This channel is not configured as a no-text channel.",
            ephemeral: true
          });
        }

        try {
          await setValue('notext_channel', null);
        } catch (error) {
          logger.error("Failed to remove no-text channel configuration:", { error: error.message });
          return await interaction.reply({
            content: "⚠️ Failed to save channel configuration. Please try again later.",
            ephemeral: true
          });
        }

        const embed = {
          color: 0xcd41ff,
          title: '🎭 No Text Channel Configuration',
          description: `✅ Channel ${channel} is no longer restricted to GIFs and stickers.`,
          timestamp: new Date().toISOString(),
          footer: {
            text: `Updated by ${interaction.user.tag}`
          }
        };

        await interaction.reply({ embeds: [embed] });
        logger.info("/notext command completed successfully:", { 
          channelId: channel.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          action: 'remove'
        });
      }

    } catch (error) {
      logger.error("Error in notext command:", { error: error.message });
      await interaction.reply({
        content: "⚠️ An unexpected error occurred while configuring the channel.",
        ephemeral: true
      });
    }
  }
};