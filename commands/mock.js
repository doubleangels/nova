const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Context menu command that converts a selected message's text into "mOcKiNg" format.
 * This command is triggered when a user selects a message and chooses the "Mock" option.
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Mock')
    .setType(ApplicationCommandType.Message),
  
  async execute(interaction) {
    try {
      logger.debug("Mock command received:", { user: interaction.user.tag });
      
      // Retrieve the targeted message
      const targetMessage = interaction.targetMessage;
      logger.debug("Retrieved target message:", { targetMessageId: targetMessage?.id });
      
      // Ensure the target message exists
      if (!targetMessage) {
        logger.error("Target message is undefined.");
        return await interaction.reply({
          content: "Error: Could not retrieve the target message.",
          ephemeral: true
        });
      }
      
      const messageContent = targetMessage.content;
      logger.debug("Target message content", { messageContent });
      
      // Ensure the message has content to mock
      if (!messageContent || messageContent.trim() === '') {
        logger.warn("No content available to mock");
        return await interaction.reply({
          content: "There is no text to mock!",
          ephemeral: true
        });
      }
      
      // Convert the message content to "mOcKiNg" text format
      const mockedText = messageContent.split('').map((char, index) => {
        return index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
      }).join('');
      
      logger.debug("Generated mocked text:", { mockedText });
      
      // Reply with the mocked text while mentioning the original author
      await interaction.reply(`<@${targetMessage.author.id}>: "${mockedText}" <a:spongebobmock:1291527476564066387>`);
      logger.debug("Mock command executed successfully:", { user: interaction.user.tag });
      
    } catch (error) {
      logger.error("Error executing mock command:", { error });
      
      // Attempt to send an error response to the user
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "An error occurred while executing this command.",
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error("Error sending error response:", { error: replyError });
      }
    }
  }
};