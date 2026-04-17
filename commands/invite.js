const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getAllInviteTagsData } = require('../utils/database');

/**
 * Read-only listing of tagged invites. Create, tag, remove, and notification channel
 * are configured in the Nova dashboard (Invite Manager).
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('List tagged invite codes (configure invites in the Nova dashboard).')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all tagged invite codes stored for this bot.')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub !== 'list') {
        return interaction.editReply({ content: '⚠️ Unknown subcommand.' });
      }
      await this.handleListSubcommand(interaction);
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  async handleListSubcommand(interaction) {
    const tags = await getAllInviteTagsData();

    if (tags.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('Tagged Invites')
        .setDescription(
          'No tagged invites found. Add and manage tagged invites in the **Nova dashboard** under **Invite Manager**.'
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    tags.sort((a, b) => a.name.localeCompare(b.name));

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Tagged Invites')
      .setDescription(
        `Found **${tags.length}** tagged invite${tags.length === 1 ? '' : 's'} (manage in dashboard):`
      )
      .setTimestamp();

    const fields = [];
    let currentField = { name: 'Tags', value: '', inline: false };

    for (const tag of tags) {
      const tagLine = `**${tag.name}**\n\`${tag.code}\` - https://discord.gg/${tag.code}\n`;
      if (currentField.value.length + tagLine.length > 1000 && currentField.value.length > 0) {
        fields.push(currentField);
        currentField = { name: '\u200b', value: '', inline: false };
      }
      currentField.value += tagLine;
    }
    if (currentField.value.length > 0) {
      fields.push(currentField);
    }

    embed.addFields(fields.slice(0, 25));
    if (fields.length > 25) {
      embed.setFooter({ text: `Showing first 25 of ${tags.length} tags` });
    }

    await interaction.editReply({ embeds: [embed] });
    logger.info('/invite list completed.', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      tagCount: tags.length
    });
  },

  async handleError(interaction, error) {
    logger.error('Error in /invite command.', {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    const msg =
      error.message === 'DATABASE_READ_ERROR'
        ? '⚠️ Failed to retrieve invite tags. Please try again later.'
        : '⚠️ An unexpected error occurred. Please try again later.';
    try {
      await interaction.editReply({ content: msg, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
};
