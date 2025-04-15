const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Configuration constants.
const MESSAGES_EMBED_COLOR = 0xcd41ff;
const MESSAGES_PER_PAGE = 10;
const MAX_CONTENT_LENGTH = 200;
const CONTENT_ELLIPSIS = '...';
const BUTTON_COLLECTOR_TIMEOUT = 300000; // 5 minutes
const ATTACHMENT_INDICATOR = '📎';
const EMBED_INDICATOR = '🖼️';
const MESSAGE_INDICATOR = '📜';
const TIME_INDICATOR = '⏰';
const NO_CONTENT_TEXT = '[No text content]';
const MESSAGE_FETCH_BATCH_SIZE = 100; // Number of messages to fetch in each batch

module.exports = {
  data: new SlashCommandBuilder()
    .setName('usermessages')
    .setDescription('Lists the last messages from a specific user in a specified channel.')
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
        .setDescription('Only show messages containing this text (optional)')
        .setRequired(false))
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('Only show messages from the last X days (optional)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365)),

  /**
   * Executes the usermessages command.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      logger.debug("User messages command received.", { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag,
        guildName: interaction.guild?.name,
        guildId: interaction.guild?.id
      });
      
      // Handle DM case
      if (!interaction.guild) {
        logger.warn("Command used in DMs where it's not supported.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag
        });
        
        return await interaction.reply({
          content: "⚠️ This command can only be used in servers, not in direct messages.",
          ephemeral: true
        });
      }
      
      // Defer reply as ephemeral since this might take some time.
      await interaction.deferReply({ 
        ephemeral: true 
      });
      
      // Get the command options
      const commandOptions = await this.parseOptions(interaction);
      
      if (!commandOptions.valid) {
        return await interaction.editReply({
          content: commandOptions.errorMessage,
          ephemeral: true
        });
      }
      
      const { targetUser, targetChannel, messageLimit, filterText, dayLimit } = commandOptions;
      
      logger.info("Fetching messages for user.", { 
        targetUserTag: targetUser.tag, 
        targetUserId: targetUser.id,
        requestedByUserTag: interaction.user.tag,
        requestedByUserId: interaction.user.id,
        filterText: filterText || "None",
        dayLimit: dayLimit || "None"
      });

      // Fetch messages in batches until the desired limit is reached.
      const allMessages = await this.fetchUserMessages(
        targetChannel, 
        targetUser.id, 
        messageLimit,
        filterText,
        dayLimit
      );
      
      // Handle case where no messages are found.
      if (allMessages.length === 0) {
        logger.info("No messages found for user.", { 
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
      
      // Create embeds for the messages.
      const embeds = this.createMessageEmbeds(allMessages, targetUser, targetChannel);
      
      logger.debug("Created message embeds.", { 
        embedCount: embeds.length, 
        messagesPerPage: MESSAGES_PER_PAGE,
        totalMessages: allMessages.length
      });
      
      // Send the first embed with pagination buttons if needed.
      let currentPage = 0;
      const totalPages = embeds.length;
      
      // Create summary text
      let summaryText = `Found ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''} from ${targetUser.username} in ${targetChannel.name}`;
      
      if (filterText) {
        summaryText += ` containing "${filterText}"`;
      }
      
      if (dayLimit) {
        summaryText += ` from the last ${dayLimit} day${dayLimit !== 1 ? 's' : ''}`;
      }
      
      summaryText += '.';
      
      const message = await interaction.editReply({ 
        content: summaryText,
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
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Parses and validates command options.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<Object>} Validated command options.
   */
  async parseOptions(interaction) {
    // Get the target user and channel from options.
    const targetUser = interaction.options.getUser('user');
    const targetChannel = interaction.options.getChannel('channel');
    const messageLimit = interaction.options.getInteger('limit') || 50;
    const filterText = interaction.options.getString('contains');
    const dayLimit = interaction.options.getInteger('days');
    
    logger.debug("Command parameters retrieved.", { 
      targetUserTag: targetUser?.tag,
      targetUserId: targetUser?.id,
      targetChannelName: targetChannel?.name,
      targetChannelId: targetChannel?.id,
      messageLimit,
      filterText: filterText || "None",
      dayLimit: dayLimit || "None"
    });
    
    // Verify the target user exists.
    if (!targetUser) {
      logger.warn("Target user not found.", { 
        requestedByUserId: interaction.user.id,
        requestedByUserTag: interaction.user.tag 
      });
      
      return {
        valid: false,
        errorMessage: '⚠️ User not found.'
      };
    }
    
    // Check if the specified channel is a text channel.
    if (targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildAnnouncement) {
      logger.warn("Invalid channel type specified.", { 
        channelName: targetChannel.name, 
        channelId: targetChannel.id,
        channelType: targetChannel.type
      });
      
      return {
        valid: false,
        errorMessage: '⚠️ Please select a valid text channel.'
      };
    }
    
    // Check if the user has permission to view the channel
    const member = interaction.member;
    if (!targetChannel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) {
      logger.warn("User lacks permission to view the specified channel.", {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelName: targetChannel.name,
        channelId: targetChannel.id
      });
      
      return {
        valid: false,
        errorMessage: `⚠️ You don't have permission to view messages in ${targetChannel.name}.`
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
   * Fetches messages from a specific user in a channel.
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
    
    // Calculate the cutoff date if a day limit is specified
    const cutoffTimestamp = dayLimit 
      ? Date.now() - (dayLimit * 24 * 60 * 60 * 1000) 
      : null;

    // Convert filterText to lowercase for case-insensitive comparison
    const filterTextLower = filterText ? filterText.toLowerCase() : null;

    while (allMessages.length < limit) {
      // Fetch messages with the specified batch size.
      const messages = await channel.messages.fetch({ 
        limit: MESSAGE_FETCH_BATCH_SIZE, 
        before: lastMessageId 
      });

      // If no messages are returned, break the loop.
      if (messages.size === 0) break;

      // Filter for messages by the target user.
      const userMessages = messages.filter(msg => {
        // Filter by user ID
        if (msg.author.id !== userId) return false;
        
        // Filter by date if specified
        if (cutoffTimestamp && msg.createdTimestamp < cutoffTimestamp) return false;
        
        // Filter by content if specified
        if (filterTextLower && !msg.content.toLowerCase().includes(filterTextLower)) return false;
        
        return true;
      });
      
      // Add the filtered user messages to the allMessages array.
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

      // Update lastMessageId for pagination.
      lastMessageId = messages.last().id;

      // If we have reached or exceeded the limit, break the loop.
      if (allMessages.length >= limit) break;
      
      // If we're filtering by date and the oldest message is older than the cutoff, break the loop
      if (cutoffTimestamp && messages.last().createdTimestamp < cutoffTimestamp) break;
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
        const timestamp = Math.floor(msg.timestamp / 1000); // Convert to seconds for Discord.
        let content = msg.content;
        
        // Truncate long messages.
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.substring(0, MAX_CONTENT_LENGTH) + CONTENT_ELLIPSIS;
        }
        
        // Add indicators for attachments/embeds.
        let extras = [];
        if (msg.attachments) extras.push(ATTACHMENT_INDICATOR);
        if (msg.embeds) extras.push(EMBED_INDICATOR);
        if (msg.hasCodeBlock) extras.push('`');
        if (msg.reactionCount > 0) extras.push(`💬 ${msg.reactionCount}`);
        
        const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
        
        // Format the message with channel, content, and dynamic timestamp.
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
          .setCustomId('first')
          .setLabel('<<')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('previous')
          .setLabel('<')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('page_info')
          .setLabel(`${currentPage + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('>')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages - 1),
        new ButtonBuilder()
          .setCustomId('last')
          .setLabel('>>')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages - 1),
      );
  },

  /**
   * Sets up the collector for pagination button interactions.
   * 
   * @param {Message} message - The message with the pagination buttons.
   * @param {ChatInputCommandInteraction} interaction - The original interaction.
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
      time: BUTTON_COLLECTOR_TIMEOUT
    });
    
    logger.debug("Button collector created.", { 
      timeout: `${BUTTON_COLLECTOR_TIMEOUT / 60000} minutes`,
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
          content: 'You cannot use these buttons.', 
          ephemeral: true 
        });
      }
      
      const oldPage = currentPage + 1;
      
      // Handle button interactions.
      switch (i.customId) {
        case 'first':
          currentPage = 0;
          break;
        case 'previous':
          currentPage = Math.max(0, currentPage - 1);
          break;
        case 'next':
          currentPage = Math.min(totalPages - 1, currentPage + 1);
          break;
        case 'last':
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
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error executing user messages command.", { 
      error: error.message,
      stack: error.stack,
      userTag: interaction.user?.tag,
      guildName: interaction.guild?.name
    });
    
    try {
      const replyMethod = (interaction.deferred || interaction.replied) ? 'editReply' : 'reply';
      
      await interaction[replyMethod]({ 
        content: '⚠️ There was an error fetching the messages. Please try again later.', 
        ephemeral: true 
      });
    } catch (err) {
      logger.error("Failed to send error message to user.", { 
        error: err.message 
      });
    }
  }
};