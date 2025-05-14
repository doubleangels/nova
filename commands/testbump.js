const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { handleReminder } = require('../utils/reminderUtils');

/**
 * Module for the /testbump command.
 * This command simulates a Disboard bump message for testing the reminder system.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('testbump')
    .setDescription('Test the bump reminder system by simulating a Disboard bump message.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * Executes the /testbump command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.info("Test bump command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // Create a simulated Disboard bump embed
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setDescription('Bump done! See you in 2 hours!')
        .setFooter({ text: 'Disboard' });

      // Send the simulated bump message
      const message = await interaction.channel.send({ embeds: [embed] });
      
      logger.debug("Sent test bump message:", {
        messageId: message.id,
        channelId: interaction.channelId
      });

      // Schedule reminder for 1 minute instead of 2 hours
      await handleReminder(message, 60000); // 1 minute = 60000 milliseconds

      await interaction.editReply('✅ Test bump message sent! You should receive a reminder in 1 minute.');
      
    } catch (error) {
      logger.error("Error in test bump command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id
      });
      
      await interaction.editReply('❌ Failed to send test bump message. Check the logs for details.');
    }
  }
}; 