const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for finding the last message from a specific user in a channel.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('lastmessage')
    .setDescription('Find the last message from a specific user in a channel.')
    .addUserOption(option => 
      option
        .setName('user')
        .setDescription("What user's last message do you want to find?")
        .setRequired(true))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('What channel do you want to search in?')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)),

  /**
   * Executes the last message search command.
   * This function:
   * 1. Validates command options
   * 2. Fetches the last message from the user
   * 3. Displays the result in an embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error fetching the message
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      logger.info("/lastmessage command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      await interaction.deferReply();
      
      const commandOptions = await this.parseOptions(interaction);
      
      if (!commandOptions.valid) {
        return await interaction.editReply({
          content: commandOptions.errorMessage,
          ephemeral: true
        });
      }
      
      const { targetUser, targetChannel } = commandOptions;
      
      logger.info("Searching for last message from user:", { 
        targetUserTag: targetUser.tag, 
        targetUserId: targetUser.id,
        requestedByUserTag: interaction.user.tag,
        requestedByUserId: interaction.user.id
      });

      const lastMessage = await this.findLastMessage(
        targetChannel, 
        targetUser.id
      );
      
      if (!lastMessage) {
        logger.info("No message found for user:", { 
          targetUserTag: targetUser.tag,
          channelName: targetChannel.name
        });
        
        let noMessageText = `No recent message found from ${targetUser.username} in ${targetChannel.name}`;
        
        return interaction.editReply({
          content: noMessageText,
          ephemeral: true 
        });
      }
      
      const embed = this.createLastMessageEmbed(lastMessage, targetUser, targetChannel);
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/lastmessage command completed successfully:", {
        targetUserId: targetUser.id,
        messageId: lastMessage.messageId,
        timeRange: "all time"
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Parses and validates command options.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<Object>} Object containing validated options or error information
   */
  async parseOptions(interaction) {
    const targetUser = interaction.options.getUser('user');
    const targetChannel = interaction.options.getChannel('channel');
    
    logger.debug("Processing command options:", {
      targetUser: targetUser.id,
      timeRange: "all time"
    });
    
    if (!targetUser) {
      logger.warn("Target user not found in guild:", {
        userId: targetUser.id,
        guildId: interaction.guildId
      });
      
      return {
        valid: false,
        errorMessage: "⚠️ The specified user could not be found."
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
        errorMessage: "⚠️ Please select a text or announcement channel."
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
        errorMessage: "⚠️ You don't have permission to view messages in this channel."
      };
    }
    
    return {
      valid: true,
      targetUser,
      targetChannel
    };
  },

  /**
   * Finds the last message from a user in a specific channel.
   * 
   * @param {TextChannel|NewsChannel} channel - The channel to search in
   * @param {string} userId - The ID of the user to search for
   * @param {number|null} dayLimit - Number of days to look back
   * @returns {Promise<Object|null>} The last message object or null if none found
   */
  async findLastMessage(channel, userId) {

    let lastMessageId = null;
    let lastUserMessage = null;

    while (true) {
      const messages = await channel.messages.fetch({ 
        limit: 100, 
        before: lastMessageId 
      });

      if (messages.size === 0) break;

      const userMessages = messages.filter(msg => msg.author.id === userId);
      
      if (userMessages.size > 0) {
        const message = userMessages.first();
        lastUserMessage = {
          content: message.content || '[No text content]',
          attachments: message.attachments.size > 0,
          embeds: message.embeds.length > 0,
          timestamp: message.createdTimestamp,
          channelName: channel.name,
          messageUrl: message.url,
          hasCodeBlock: message.content.includes('```') || message.content.includes('`'),
          reactionCount: message.reactions.cache.size,
          messageId: message.id
        };
        break;
      }

      lastMessageId = messages.last().id;
      
      // search all time until exhausted
    }

    return lastUserMessage;
  },

  /**
   * Creates an embed for displaying the last message.
   * 
   * @param {Object} message - The message object
   * @param {User} targetUser - The user whose message is being displayed
   * @param {TextChannel|NewsChannel} targetChannel - The channel being searched
   * @param {number|null} dayLimit - The day limit used in search
   * @returns {EmbedBuilder} The formatted embed message
   */
  createLastMessageEmbed(message, targetUser, targetChannel) {
    const embed = new EmbedBuilder()
      .setColor(0xcd41ff)
      .setAuthor({
        name: `🔍 Last Message from ${targetUser.username} in #${targetChannel.name}`,
        iconURL: targetUser.displayAvatarURL()
      })
      .setFooter({
        text: `Powered by Discord API`
      });
    
    let content = message.content;
    
    if (content.length > 200) {
      content = content.substring(0, 200) + '...';
    }
    
    let extras = [];
    if (message.attachments) extras.push('📎');
    if (message.embeds) extras.push('🖼️');
    if (message.hasCodeBlock) extras.push('`');
    if (message.reactionCount > 0) extras.push(`💬 ${message.reactionCount}`);
    
    const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
    const timestamp = Math.floor(message.timestamp / 1000);
    
    embed.addFields({
      name: `📜 Message${extraText}`,
      value: `**Content:** ${content}\n**Posted:** <t:${timestamp}:R>\n[Jump to Message](${message.messageUrl})`,
      inline: false
    });

    return embed;
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in lastmessage command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching the last message.";
    
    if (error.message === "DM_NOT_SUPPORTED") {
      errorMessage = "⚠️ This command cannot be used in direct messages.";
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = "⚠️ The specified user could not be found.";
    } else if (error.message === "INVALID_CHANNEL") {
      errorMessage = "⚠️ Please select a text or announcement channel.";
    } else if (error.message === "NO_PERMISSION") {
      errorMessage = "⚠️ You don't have permission to view messages in this channel.";
    } else if (error.message === "FETCH_FAILED") {
      errorMessage = "⚠️ Failed to fetch messages. Please try again later.";
    } else if (error.message === "INVALID_DAYS") {
      errorMessage = "⚠️ Invalid day limit specified.";
    } else if (error.message === "CHANNEL_NOT_FOUND") {
      errorMessage = "⚠️ The specified channel could not be found.";
    } else if (error.message === "NO_MESSAGES") {
      errorMessage = "⚠️ No messages found matching your criteria.";
    } else if (error.message === "PERMISSION_DENIED") {
      errorMessage = "⚠️ You don't have permission to use this command.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for lastmessage command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {});
    }
  }
};
