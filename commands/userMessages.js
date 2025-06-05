/**
 * User messages command module for retrieving and displaying user message statistics.
 * Handles message counting, data aggregation, and result formatting.
 * @module commands/userMessages
 */

const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { createPaginatedResults } = require('../utils/searchUtils');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// These are the configuration constants for the user messages command.
const MESSAGES_EMBED_COLOR = 0xcd41ff;
const MESSAGES_PER_PAGE = 10;
const MAX_CONTENT_LENGTH = 200;
const CONTENT_ELLIPSIS = '...';
const BUTTON_COLLECTOR_TIMEOUT = 300000; // We set a 5-minute timeout for the pagination.
const ATTACHMENT_INDICATOR = '📎';
const EMBED_INDICATOR = '🖼️';
const MESSAGE_INDICATOR = '📜';
const TIME_INDICATOR = '⏰';
const NO_CONTENT_TEXT = '[No text content]';
const MESSAGE_FETCH_BATCH_SIZE = 100; // We fetch messages in batches of 100 for efficiency.

/**
 * We handle the usermessages command.
 * This function allows users to search and display messages from a specific user in a channel.
 *
 * We perform several tasks:
 * 1. We validate command parameters and permissions.
 * 2. We search for messages in the specified channel.
 * 3. We filter messages based on user and optional criteria.
 * 4. We format and display the results.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('usermessages')
    .setDescription('List the last messages from a specific user in a specified channel.')
    .addUserOption(option => 
      option
        .setName('user')
        .setDescription("What user's messages do you want to see?")
        .setRequired(true))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('What channel do you want to search in?')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
    .addIntegerOption(option =>
      option
        .setName('limit')
        .setDescription('How many messages do you want to display? (1-50, Default: 50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50))
    .addStringOption(option =>
      option
        .setName('contains')
        .setDescription('What text should the messages contain?')
        .setRequired(false))
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('How many days back do you want to search? (1-365, Default: 1)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365)),

  /**
   * Executes the user messages command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the message statistics retrieval fails
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      const targetUser = interaction.options.getUser('user');
      
      logger.info("/usermessages command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        targetUserId: targetUser.id
      });

      const stats = await this.getUserMessageStats(interaction.guild, targetUser);
      
      if (stats.error) {
        return await interaction.editReply({
          content: stats.message,
          ephemeral: true
        });
      }
      
      await interaction.editReply(stats.message);
      logger.info("User message statistics retrieved successfully.", {
        userId: interaction.user.id,
        targetUserId: targetUser.id,
        messageCount: stats.messageCount
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Retrieves message statistics for a user in a guild.
   * @async
   * @function getUserMessageStats
   * @param {import('discord.js').Guild} guild - The guild to search in
   * @param {import('discord.js').User} user - The user to get statistics for
   * @returns {Promise<Object>} The message statistics with formatted message
   */
  async getUserMessageStats(guild, user) {
    try {
      let messageCount = 0;
      const channels = await guild.channels.fetch();
      
      for (const channel of channels.values()) {
        if (channel.isTextBased()) {
          try {
            const messages = await channel.messages.fetch({ limit: 100 });
            messageCount += messages.filter(msg => msg.author.id === user.id).size;
          } catch (error) {
            logger.warn("Failed to fetch messages from channel:", {
              channelId: channel.id,
              error: error.message
            });
          }
        }
      }
      
      if (messageCount === 0) {
        return {
          error: true,
          message: `No messages found for ${user.tag} in this server.`,
          messageCount: 0
        };
      }
      
      const message = this.formatMessageStats(user, messageCount);
      
      return {
        error: false,
        message,
        messageCount
      };
    } catch (error) {
      logger.error("Error retrieving user message statistics:", {
        error: error.message,
        userId: user.id
      });
      throw error;
    }
  },
  
  /**
   * Formats message statistics into a display message.
   * @function formatMessageStats
   * @param {import('discord.js').User} user - The user the statistics are for
   * @param {number} messageCount - The number of messages found
   * @returns {string} The formatted statistics message
   */
  formatMessageStats(user, messageCount) {
    return `📊 **Message Statistics for ${user.tag}**\n\n` +
           `• **Total Messages**: ${messageCount}\n` +
           `• **Last 100 Messages**: ${messageCount} (in channels with read access)`;
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'usermessages', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    const errorMessage = getErrorMessage(error);
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for user messages command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
      });
    }
  },

  /**
   * We parse and validate command options.
   * This function checks and returns validated command options.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<Object>} Validated command options.
   */
  async parseOptions(interaction) {
    // We get the target user and channel from the command options.
    const targetUser = interaction.options.getUser('user');
    const targetChannel = interaction.options.getChannel('channel');
    const messageLimit = interaction.options.getInteger('limit') || 50;
    const filterText = interaction.options.getString('contains');
    const dayLimit = interaction.options.getInteger('days');
    
    logger.debug("Processing command options:", {
      targetUser: targetUser.id,
      timeRange: dayLimit ? `last ${dayLimit} day${dayLimit !== 1 ? 's' : ''}` : "all time"
    });
    
    // We verify that the target user exists.
    if (!targetUser) {
      logger.warn("Target user not found in guild:", {
        userId: targetUser.id,
        guildId: interaction.guildId
      });
      
      return {
        valid: false,
        errorMessage: ERROR_MESSAGES.USER_NOT_FOUND
      };
    }
    
    // We check if the specified channel is a valid text channel.
    if (targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildAnnouncement) {
      logger.warn("Invalid channel type specified:", { 
        channelName: targetChannel.name, 
        channelId: targetChannel.id,
        channelType: targetChannel.type
      });
      
      return {
        valid: false,
        errorMessage: ERROR_MESSAGES.INVALID_CHANNEL_TYPE
      };
    }
    
    // We check if the user has permission to view the channel.
    const member = interaction.member;
    if (!targetChannel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) {
      logger.warn("User lacks permission to view the specified channel:", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelName: targetChannel.name,
        channelId: targetChannel.id
      });
      
      return {
        valid: false,
        errorMessage: ERROR_MESSAGES.NO_PERMISSION_TO_VIEW_CHANNEL
      };
    }
    
    return {
      valid: true,
      targetUser,
      targetChannel,
      messageLimit,
      filterText,
      dayLimit
    };
  },

  /**
   * We fetch messages from a specific user in a channel.
   * This function retrieves and filters messages for the user.
   *
   * @param {TextChannel} channel - The channel to search in.
   * @param {string} userId - The ID of the user to fetch messages for.
   * @param {number} limit - Maximum number of messages to fetch.
   * @param {string|null} filterText - Optional text to filter messages by.
   * @param {number|null} dayLimit - Optional day limit to filter messages by.
   * @returns {Promise<Array>} Array of filtered user messages.
   */
  async fetchUserMessages(channel, userId, limit, filterText = null, dayLimit = null) {
    const allMessages = [];
    let lastMessageId = null;
    
    // We calculate the cutoff date if a day limit is specified.
    const cutoffTimestamp = dayLimit 
      ? Date.now() - (dayLimit * 24 * 60 * 60 * 1000) 
      : null;

    // We convert filterText to lowercase for case-insensitive comparison.
    const filterTextLower = filterText ? filterText.toLowerCase() : null;

    while (allMessages.length < limit) {
      // We fetch messages with the specified batch size.
      const messages = await channel.messages.fetch({ 
        limit: MESSAGE_FETCH_BATCH_SIZE, 
        before: lastMessageId 
      });

      // If no messages are returned, we break the loop.
      if (messages.size === 0) break;

      // We filter for messages by the target user.
      const userMessages = messages.filter(msg => {
        // We filter by user ID.
        if (msg.author.id !== userId) return false;
        
        // We filter by date if specified.
        if (cutoffTimestamp && msg.createdTimestamp < cutoffTimestamp) return false;
        
        // We filter by content if specified.
        if (filterTextLower && !msg.content.toLowerCase().includes(filterTextLower)) return false;
        
        return true;
      });
      
      // We add the filtered user messages to the allMessages array.
      allMessages.push(...userMessages.map(msg => ({
        content: msg.content || NO_CONTENT_TEXT,
        attachments: msg.attachments.size > 0,
        embeds: msg.embeds.length > 0,
        timestamp: msg.createdTimestamp,
        channelName: channel.name,
        messageUrl: msg.url,
        hasCodeBlock: msg.content.includes('```') || msg.content.includes('`'),
        reactionCount: msg.reactions.cache.size
      })));

      // We update lastMessageId for pagination.
      lastMessageId = messages.last().id;

      // If we have reached or exceeded the limit, we break the loop.
      if (allMessages.length >= limit) break;
      
      // If we're filtering by date and the oldest message is older than the cutoff, we break the loop.
      if (cutoffTimestamp && messages.last().createdTimestamp < cutoffTimestamp) break;
    }

    // We sort messages by timestamp (newest first).
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    
    // We limit to the requested number of messages.
    return allMessages.slice(0, limit);
  },

  /**
   * We create embed pages for the messages.
   * This function formats messages into paginated embeds.
   *
   * @param {Array} messages - Array of message data to display.
   * @param {User} targetUser - The user whose messages are being displayed.
   * @param {Channel} targetChannel - The channel where messages were found.
   * @returns {Array<EmbedBuilder>} Array of embed pages.
   */
  createMessageEmbeds(messages, targetUser, targetChannel) {
    const embeds = [];
    const messagesPerEmbed = MESSAGES_PER_PAGE;

    for (let i = 0; i < messages.length; i += messagesPerEmbed) {
      const embed = new EmbedBuilder()
        .setColor(MESSAGES_EMBED_COLOR)
        .setAuthor({
          name: `Messages from ${targetUser.username} in #${targetChannel.name}`,
          iconURL: targetUser.displayAvatarURL()
        })
        .setFooter({
          text: `Page ${Math.floor(i / messagesPerEmbed) + 1}/${Math.ceil(messages.length / messagesPerEmbed)}`
        });
      
      const messagesChunk = messages.slice(i, i + messagesPerEmbed);
      
      messagesChunk.forEach((msg, index) => {
        const messageNumber = i + index + 1;
        const timestamp = Math.floor(msg.timestamp / 1000); // We convert to seconds for Discord timestamp format.
        let content = msg.content;
        
        // We truncate long messages for readability.
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.substring(0, MAX_CONTENT_LENGTH) + CONTENT_ELLIPSIS;
        }
        
        // We add indicators for attachments/embeds.
        let extras = [];
        if (msg.attachments) extras.push(ATTACHMENT_INDICATOR);
        if (msg.embeds) extras.push(EMBED_INDICATOR);
        if (msg.hasCodeBlock) extras.push('`');
        if (msg.reactionCount > 0) extras.push(`💬 ${msg.reactionCount}`);
        
        const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
        
        // We format the message with content, timestamp, and a jump link.
        embed.addFields({
          name: `${messageNumber}. ${extraText}`,
          value: `${MESSAGE_INDICATOR} **Message:** ${content}\n${TIME_INDICATOR} **Posted:** <t:${timestamp}:R>\n[Jump to Message](${msg.messageUrl})`,
          inline: false
        });
      });
      
      embeds.push(embed);
    }

    return embeds;
  }
};