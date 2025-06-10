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

const NOTEXT_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while configuring the channel.";
const NOTEXT_ERROR_DATABASE = "⚠️ Failed to save channel configuration. Please try again later.";
const NOTEXT_ERROR_INVALID_CHANNEL = "⚠️ Please select a text channel.";
const NOTEXT_ERROR_PERMISSIONS = "⚠️ I need permission to manage messages in the selected channel.";
const NOTEXT_ERROR_ALREADY_CONFIGURED = "⚠️ This channel is already configured as a no-text channel.";
const NOTEXT_ERROR_NOT_CONFIGURED = "⚠️ This channel is not configured as a no-text channel.";

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
          content: NOTEXT_ERROR_INVALID_CHANNEL,
          ephemeral: true
        });
      }

      const permissions = channel.permissionsFor(interaction.client.user);
      if (!permissions.has(PermissionFlagsBits.ManageMessages)) {
        return await interaction.reply({
          content: NOTEXT_ERROR_PERMISSIONS,
          ephemeral: true
        });
      }

      if (subcommand === 'set') {
        const currentChannel = await getValue(NOTEXT_DB_KEY);
        if (currentChannel === channel.id) {
          return await interaction.reply({
            content: NOTEXT_ERROR_ALREADY_CONFIGURED,
            ephemeral: true
          });
        }

        try {
          await setValue(NOTEXT_DB_KEY, channel.id);
        } catch (error) {
          logger.error("Failed to save no-text channel configuration:", { error: error.message });
          return await interaction.reply({
            content: NOTEXT_ERROR_DATABASE,
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
            content: NOTEXT_ERROR_NOT_CONFIGURED,
            ephemeral: true
          });
        }

        try {
          await setValue(NOTEXT_DB_KEY, null);
        } catch (error) {
          logger.error("Failed to remove no-text channel configuration:", { error: error.message });
          return await interaction.reply({
            content: NOTEXT_ERROR_DATABASE,
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
        content: NOTEXT_ERROR_UNEXPECTED,
        ephemeral: true
      });
    }
  }
};