const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
// These are the configuration constants for the mock command.
const MAX_CONTENT_LENGTH = 2000; // Discord enforces a message length limit of 2000 characters.
const TRUNCATION_BUFFER = 100; // We use a buffer for mentions and emoji to ensure we stay under the limit.
const MOCK_EMOJI = '<a:spongebobmock:1291527476564066387>'; // This is the complete emoji reference for the mocking SpongeBob.
const ELLIPSIS = '...';

/**
 * We handle the mock command.
 * This function converts a selected message's text into a mocking format (alternating case).
 *
 * We perform several tasks:
 * 1. Validate the target message
 * 2. Convert the text to alternating case
 * 3. Format the response with mentions and emoji
 * 4. Handle message length limits
 *
 * @param {MessageContextMenuCommandInteraction} interaction - The Discord interaction object
 */
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Mock')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    try {
      // We defer the reply to handle processing time for longer messages.
      await interaction.deferReply();
      
      logger.info("Mock context menu command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // We validate the message and generate mocked content only if valid.
      const validationResult = this.validateMessage(interaction);
      if (!validationResult.valid) {
        return await interaction.editReply({
          content: validationResult.message,
          ephemeral: true
        });
      }

      // We generate the mocked text and reply to the user.
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
   * We validate the target message to ensure it can be mocked.
   * This function checks if the message exists, is not from the bot,
   * and contains text content to mock.
   *
   * @param {MessageContextMenuCommandInteraction} interaction - The Discord interaction object
   * @returns {Object} An object containing validation result and message data
   */
  validateMessage(interaction) {
    // We retrieve the targeted message from the interaction.
    const targetMessage = interaction.targetMessage;
    
    // We ensure the target message exists before proceeding.
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
        
    // We check if the message is sent by the bot itself to prevent mocking our own messages.
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
    
    // We ensure the message has content to mock, as we can't mock empty messages.
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
   * We generate the mocked content from the target message.
   * This function converts text to alternating case and handles message length limits.
   *
   * @param {Message} targetMessage - The message to mock
   * @returns {string} The mocked content with proper formatting
   */
  generateMockedContent(targetMessage) {
    const messageContent = targetMessage.content;
    
    // We convert the message content to "mOcKiNg" text format by alternating character case.
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
    
    // We create the reply content with mention and emoji for a complete mocking effect.
    const replyContent = `<@${targetMessage.author.id}>: "${mockedText}" ${MOCK_EMOJI}`;
    
    // We check if the reply would exceed Discord's message length limit and truncate if necessary.
    if (replyContent.length > MAX_CONTENT_LENGTH) {
      logger.warn("Mocked text exceeds Discord's message length limit.", {
        contentLength: replyContent.length,
        limit: MAX_CONTENT_LENGTH
      });
      
      // We calculate a safe truncation length to ensure the message fits within Discord's limits.
      const maxTextLength = MAX_CONTENT_LENGTH - TRUNCATION_BUFFER;
      const authorMention = `<@${targetMessage.author.id}>`;
      const safeLength = maxTextLength - authorMention.length - MOCK_EMOJI.length - ELLIPSIS.length - 5; // 5 for quotes and spaces
      
      const truncatedMockedText = mockedText.substring(0, safeLength) + ELLIPSIS;
      return `${authorMention}: "${truncatedMockedText}" ${MOCK_EMOJI}`;
    }
    
    return replyContent;
  },
  
  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {MessageContextMenuCommandInteraction} interaction - The Discord interaction object
   * @param {Error} error - The error that occurred
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
      // We try to edit the reply if it was deferred to show the error message.
      await interaction.editReply({
        content: errorMessage,
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error("Failed to edit reply with error message.", {
        error: followUpError.message,
        originalError: error.message
      });
      
      try {
        // We try to send a new reply if editing failed as a fallback.
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
