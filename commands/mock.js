const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
// Configuration constants
const MAX_CONTENT_LENGTH = 2000; // Discord message length limit
const TRUNCATION_BUFFER = 100; // Buffer for mentions and emoji
const MOCK_EMOJI = '<a:spongebobmock:1291527476564066387>'; // Complete emoji reference
const ELLIPSIS = '...';

/**
 * Context menu command that converts a selected message's text into "mOcKiNg" format.
 * This command is triggered when a user selects a message and chooses the "Mock" option.
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Mock')
    .setType(ApplicationCommandType.Message),
  /**
   * Executes the Mock context menu command.
   * @param {MessageContextMenuCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to handle processing time.
      await interaction.deferReply();
      logger.info("Mock context menu command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      // Validate the message and generate mocked content
      const validationResult = this.validateMessage(interaction);
      if (!validationResult.valid) {
        return await interaction.editReply({
          content: validationResult.message
        });
      }

      // Generate the mocked text and reply
      const { targetMessage } = validationResult;
      const mockedContent = this.generateMockedContent(targetMessage);
      
      await interaction.editReply(mockedContent);
      logger.info("Mock command executed successfully.", {
        userId: interaction.user.id,
        targetMessageId: targetMessage.id
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Validates the target message to ensure it can be mocked.
   * @param {MessageContextMenuCommandInteraction} interaction - The Discord interaction object.
   * @returns {Object} An object containing validation result and message data.
   */
  validateMessage(interaction) {
    // Retrieve the targeted message.
    const targetMessage = interaction.targetMessage;
    
    // Ensure the target message exists.
    if (!targetMessage) {
      logger.error("Target message could not be retrieved.", {
        userId: interaction.user.id,
        interactionId: interaction.id
      });
      
      return {
        valid: false,
        message: "Error: Could not retrieve the target message."
      };
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
      
      return {
        valid: false,
        message: "I cannot mock my own messages!"
      };
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
      
      return {
        valid: false,
        message: "There is no text to mock!"
      };
    }

    return {
      valid: true,
      targetMessage,
      messageContent
    };
  },
  
  /**
   * Generates the mocked content from the target message.
   * @param {Message} targetMessage - The message to mock.
   * @returns {string} The mocked content.
   */
  generateMockedContent(targetMessage) {
    const messageContent = targetMessage.content;
    
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
    
    // Create the reply content with mention and emoji
    const replyContent = `<@${targetMessage.author.id}>: "${mockedText}" ${MOCK_EMOJI}`;
    
    // Check if the reply would exceed Discord's message length limit.
    if (replyContent.length > MAX_CONTENT_LENGTH) {
      logger.warn("Mocked text exceeds Discord's message length limit.", {
        contentLength: replyContent.length,
        limit: MAX_CONTENT_LENGTH
      });
      
      // Calculate safe truncation length
      const maxTextLength = MAX_CONTENT_LENGTH - TRUNCATION_BUFFER;
      const authorMention = `<@${targetMessage.author.id}>`;
      const safeLength = maxTextLength - authorMention.length - MOCK_EMOJI.length - ELLIPSIS.length - 5; // 5 for quotes and spaces
      
      const truncatedMockedText = mockedText.substring(0, safeLength) + ELLIPSIS;
      return `${authorMention}: "${truncatedMockedText}" ${MOCK_EMOJI}`;
    }
    
    return replyContent;
  },
  
  /**
   * Handles errors that occur during command execution.
   * @param {MessageContextMenuCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error executing mock command.", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user.id,
      interactionId: interaction.id
    });
    
    const errorMessage = "An error occurred while executing this command.";
    
    try {
      // Try to edit the reply if it was deferred
      await interaction.editReply({
        content: errorMessage
      });
    } catch (followUpError) {
      logger.error("Failed to edit reply with error message.", {
        error: followUpError.message,
        originalError: error.message
      });
      
      try {
        // Try to send a new reply if editing failed
        await interaction.reply({
          content: errorMessage,
          ephemeral: true
        });
      } catch (finalError) {
        logger.error("Failed to send any error response.", {
          error: finalError.message,
          originalError: error.message
        });
      }
    }
  }
};