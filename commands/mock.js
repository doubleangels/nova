const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Mock')
    .setType(ApplicationCommandType.Message),
  
  async execute(interaction) {
    try {
      // Get the targeted message
      const targetMessage = interaction.targetMessage;
      
      logger.debug('Mock command triggered', {
        user: interaction.user.tag,
        targetMessageId: targetMessage?.id
      });
      
      // Check if targetMessage exists
      if (!targetMessage) {
        logger.error('Target message is undefined');
        return await interaction.reply({
          content: 'Error: Could not retrieve the target message.',
          ephemeral: true
        });
      }
      
      const messageContent = targetMessage.content;
      
      // If there's no content, respond with an error
      if (!messageContent || messageContent.trim() === '') {
        logger.debug('No content to mock');
        return await interaction.reply({
          content: 'There is no text to mock!',
          ephemeral: true
        });
      }
      
      // Convert the text to mOcKiNg form
      const mockedText = messageContent.split('').map((char, index) => {
        return index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
      }).join('');
      
      // Reply with the mocked text, pinging the original author
      await interaction.reply(`<@${targetMessage.author.id}> "${mockedText}"`);
      logger.debug('Mock command executed successfully');
      
    } catch (error) {
      logger.error('Error executing mock command:', { error });
      
      // Try to respond to the user if possible
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'An error occurred while executing this command.',
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error('Error sending error response:', { error: replyError });
      }
    }
  }
};
