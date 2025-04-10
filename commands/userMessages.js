/**
 * Module for the /usermessages command.
 * 
 * This command retrieves and displays the most recent messages from a specific user
 * in a specified channel with pagination support.
 */

const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Configuration constants.
const CONFIG = {
  COMMAND: {
    NAME: 'usermessages',
    DESCRIPTION: 'Lists the last 50 messages from a specific user in a specified channel.'
  },
  OPTIONS: {
    USER: {
      NAME: 'user',
      DESCRIPTION: "What user's messages do you want to see?"
    },
    CHANNEL: {
      NAME: 'channel',
      DESCRIPTION: 'What channel do you want to search in?'
    },
    LIMIT: {
      NAME: 'limit',
      DESCRIPTION: 'How many messages do you want to display? (1-50, Default: 50)',
      DEFAULT: 50,
      MIN: 1,
      MAX: 50
    }
  },
  EMBED: {
    COLOR: 0xcd41ff,
    MESSAGES_PER_PAGE: 10,
    MAX_CONTENT_LENGTH: 200,
    ELLIPSIS: '...'
  },
  BUTTONS: {
    FIRST: {
      ID: 'first',
      LABEL: '<<'
    },
    PREVIOUS: {
      ID: 'previous',
      LABEL: '<'
    },
    PAGE_INFO: {
      ID: 'page_info'
    },
    NEXT: {
      ID: 'next',
      LABEL: '>'
    },
    LAST: {
      ID: 'last',
      LABEL: '>>'
    }
  },
  COLLECTOR: {
    TIMEOUT: 300000 // 5 minutes
  },
  RESPONSES: {
    NO_MESSAGES: 'No recent messages found from %s in %s.',
    MESSAGES_FOUND: 'Found %s messages from %s in %s.',
    ERROR: '⚠️ There was an error fetching the messages. Please try again later.',
    UNAUTHORIZED_BUTTON: 'You cannot use these buttons.',
    USER_NOT_FOUND: 'User not found.',
    INVALID_CHANNEL: 'Please select a valid text channel.'
  },
  INDICATORS: {
    ATTACHMENT: '📎',
    EMBED: '🖼️',
    MESSAGE: '📜',
    TIME: '⏰',
    NO_CONTENT: '[No text content]'
  },
  CHANNEL_TYPES: {
    TEXT: 0 // Discord channel type for text channels
  },
  FETCH: {
    BATCH_SIZE: 100 // Number of messages to fetch in each batch
  }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName(CONFIG.COMMAND.NAME)
    .setDescription(CONFIG.COMMAND.DESCRIPTION)
    .addUserOption(option => 
      option
        .setName(CONFIG.OPTIONS.USER.NAME)
        .setDescription(CONFIG.OPTIONS.USER.DESCRIPTION)
        .setRequired(true))
    .addChannelOption(option =>
      option
        .setName(CONFIG.OPTIONS.CHANNEL.NAME)
        .setDescription(CONFIG.OPTIONS.CHANNEL.DESCRIPTION)
        .setRequired(true))
    .addIntegerOption(option =>
      option
        .setName(CONFIG.OPTIONS.LIMIT.NAME)
        .setDescription(CONFIG.OPTIONS.LIMIT.DESCRIPTION)
        .setRequired(false)
        .setMinValue(CONFIG.OPTIONS.LIMIT.MIN)
        .setMaxValue(CONFIG.OPTIONS.LIMIT.MAX)),

  /**
   * Executes the usermessages command.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      logger.debug("User messages command received.", { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag,
        guildName: interaction.guild.name,
        guildId: interaction.guild.id
      });
      
      // Defer reply as ephemeral since this might take some time.
      await interaction.deferReply({ 
        ephemeral: true 
      });
      
      // Get the target user and channel from options.
      const targetUser = interaction.options.getUser(CONFIG.OPTIONS.USER.NAME);
      const targetChannel = interaction.options.getChannel(CONFIG.OPTIONS.CHANNEL.NAME);
      const messageLimit = interaction.options.getInteger(CONFIG.OPTIONS.LIMIT.NAME) || CONFIG.OPTIONS.LIMIT.DEFAULT;
      
      logger.debug("Command parameters retrieved.", { 
        targetUserTag: targetUser?.tag,
        targetUserId: targetUser?.id,
        targetChannelName: targetChannel?.name,
        targetChannelId: targetChannel?.id,
        messageLimit
      });
      
      // Verify the target user exists.
      if (!targetUser) {
        logger.warn("Target user not found.", { 
          requestedByUserId: interaction.user.id,
          requestedByUserTag: interaction.user.tag 
        });
        
        return interaction.editReply({ 
          content: CONFIG.RESPONSES.USER_NOT_FOUND, 
          ephemeral: true 
        });
      }
      
      logger.info("Fetching messages for user.", { 
        targetUserTag: targetUser.tag, 
        targetUserId: targetUser.id,
        requestedByUserTag: interaction.user.tag,
        requestedByUserId: interaction.user.id
      });
      
      // Check if the specified channel is a text channel.
      if (targetChannel.type !== CONFIG.CHANNEL_TYPES.TEXT) {
        logger.warn("Invalid channel type specified.", { 
          channelName: targetChannel.name, 
          channelId: targetChannel.id,
          channelType: targetChannel.type
        });
        
        return interaction.editReply({ 
          content: CONFIG.RESPONSES.INVALID_CHANNEL, 
          ephemeral: true 
        });
      }

      logger.debug("Searching channel for messages.", { 
        channelName: targetChannel.name, 
        channelId: targetChannel.id,
        targetUserId: targetUser.id
      });

      // Fetch messages in batches until the desired limit is reached.
      const allMessages = await this.fetchUserMessages(
        targetChannel, 
        targetUser.id, 
        messageLimit
      );
      
      // Handle case where no messages are found.
      if (allMessages.length === 0) {
        logger.info("No messages found for user.", { 
          targetUserTag: targetUser.tag,
          channelName: targetChannel.name
        });
        
        return interaction.editReply({
          content: CONFIG.RESPONSES.NO_MESSAGES.replace('%s', targetUser.username)
                                               .replace('%s', targetChannel.name),
          ephemeral: true 
        });
      }
      
      // Create embeds for the messages.
      const embeds = this.createMessageEmbeds(allMessages, targetUser, targetChannel);
      
      logger.debug("Created message embeds.", { 
        embedCount: embeds.length, 
        messagesPerPage: CONFIG.EMBED.MESSAGES_PER_PAGE,
        totalMessages: allMessages.length
      });
      
      // Send the first embed with pagination buttons if needed.
      let currentPage = 0;
      const totalPages = embeds.length;
      
      const message = await interaction.editReply({ 
        content: CONFIG.RESPONSES.MESSAGES_FOUND
                  .replace('%s', allMessages.length)
                  .replace('%s', targetUser.username)
                  .replace('%s', targetChannel.name),
        ephemeral: true,
        embeds: [embeds[currentPage]],
        components: totalPages > 1 ? [this.createPaginationButtons(currentPage, totalPages)] : []
      });
      
      logger.info("Initial response sent.", { 
        messageCount: allMessages.length,
        pageCount: totalPages,
        targetUserTag: targetUser.tag
      });
      
      // Only create collector if there are multiple pages.
      if (totalPages > 1) {
        await this.setupPaginationCollector(message, interaction, embeds, currentPage, totalPages);
      }
      
    } catch (error) {
      logger.error("Error executing user messages command.", { 
        error: error.message,
        stack: error.stack,
        userTag: interaction.user?.tag,
        guildName: interaction.guild?.name
      });
      
      const replyMethod = (interaction.deferred || interaction.replied) ? 'editReply' : 'reply';
      
      await interaction[replyMethod]({ 
        content: CONFIG.RESPONSES.ERROR, 
        ephemeral: true 
      }).catch(err => {
        logger.error("Failed to send error message to user.", { 
          error: err.message 
        });
      });
    }
  },

  /**
   * Fetches messages from a specific user in a channel.
   * 
   * @param {TextChannel} channel - The channel to search in.
   * @param {string} userId - The ID of the user to fetch messages for.
   * @param {number} limit - Maximum number of messages to fetch.
   * @returns {Promise<Array>} Array of filtered user messages.
   */
  async fetchUserMessages(channel, userId, limit) {
    const allMessages = [];
    let lastMessageId = null;

    while (allMessages.length < limit) {
      // Fetch messages with the specified batch size.
      const messages = await channel.messages.fetch({ 
        limit: CONFIG.FETCH.BATCH_SIZE, 
        before: lastMessageId 
      });

      // If no messages are returned, break the loop.
      if (messages.size === 0) break;

      // Filter for messages by the target user.
      const userMessages = messages.filter(msg => msg.author.id === userId);
      
      // Add the filtered user messages to the allMessages array.
      allMessages.push(...userMessages.map(msg => ({
        content: msg.content || CONFIG.INDICATORS.NO_CONTENT,
        attachments: msg.attachments.size > 0,
        embeds: msg.embeds.length > 0,
        timestamp: msg.createdTimestamp,
        channelName: channel.name,
        messageUrl: msg.url
      })));

      // Update lastMessageId for pagination.
      lastMessageId = messages.last().id;

      // If we have reached or exceeded the limit, break the loop.
      if (allMessages.length >= limit) break;
    }

    // Sort messages by timestamp (newest first).
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    
    // Limit to the requested number of messages.
    return allMessages.slice(0, limit);
  },

  /**
   * Creates embed pages for the messages.
   * 
   * @param {Array} messages - Array of message data to display.
   * @param {User} targetUser - The user whose messages are being displayed.
   * @returns {Array<EmbedBuilder>} Array of embed pages.
   */
  createMessageEmbeds(messages, targetUser) {
    const embeds = [];
    const messagesPerEmbed = CONFIG.EMBED.MESSAGES_PER_PAGE;

    for (let i = 0; i < messages.length; i += messagesPerEmbed) {
      const embed = new EmbedBuilder()
        .setColor(CONFIG.EMBED.COLOR)
        .setAuthor({
          name: `Last messages from ${targetUser.username}`,
          iconURL: targetUser.displayAvatarURL()
        })
        .setFooter({
          text: `Page ${Math.floor(i / messagesPerEmbed) + 1}/${Math.ceil(messages.length / messagesPerEmbed)}`
        });
      
      const messagesChunk = messages.slice(i, i + messagesPerEmbed);
      
      messagesChunk.forEach((msg, index) => {
        const messageNumber = i + index + 1;
        const timestamp = Math.floor(msg.timestamp / 1000); // Convert to seconds for Discord.
        let content = msg.content;
        
        // Truncate long messages.
        if (content.length > CONFIG.EMBED.MAX_CONTENT_LENGTH) {
          content = content.substring(0, CONFIG.EMBED.MAX_CONTENT_LENGTH) + CONFIG.EMBED.ELLIPSIS;
        }
        
        // Add indicators for attachments/embeds.
        let extras = [];
        if (msg.attachments) extras.push(CONFIG.INDICATORS.ATTACHMENT);
        if (msg.embeds) extras.push(CONFIG.INDICATORS.EMBED);
        
        const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
        
        // Format the message with channel, content, and dynamic timestamp.
        embed.addFields({
          name: `${messageNumber}. ${msg.channelName} ${extraText}`,
          value: `${CONFIG.INDICATORS.MESSAGE} **Message:** ${content}\n${CONFIG.INDICATORS.TIME} **Posted:** <t:${timestamp}:R>\n[Jump to Message](${msg.messageUrl})`,
          inline: false
        });
      });
      
      embeds.push(embed);
    }

    return embeds;
  },

  /**
   * Creates pagination buttons for navigation.
   * 
   * @param {number} currentPage - Current page index.
   * @param {number} totalPages - Total number of pages.
   * @returns {ActionRowBuilder} Action row with pagination buttons.
   */
  createPaginationButtons(currentPage, totalPages) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(CONFIG.BUTTONS.FIRST.ID)
          .setLabel(CONFIG.BUTTONS.FIRST.LABEL)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(CONFIG.BUTTONS.PREVIOUS.ID)
          .setLabel(CONFIG.BUTTONS.PREVIOUS.LABEL)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(CONFIG.BUTTONS.PAGE_INFO.ID)
          .setLabel(`${currentPage + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(CONFIG.BUTTONS.NEXT.ID)
          .setLabel(CONFIG.BUTTONS.NEXT.LABEL)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages - 1),
        new ButtonBuilder()
          .setCustomId(CONFIG.BUTTONS.LAST.ID)
          .setLabel(CONFIG.BUTTONS.LAST.LABEL)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages - 1),
      );
  },

  /**
   * Sets up the collector for pagination button interactions.
   * 
   * @param {Message} message - The message with the pagination buttons.
   * @param {Interaction} interaction - The original interaction.
   * @param {Array<EmbedBuilder>} embeds - Array of embed pages.
   * @param {number} startPage - Starting page index.
   * @param {number} totalPages - Total number of pages.
   * @returns {Promise<void>}
   */
  async setupPaginationCollector(message, interaction, embeds, startPage, totalPages) {
    let currentPage = startPage;
    
    // Create a collector for button interactions.
    const collector = message.createMessageComponentCollector({ 
      componentType: ComponentType.Button,
      time: CONFIG.COLLECTOR.TIMEOUT
    });
    
    logger.debug("Button collector created.", { 
      timeout: `${CONFIG.COLLECTOR.TIMEOUT / 60000} minutes`,
      pages: totalPages
    });
    
    collector.on('collect', async (i) => {
      // Verify that the button interaction is from the user who ran the command.
      if (i.user.id !== interaction.user.id) {
        logger.warn("Unauthorized button interaction attempted.", { 
          attemptedUserTag: i.user.tag,
          attemptedUserId: i.user.id,
          commandUserTag: interaction.user.tag,
          commandUserId: interaction.user.id
        });
        
        return i.reply({ 
          content: CONFIG.RESPONSES.UNAUTHORIZED_BUTTON, 
          ephemeral: true 
        });
      }
      
      const oldPage = currentPage + 1;
      
      // Handle button interactions.
      switch (i.customId) {
        case CONFIG.BUTTONS.FIRST.ID:
          currentPage = 0;
          break;
        case CONFIG.BUTTONS.PREVIOUS.ID:
          currentPage = Math.max(0, currentPage - 1);
          break;
        case CONFIG.BUTTONS.NEXT.ID:
          currentPage = Math.min(totalPages - 1, currentPage + 1);
          break;
        case CONFIG.BUTTONS.LAST.ID:
          currentPage = totalPages - 1;
          break;
      }
      
      logger.debug("Button interaction processed.", { 
        button: i.customId,
        userTag: i.user.tag,
        oldPage: oldPage,
        newPage: currentPage + 1,
        totalPages: totalPages
      });
      
      // Update the message with the new embed and buttons.
      await i.update({ 
        embeds: [embeds[currentPage]], 
        components: [this.createPaginationButtons(currentPage, totalPages)]
      });
    });
    
    collector.on('end', () => {
      logger.debug("Button collector ended.", { 
        finalPage: currentPage + 1,
        totalPages: totalPages
      });
      
      // Remove buttons when collector expires.
      interaction.editReply({ 
        embeds: [embeds[currentPage]], 
        components: [] 
      }).catch((error) => {
        logger.error("Failed to remove buttons after collector timeout.", { 
          error: error.message 
        });
      });
    });
  }
};
