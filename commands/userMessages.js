const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('usermessages')
    .setDescription('Lists the last 50 messages from a specific user in a specified channel.')
    .addUserOption(option => 
      option
        .setName('user')
        .setDescription("What user's messages do you want to see?")
        .setRequired(true))
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('What channel do you want to search in?')
        .setRequired(true))
    .addIntegerOption(option =>
      option
        .setName('limit')
        .setDescription('How many messages do you want to display? (1-50, Default: 50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)),

  async execute(interaction) {
    try {
      logger.debug("Usermessages command received:", { 
        user: interaction.user.tag, 
        userId: interaction.user.id,
        guild: interaction.guild.name,
        guildId: interaction.guild.id
      });
      
      // Defer reply as ephemeral since this might take some time
      await interaction.deferReply({ ephemeral: true });
      
      // Get the target user and channel from options
      const targetUser = interaction.options.getUser('user');
      const targetChannel = interaction.options.getChannel('channel'); // Get the specified channel
      const messageLimit = interaction.options.getInteger('limit') || 50;
      
      logger.debug("Target user and channel retrieved:", { 
        targetUser: targetUser?.tag,
        targetUserId: targetUser?.id,
        targetChannel: targetChannel?.name,
        targetChannelId: targetChannel?.id,
        messageLimit
      });
      
      if (!targetUser) {
        logger.warn("Target user not found:", { requestedBy: interaction.user.tag });
        return interaction.editReply('User not found.');
      }
      
      logger.info(`Fetching messages for user:`, { 
        targetUser: targetUser.tag, 
        targetUserId: targetUser.id,
        requestedBy: interaction.user.tag
      });
      
      // Check if the specified channel is a text channel
      if (targetChannel.type !== 0) { // 0 is TextChannel
        logger.warn("Invalid channel type:", { 
          channelName: targetChannel.name, 
          channelId: targetChannel.id 
        });
        return interaction.editReply('Please select a valid text channel.');
      }

      // Ensure bot has permission to view the channel
      if (!targetChannel.permissionsFor(interaction.client.user).has(['ViewChannel', 'ReadMessageHistory'])) {
        logger.warn("Bot lacks permissions for the channel:", { 
          channelName: targetChannel.name, 
          channelId: targetChannel.id 
        });
        return interaction.editReply('I do not have permission to read messages in that channel.');
      }

      logger.debug("Searching specified channel for messages:", { 
        channelName: targetChannel.name, 
        channelId: targetChannel.id 
      });

      // Fetch recent messages in the specified channel
      const messages = await targetChannel.messages.fetch({ limit: 100 });
      
      // Filter for messages by the target user
      const userMessages = messages.filter(msg => msg.author.id === targetUser.id);
      
      logger.debug("Messages found in specified channel:", { 
        channelName: targetChannel.name, 
        channelId: targetChannel.id,
        totalMessages: messages.size,
        userMessages: userMessages.size
      });

      // Prepare messages for output
      let allMessages = [];
      userMessages.forEach(msg => {
        allMessages.push({
          content: msg.content || '[No text content]',
          attachments: msg.attachments.size > 0,
          embeds: msg.embeds.length > 0,
          timestamp: msg.createdTimestamp,
          channelName: targetChannel.name,
          messageUrl: msg.url
        });
      });

      // Sort messages by timestamp (newest first)
      allMessages.sort((a, b) => b.timestamp - a.timestamp);
      
      logger.debug("Messages collected and sorted:", { 
        totalMessagesFound: allMessages.length,
        targetUser: targetUser.tag
      });
      
      // Limit to the requested number of messages
      const originalCount = allMessages.length;
      allMessages = allMessages.slice(0, messageLimit);
      
      logger.debug(`Messages limited to ${messageLimit}:`, { 
        originalCount: originalCount,
        limitedCount: allMessages.length,
        wasLimited: originalCount > messageLimit
      });
      
      if (allMessages.length === 0) {
        logger.info("No messages found for user:", { targetUser: targetUser.tag });
        return interaction.editReply(`No recent messages found from ${targetUser.username} in ${targetChannel.name}.`);
      }
      
      // Create embeds for the messages (max 10 messages per embed due to field limits)
      const embeds = [];
      const messagesPerEmbed = 10;

      for (let i = 0; i < allMessages.length; i += messagesPerEmbed) {
        const embed = new EmbedBuilder()
          .setColor(0xcd41ff) // Set the embed color to #cd41ffe
          .setAuthor({
            name: `Last messages from ${targetUser.username}`,
            iconURL: targetUser.displayAvatarURL()
          })
          .setFooter({
            text: `Page ${Math.floor(i / messagesPerEmbed) + 1}/${Math.ceil(allMessages.length / messagesPerEmbed)}`
          });
        
        const messagesChunk = allMessages.slice(i, i + messagesPerEmbed);
        
        messagesChunk.forEach((msg, index) => {
          const messageNumber = i + index + 1;
          const timestamp = Math.floor(msg.timestamp / 1000); // Convert to seconds for Discord
          let content = msg.content;
          
          // Truncate long messages
          if (content.length > 200) {
            content = content.substring(0, 200) + '...';
          }
          
          // Add indicators for attachments/embeds
          let extras = [];
          if (msg.attachments) extras.push('📎');
          if (msg.embeds) extras.push('🖼️');
          
          const extraText = extras.length > 0 ? ` ${extras.join(' ')}` : '';
          
          // Format the message with channel, content, and dynamic timestamp
          embed.addFields({
            name: `${messageNumber}. ${msg.channelName} ${extraText}`,
            value: `📜 **Message:** ${content || '[No text content]'}\n⏰ **Posted:** <t:${timestamp}:R>\n[Jump to Message](${msg.messageUrl})`,
            inline: false // Make sure the fields are stacked vertically
          });
        });
        
        embeds.push(embed);
      }
      
      logger.debug("Embeds created:", { 
        embedCount: embeds.length, 
        messagesPerEmbed: messagesPerEmbed
      });
      
      // Create pagination buttons
      const createButtons = (currentPage, totalPages) => {
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
      };
      
      // Send the first embed with buttons
      let currentPage = 0;
      const totalPages = embeds.length;
      
      const message = await interaction.editReply({ 
        content: `Found ${allMessages.length} messages from ${targetUser.username} in ${targetChannel.name}.`,
        embeds: [embeds[currentPage]],
        components: totalPages > 1 ? [createButtons(currentPage, totalPages)] : []
      });
      
      logger.info("Initial response sent:", { 
        messageCount: allMessages.length,
        pageCount: totalPages,
        targetUser: targetUser.tag
      });
      
      // Only create collector if there are multiple pages
      if (totalPages > 1) {
        // Create a collector for button interactions
        const collector = message.createMessageComponentCollector({ 
          componentType: ComponentType.Button,
          time: 300000 // 5 minutes
        });
        
        logger.debug("Button collector created:", { 
          timeout: "5 minutes",
          pages: totalPages
        });
        
        collector.on('collect', async (i) => {
          // Verify that the button interaction is from the user who ran the command
          if (i.user.id !== interaction.user.id) {
            logger.warn("Unauthorized button interaction:", { 
              attemptedUser: i.user.tag,
              attemptedUserId: i.user.id,
              commandUser: interaction.user.tag,
              commandUserId: interaction.user.id
            });
            return i.reply({ content: 'You cannot use these buttons.', ephemeral: true });
          }
          
          const oldPage = currentPage + 1;
          
          // Handle button interactions
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
          
          logger.debug("Button interaction:", { 
            button: i.customId,
            user: i.user.tag,
            oldPage: oldPage,
            newPage: currentPage + 1,
            totalPages: totalPages
          });
          
          // Update the message with the new embed and buttons
          await i.update({ 
            embeds: [embeds[currentPage]], 
            components: [createButtons(currentPage, totalPages)]
          });
        });
        
        collector.on('end', () => {
          logger.debug("Button collector ended:", { 
            finalPage: currentPage + 1,
            totalPages: totalPages
          });
          
          // Remove buttons when collector expires
          interaction.editReply({ 
            embeds: [embeds[currentPage]], 
            components: [] 
          }).catch((error) => {
            logger.error("Failed to remove buttons after collector ended:", { error: error.message });
          });
        });
      }
      
      logger.info("Command executed successfully:", { 
        user: interaction.user.tag,
        targetUser: targetUser.tag,
        messagesFound: allMessages.length
      });
      
    } catch (error) {
      logger.error("Error executing usermessages command:", { 
        error: error.message,
        stack: error.stack,
        user: interaction.user?.tag,
        guild: interaction.guild?.name
      });
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('There was an error fetching the messages. Please try again later.');
      } else {
        await interaction.reply({ content: 'There was an error fetching the messages. Please try again later.', ephemeral: true });
      }
    }
  }
};
