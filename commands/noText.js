/**
 * NoText command module for configuring channels to only allow GIFs and stickers.
 * @module commands/notext
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

const NOTEXT_DB_KEY = 'notext_channel';
const NOTEXT_EMBED_COLOR = '#cd41ff';
const NOTEXT_EMBED_TITLE = '🎭 No Text Channel Configuration';

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
   * Executes the notext command.
   * @async
   * @function execute
   * @param {Object} interaction - The Discord interaction object
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
        const currentChannel = await getValue(NOTEXT_DB_KEY);
        if (currentChannel === channel.id) {
          return await interaction.reply({
            content: "⚠️ This channel is already configured as a no-text channel.",
            ephemeral: true
          });
        }

        try {
          await setValue(NOTEXT_DB_KEY, channel.id);
        } catch (error) {
          logger.error("Failed to save no-text channel configuration:", { error: error.message });
          return await interaction.reply({
            content: "⚠️ Failed to save channel configuration. Please try again later.",
            ephemeral: true
          });
        }

        const embed = {
          color: parseInt(NOTEXT_EMBED_COLOR.replace('#', ''), 16),
          title: NOTEXT_EMBED_TITLE,
          description: `✅ Channel ${channel} has been configured to only allow GIFs and stickers.`,
          timestamp: new Date().toISOString()
        };

        await interaction.reply({ embeds: [embed] });
        logger.info("No-text channel configured:", { 
          channelId: channel.id,
          guildId: interaction.guildId,
          userId: interaction.user.id
        });

      } else if (subcommand === 'remove') {
        const currentChannel = await getValue(NOTEXT_DB_KEY);
        if (currentChannel !== channel.id) {
          return await interaction.reply({
            content: "⚠️ This channel is not configured as a no-text channel.",
            ephemeral: true
          });
        }

        try {
          await setValue(NOTEXT_DB_KEY, null);
        } catch (error) {
          logger.error("Failed to remove no-text channel configuration:", { error: error.message });
          return await interaction.reply({
            content: "⚠️ Failed to save channel configuration. Please try again later.",
            ephemeral: true
          });
        }

        const embed = {
          color: parseInt(NOTEXT_EMBED_COLOR.replace('#', ''), 16),
          title: NOTEXT_EMBED_TITLE,
          description: `✅ Channel ${channel} is no longer restricted to GIFs and stickers.`,
          timestamp: new Date().toISOString()
        };

        await interaction.reply({ embeds: [embed] });
        logger.info("No-text channel configuration removed:", { 
          channelId: channel.id,
          guildId: interaction.guildId,
          userId: interaction.user.id
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