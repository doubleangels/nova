const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue } = require('../utils/database');
const config = require('../config');

/**
 * No-text channel (GIFs/stickers only) is configured in the Nova dashboard under Social & Fun.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('notext')
    .setDescription('Where to configure the no-text (GIF/sticker-only) channel.')
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('Open the dashboard or see where this channel is configured.')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub !== 'info') {
        return interaction.editReply({ content: '⚠️ Unknown subcommand.' });
      }

      const dashboardUrl = String((await getValue('dashboard_base_url')) || '').trim();
      const currentId = await getValue('notext_channel');
      const channelLine = currentId
        ? `Current no-text channel: <#${currentId}>`
        : 'No no-text channel is set yet.';

      const descParts = [
        'Set or change the **no-text channel** in the **Nova dashboard** under **Social & Fun** (Restricted channel).',
        channelLine
      ];
      if (dashboardUrl) {
        descParts.push(`Dashboard: ${dashboardUrl}`);
      } else {
        descParts.push(
          'Ask a server admin for the dashboard URL, or set `dashboard_base_url` in the dashboard settings / database.'
        );
      }

      const embed = new EmbedBuilder()
        .setColor(config.baseEmbedColor ?? 0)
        .setTitle('No-text channel')
        .setDescription(descParts.join('\n\n'))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      logger.info('/notext info used.', { userId: interaction.user.id, guildId: interaction.guildId });
    } catch (err) {
      logger.error('/notext command failed.', { err, userId: interaction.user?.id });
      await interaction.editReply({
        content: '⚠️ Could not load settings. Try again later.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
