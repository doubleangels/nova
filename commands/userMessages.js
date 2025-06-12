const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { createPaginatedResults } = require('../utils/searchUtils');

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
          content: "⚠️ This command cannot be used in direct messages.",
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
        messagesPerPage: 10,
        totalMessages: allMessages.length
      });
      
      await interaction.editReply({ content: summaryText });
      
      const generateEmbed = (index) => embeds[index];
      
      await createPaginatedResults(
        interaction,
        embeds,
        generateEmbed,
        'usermsg',
        300000,
        logger,
        {
          buttonStyle: 'Primary',
          prevLabel: 'Previous',
          nextLabel: 'Next',
          prevEmoji: '◀️',
          nextEmoji: '▶️'
        }
      );
      
      logger.info("/usermessages command completed successfully:", {
        targetUserId: targetUser.id,
        messageCount: allMessages.length,
        timeRange: dayLimit ? `last ${dayLimit} day${dayLimit !== 1 ? 's' : ''}` : "all time"
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
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
      targetChannel,
      messageLimit,
      filterText,
      dayLimit
    };
  },

  async fetchUserMessages(channel, userId, limit, filterText = null, dayLimit = null) {
    const allMessages = [];
    let lastMessageId = null;
    
    const cutoffTimestamp = dayLimit 
      ? Date.now() - (dayLimit * 24 * 60 * 60 * 1000) 
      : null;

    const filterTextLower = filterText ? filterText.toLowerCase() : null;

    while (allMessages.length < limit) {
      const messages = await channel.messages.fetch({ 
        limit: 100, 
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
        content: msg.content || '[No text content]',
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

  createMessageEmbeds(messages, targetUser, targetChannel) {
    const embeds = [];
    const messagesPerEmbed = 10;

    for (let i = 0; i < messages.length; i += messagesPerEmbed) {
      const embed = new EmbedBuilder()
        .setColor(0xcd41ff)
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
        
        if (content.length > 200) {
          content = content.substring(0, 200) + '...';
        }
        
        let extras = [];
        if (msg.attachments) extras.push('📎');
        if (msg.embeds) extras.push('🖼️');
        if (msg.hasCodeBlock) extras.push('`');
        if (msg.reactionCount > 0) extras.push(`💬 ${msg.reactionCount}`);
        
        const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
        
        embed.addFields({
          name: `${messageNumber}. ${extraText}`,
          value: `📜 **Message:** ${content}\n⏰ **Posted:** <t:${timestamp}:R>\n[Jump to Message](${msg.messageUrl})`,
          inline: false
        });
      });
      
      embeds.push(embed);
    }

    return embeds;
  },
  
  async handleError(interaction, error) {
    logger.error("Error in usermessages command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching user messages.";
    
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
    } else if (error.message === "INVALID_LIMIT") {
      errorMessage = "⚠️ Invalid message limit specified.";
    } else if (error.message === "INVALID_DAYS") {
      errorMessage = "⚠️ Invalid day limit specified.";
    } else if (error.message === "CHANNEL_NOT_FOUND") {
      errorMessage = "⚠️ The specified channel could not be found.";
    } else if (error.message === "NO_MESSAGES") {
      errorMessage = "⚠️ No messages found matching your criteria.";
    } else if (error.message === "INVALID_FILTER") {
      errorMessage = "⚠️ Invalid filter specified.";
    } else if (error.message === "PERMISSION_DENIED") {
      errorMessage = "⚠️ You don't have permission to use this command.";
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
      }).catch(() => {});
    }
  }
};