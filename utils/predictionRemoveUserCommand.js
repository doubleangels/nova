const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const msgs = require('./predictionMessages');

const DISCORD_ID_REGEX = /^\d{17,20}$/;

/**
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {{
 *   removeFromGames: (userId: string) => Promise<{ worldcup: import('./predictionMessages').RemoveUserSummary, football: import('./predictionMessages').RemoveUserSummary }>,
 *   logger: { info: Function, error?: Function }
 * }} deps
 */
async function handleRemoveUserSubcommand(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.ERR_ADMIN_REMOVE_USER_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const userId = interaction.options.getString('userid', true).trim();
  if (!DISCORD_ID_REGEX.test(userId)) {
    await interaction.reply({
      content: msgs.ERR_INVALID_USER_ID,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { worldcup, football } = await deps.removeFromGames(userId);

  if (!worldcup.hadData && !football.hadData) {
    await interaction.editReply({ content: msgs.msgRemoveUserNoData(userId) });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(msgs.GAME.worldcup.embedColor)
    .setTitle('Prediction User Removed')
    .setDescription(msgs.buildRemoveUserDescription(userId, worldcup, football));

  deps.logger.info('Prediction user removed by administrator.', {
    adminUserId: interaction.user.id,
    guildId: interaction.guild.id,
    targetUserId: userId,
    worldcup,
    football
  });

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  handleRemoveUserSubcommand,
  DISCORD_ID_REGEX
};
