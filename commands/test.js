const { SlashCommandBuilder } = require('discord.js');
const supabase = require('../utils/supabase');
const logger = require('../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('Retrieve all config values from the Supabase config table.'),
  async execute(interaction) {
    try {
      const configs = await supabase.getAllConfigs();
      if (!configs || configs.length === 0) {
        await interaction.reply('No config values found.');
        return;
      }
      // Format each row as "key: value"
      const replyText = configs.map(cfg => `${cfg.id}: ${cfg.value}`).join('\n');
      await interaction.reply(`Config values:\n${replyText}`);
    } catch (error) {
      logger.error("Error in test command:", error);
      await interaction.reply('Error retrieving config values.');
    }
  }
};
