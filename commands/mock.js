const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'Mock',
  MAX_CONTENT_LENGTH: 2000, // Discord message length limit
  MOCK_EMOJI: '<a:spongebobmock:1291527476564066387>', // Complete emoji reference
  EMPTY_MESSAGE_ERROR: "There is no text to mock!",
  BOT_MOCK_ERROR: "I cannot mock my own messages!",
  MISSING_MESSAGE_ERROR: "Error: Could not retrieve the target message.",
  GENERAL_ERROR: "An error occurred while executing this command."
};

/**
 * Context menu command that converts a selected message's text into "mOcKiNg" format.
 * This command is triggered when a user selects a message and chooses the "Mock" option.
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setType(ApplicationCommandType.Message),
  
  /**
   * Executes the Mock context menu command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to handle processing time.
      await interaction.deferReply();
      
      logger.info("Mock context menu command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Retrieve the targeted message.
      const targetMessage = interaction.targetMessage;
      
      // Ensure the target message exists.
      if (!targetMessage) {
        logger.error("Target message could not be retrieved.", {
          userId: interaction.user.id,
          interactionId: interaction.id
        });
        
        return await interaction.editReply({
          content: COMMAND_CONFIG.MISSING_MESSAGE_ERROR,
          ephemeral: true
        });
      }

      logger.debug("Retrieved target message.", {
        targetMessageId: targetMessage.id,
        authorId: targetMessage.author.id
      });
      
      // Check if the message is sent by the bot itself.
      if (targetMessage.author.id === interaction.client.user.id) {
        logger.warn("Attempted to mock the bot's own message.", {
          userId: interaction.user.id,
          targetMessageId: targetMessage.id
        });
        
        return await interaction.editReply({
          content: COMMAND_CONFIG.BOT_MOCK_ERROR,
          ephemeral: true
        });
      }
      
      const messageContent = targetMessage.content;
      
      // Ensure the message has content to mock.
      if (!messageContent || messageContent.trim() === '') {
        logger.warn("No content available to mock.", {
          userId: interaction.user.id,
          targetMessageId: targetMessage.id,
          hasEmbeds: targetMessage.embeds?.length > 0,
          hasAttachments: targetMessage.attachments?.size > 0
        });
        
        return await interaction.editReply({
          content: COMMAND_CONFIG.EMPTY_MESSAGE_ERROR,
          ephemeral: true
        });
      }
      
      // Convert the message content to "mOcKiNg" text format.
      const mockedText = messageContent
        .split('')
        .map((char, index) => {
          return index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
        })
        .join('');
      
      logger.debug("Generated mocked text.", {
        originalLength: messageContent.length,
        mockedLength: mockedText.length
      });
      
      // Reply with the mocked text while mentioning the original author.
      const replyContent = `<@${targetMessage.author.id}>: "${mockedText}" ${COMMAND_CONFIG.MOCK_EMOJI}`;
      
      // Check if the reply would exceed Discord's message length limit.
      if (replyContent.length > COMMAND_CONFIG.MAX_CONTENT_LENGTH) {
        logger.warn("Mocked text exceeds Discord's message length limit.", {
          contentLength: replyContent.length,
          limit: COMMAND_CONFIG.MAX_CONTENT_LENGTH
        });
        
        const truncatedMockedText = mockedText.substring(0, 1900 - targetMessage.author.id.length) + "...";
        await interaction.editReply(`<@${targetMessage.author.id}>: "${truncatedMockedText}" ${COMMAND_CONFIG.MOCK_EMOJI}`);
      } else {
        await interaction.editReply(replyContent);
      }
      
      logger.info("Mock command executed successfully.", {
        userId: interaction.user.id,
        targetMessageId: targetMessage.id
      });
      
    } catch (error) {
      logger.error("Error executing mock command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        interactionId: interaction.id
      });
      
      // Handle case where interaction wasn't deferred properly.
      try {
        await interaction.editReply({
          content: COMMAND_CONFIG.GENERAL_ERROR,
          ephemeral: true
        });
      } catch (followUpError) {
        logger.error("Failed to send error response.", {
          error: followUpError.message,
          originalError: error.message
        });
        
        // Try replying if editing failed.
        await interaction.reply({
          content: COMMAND_CONFIG.GENERAL_ERROR,
          ephemeral: true
        }).catch(() => {
          // Silent catch if everything fails.
        });
      }
    }
  }
};
