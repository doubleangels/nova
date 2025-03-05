const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const logger = require('../logger')('userMessages.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('usermessages')
    .setDescription('Lists the last 50 messages from a specific user.')
    .addUserOption(option => 
      option
        .setName('user')
        .setDescription("What user's messages do you want to see?")
        .setRequired(true)),

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
      
      // Get the target user from options
      const targetUser = interaction.options.getUser('user');
      const targetMember = interaction.options.getMember('user');
      
      logger.debug("Target user retrieved:", { 
        targetUser: targetUser?.tag,
        targetUserId: targetUser?.id,
        hasTargetMember: !!targetMember
      });
      
      if (!targetUser) {
        logger.warn("Target user not found:", { requestedBy: interaction.user.tag });
        return interaction.editReply('User not found.');
      }
      
      // Check if user has permission to use this command
      if (!interaction.member.permissions.has('MODERATE_MEMBERS')) {
        logger.warn("Permission denied for user:", { 
          user: interaction.user.tag, 
          userId: interaction.user.id,
          missingPermission: 'MODERATE_MEMBERS'
        });
        return interaction.editReply('You do not have permission to use this command.');
      }
      
      logger.info(`Fetching messages for user:`, { 
        targetUser: targetUser.tag, 
        targetUserId: targetUser.id,
        requestedBy: interaction.user.tag
      });
      
      // Get all accessible channels in the guild
      const channels = interaction.guild.channels.cache.filter(
        channel => channel.type === 0 && // 0 is TextChannel
                  channel.permissionsFor(interaction.client.user).has(['ViewChannel', 'ReadMessageHistory'])
      );
      
      logger.debug("Accessible channels found:", { count: channels.size });
      
      let allMessages = [];
      
      // For each channel, fetch messages from this user
      await interaction.editReply(`Searching for messages from ${targetUser.username}...`);
      
      for (const [channelId, channel] of channels) {
        try {
          logger.debug("Searching channel:", { 
            channelName: channel.name, 
            channelId: channelId 
          });
          
          // Fetch recent messages in the channel
          const messages = await channel.messages.fetch({ limit: 100 });
          
          // Filter for messages by the target user
          const userMessages = messages.filter(msg => msg.author.id === targetUser.id);
          
          logger.debug("Messages found in channel:", { 
            channelName: channel.name, 
            channelId: channelId,
            totalMessages: messages.size,
            userMessages: userMessages.size
          });
          
          // Add channel information to the messages
          userMessages.forEach(msg => {
            allMessages.push({
              content: msg.content || '[No text content]',
              attachments: msg.attachments.size > 0,
              embeds: msg.embeds.length > 0,
              timestamp: msg.createdTimestamp,
              channelName: channel.name,
              messageUrl: msg.url
            });
          });
          
        } catch (error) {
          // Continue to next channel if there's an error with this one
          logger.warn("Error fetching messages from channel:", { 
            channelName: channel.name, 
            channelId: channelId,
            error: error.message
          });
        }
      }
      
      // Sort messages by timestamp (newest first)
      allMessages.sort((a, b) => b.timestamp - a.timestamp);
      
      logger.debug("Messages collected and sorted:", { 
        totalMessagesFound: allMessages.length,
        targetUser: targetUser.tag
      });
      
      // Limit to 50 messages
      const originalCount = allMessages.length;
      allMessages = allMessages.slice(0, 50);
      
      logger.debug("Messages limited to 50:", { 
        originalCount: originalCount,
        limitedCount: allMessages.length,
        wasLimited: originalCount > 50
      });
      
      if (allMessages.length === 0) {
        logger.info("No messages found for user:", { targetUser: targetUser.tag });
        return interaction.editReply(`No recent messages found from ${targetUser.username}.`);
      }
      
      // Create embeds for the messages (max 10 messages per embed due to field limits)
      const embeds = [];
      const messagesPerEmbed = 10;
      
      for (let i = 0; i < allMessages.length; i += messagesPerEmbed) {
        const embed = new EmbedBuilder()
          .setColor(0xcd41ff) // Set the embed color to #cd41ff
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
          const date = new Date(msg.timestamp).toLocaleString();
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
          
          embed.addFields({
            name: `${messageNumber}. ${date} in #${msg.channelName}${extraText}`,
            value: content || '[No text content]' + `\n[Jump to Message](${msg.messageUrl})`
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
        content: `Found ${allMessages.length} messages from ${targetUser.username}.`,
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
