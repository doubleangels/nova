const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const supabase = require('../utils/supabase');

/**
 * Module for the /test command.
 * This command retrieves all configuration values from the Supabase config table and replies with them.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('Retrieve all config values from the Supabase config table.'),
    
  /**
   * Executes the /test command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Retrieve all configuration values from the Supabase config table.
      const configs = await supabase.getAllConfigs();
      
      // Check if any config values were returned.
      if (!configs || configs.length === 0) {
        await interaction.reply('No config values found.');
        return;
      }
      
      // Map the config values to a formatted string.
      const replyText = configs.map(cfg => `${cfg.id}: ${cfg.value}`).join('\n');
      
      // Reply with the formatted config values.
      await interaction.reply(`Config values:\n${replyText}`);
    } catch (error) {
      // Log any errors that occur during command execution.
      logger.error("Error in test command:", error);
      await interaction.reply('Error retrieving config values.');
    }
  }
};
