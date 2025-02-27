const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testbump')
    .setDescription('Sends an embed that contains "Bump done" to test the reminder.'),
  async execute(interaction) {
    // Create an embed with the required description
    const bumpEmbed = new EmbedBuilder()
      .setDescription('Bump done')
      .setColor(0x0099ff);

    // Reply with the embed so the messageCreate event can catch it
    await interaction.reply({ embeds: [bumpEmbed] });
  }
};
