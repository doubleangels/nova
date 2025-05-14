const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { handleReminder } = require('../utils/reminderUtils');

/**
 * We handle the test bump command.
 * This function simulates a server bump for testing purposes.
 *
 * We perform several tasks:
 * 1. Create a mock bump message
 * 2. Process the bump as if it were real
 * 3. Schedule a reminder for the next bump
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('testbump')
    .setDescription('Simulate a server bump for testing purposes.'),

  /**
   * Executes the /testbump command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // We create a mock bump message to test the bump handling logic.
      const mockBumpMessage = {
        author: {
          tag: 'Disboard#0000',
          bot: true
        },
        embeds: [{
          description: 'Bump done! See you in 2 hours!'
        }],
        channel: interaction.channel,
        client: interaction.client
      };
      
      // We process the mock bump message.
      await interaction.client.emit('messageCreate', mockBumpMessage);
      
      // We confirm the test bump was processed.
      await interaction.reply({
        content: 'We have processed a test bump. A reminder will be scheduled for 2 hours from now.',
        ephemeral: true
      });
      
      logger.debug(`Test bump executed by ${interaction.user.tag}`);
    } catch (error) {
      logger.error(`Error executing test bump command for ${interaction.user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
      
      // We inform the user if something goes wrong.
      await interaction.reply({
        content: 'We encountered an error while processing the test bump. Please try again.',
        ephemeral: true
      });
    }
  }
}; 