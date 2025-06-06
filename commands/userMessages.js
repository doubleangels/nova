const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { createPaginatedResults } = require('../utils/searchUtils');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const MESSAGES_EMBED_COLOR = 0xcd41ff;
const MESSAGES_PER_PAGE = 10;
const MAX_CONTENT_LENGTH = 200;
const CONTENT_ELLIPSIS = '...';
const BUTTON_COLLECTOR_TIMEOUT = 300000;
const ATTACHMENT_INDICATOR = '📎';
const EMBED_INDICATOR = '🖼️';
const MESSAGE_INDICATOR = '📜';
const TIME_INDICATOR = '⏰';
const NO_CONTENT_TEXT = '[No text content]';
const MESSAGE_FETCH_BATCH_SIZE = 100;

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
        .setDescription('How many days back do you want to search? (1-365, Default: None)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365)),

  /**
   * We execute the /usermessages command.
   * This function processes the user message search and displays results.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>} Resolves when the command is complete.
   */
  async execute(interaction) {
    try {
      logger.info("/usermessages command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      if (!interaction.guild) {
        logger.warn("Command used in DMs where it's not supported:", {
          userId: interaction.user.id,
          userTag: interaction.user.tag
        });
        
        return await interaction.reply({
          content: ERROR_MESSAGES.DM_NOT_SUPPORTED,
          ephemeral: true
        });
      }
      
      await interaction.deferReply();
      
      const commandOptions = await this.parseOptions(interaction);
      
      if (!commandOptions.valid) {
        return await interaction.editReply({
          content: commandOptions.errorMessage,
          ephemeral: true
        });
      }
      
      const { targetUser, targetChannel, messageLimit, filterText, dayLimit } = commandOptions;
      
      logger.info("Fetching messages for user:", { 
        targetUserTag: targetUser.tag, 
        targetUserId: targetUser.id,
        requestedByUserTag: interaction.user.tag,
        requestedByUserId: interaction.user.id,
        filterText: filterText || "None",
        dayLimit: dayLimit || "None"
      });

      const allMessages = await this.fetchUserMessages(
        targetChannel, 
        targetUser.id, 
        messageLimit,
        filterText,
        dayLimit
      );
      
      if (allMessages.length === 0) {
        logger.info("No messages found for user:", { 
          targetUserTag: targetUser.tag,
          channelName: targetChannel.name
        });
        
        let noMessagesText = `No recent messages found from ${targetUser.username} in ${targetChannel.name}.`;
        
        if (filterText) {
          noMessagesText += ` with text containing "${filterText}"`;
        }
        
        if (dayLimit) {
          noMessagesText += ` from the last ${dayLimit} days`;
        }
        
        return interaction.editReply({
          content: noMessagesText,
          ephemeral: true 
        });
      }
      
      let summaryText = `Found ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''} from ${targetUser.username} in ${targetChannel.name}`;
      
      if (filterText) {
        summaryText += ` containing "${filterText}"`;
      }
      
      if (dayLimit) {
        summaryText += ` from the last ${dayLimit} day${dayLimit !== 1 ? 's' : ''}`;
      }
      
      summaryText += '.';
      
      const embeds = this.createMessageEmbeds(allMessages, targetUser, targetChannel);
      
      logger.debug("Created message embeds:", { 
        embedCount: embeds.length, 
        messagesPerPage: MESSAGES_PER_PAGE,
        totalMessages: allMessages.length
      });
      
      await interaction.editReply({ content: summaryText });
      
      const generateEmbed = (index) => embeds[index];
      
      await createPaginatedResults(
        interaction,
        embeds,
        generateEmbed,
        'usermsg',
        BUTTON_COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: 'Primary',
          prevLabel: 'Previous',
          nextLabel: 'Next',
          prevEmoji: '◀️',
          nextEmoji: '▶️'
        }
      );
      
      logger.info("User messages command completed:", {
        targetUserId: targetUser.id,
        messageCount: allMessages.length,
        timeRange: dayLimit ? `last ${dayLimit} day${dayLimit !== 1 ? 's' : ''}` : "all time"
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
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
    const targetUser = interaction.options.getUser('user');
    const targetChannel = interaction.options.getChannel('channel');
    const messageLimit = interaction.options.getInteger('limit') || 50;
    const filterText = interaction.options.getString('contains');
    const dayLimit = interaction.options.getInteger('days');
    
    logger.debug("Processing command options:", {
      targetUser: targetUser.id,
      timeRange: dayLimit ? `last ${dayLimit} day${dayLimit !== 1 ? 's' : ''}` : "all time"
    });
    
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
    
    const cutoffTimestamp = dayLimit 
      ? Date.now() - (dayLimit * 24 * 60 * 60 * 1000) 
      : null;

    const filterTextLower = filterText ? filterText.toLowerCase() : null;

    while (allMessages.length < limit) {
      const messages = await channel.messages.fetch({ 
        limit: MESSAGE_FETCH_BATCH_SIZE, 
        before: lastMessageId 
      });

      if (messages.size === 0) break;

      const userMessages = messages.filter(msg => {
        if (msg.author.id !== userId) return false;
        
        if (cutoffTimestamp && msg.createdTimestamp < cutoffTimestamp) return false;
        
        if (filterTextLower && !msg.content.toLowerCase().includes(filterTextLower)) return false;
        
        return true;
      });
      
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

      lastMessageId = messages.last().id;

      if (allMessages.length >= limit) break;
      
      if (cutoffTimestamp && messages.last().createdTimestamp < cutoffTimestamp) break;
    }

    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    
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
        const timestamp = Math.floor(msg.timestamp / 1000);
        let content = msg.content;
        
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.substring(0, MAX_CONTENT_LENGTH) + CONTENT_ELLIPSIS;
        }
        
        let extras = [];
        if (msg.attachments) extras.push(ATTACHMENT_INDICATOR);
        if (msg.embeds) extras.push(EMBED_INDICATOR);
        if (msg.hasCodeBlock) extras.push('`');
        if (msg.reactionCount > 0) extras.push(`💬 ${msg.reactionCount}`);
        
        const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
        
        embed.addFields({
          name: `${messageNumber}. ${extraText}`,
          value: `${MESSAGE_INDICATOR} **Message:** ${content}\n${TIME_INDICATOR} **Posted:** <t:${timestamp}:R>\n[Jump to Message](${msg.messageUrl})`,
          inline: false
        });
      });
      
      embeds.push(embed);
    }

    return embeds;
  },
  
  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'usermessages', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "DM_NOT_SUPPORTED") {
      errorMessage = ERROR_MESSAGES.DM_NOT_SUPPORTED;
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = ERROR_MESSAGES.USER_NOT_FOUND;
    } else if (error.message === "INVALID_CHANNEL_TYPE") {
      errorMessage = ERROR_MESSAGES.INVALID_CHANNEL_TYPE;
    } else if (error.message === "NO_PERMISSION_TO_VIEW_CHANNEL") {
      errorMessage = ERROR_MESSAGES.NO_PERMISSION_TO_VIEW_CHANNEL;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for usermessages command:", {
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
  }
};