const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../logger')(require('path').basename(__filename));
const Sentry = require('@sentry/node');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Message History')
    .setType(ApplicationCommandType.User),
  
  async execute(interaction) {
    try {
      // Defer the reply as ephemeral since this might take some time
      await interaction.deferReply({ ephemeral: true });
      
      // Get the targeted user
      const targetUser = interaction.targetUser;
      
      logger.debug('Message History command triggered', {
        invoker: interaction.user.tag,
        targetUser: targetUser?.tag,
        channelId: interaction.channelId,
        guildId: interaction.guildId
      });
      
      // Check if targetUser exists
      if (!targetUser) {
        logger.error('Target user is undefined');
        return await interaction.editReply({
          content: 'Error: Could not retrieve the target user.',
        });
      }
      
      // Get the channel where the command was used
      const channel = interaction.channel;
      
      // Fetch messages from this channel
      const messagesCollection = [];
      let lastId = null;
      let messageCount = 0;
      const MAX_MESSAGES = 50;
      const FETCH_LIMIT = 100; // Discord API allows fetching up to 100 messages at once
      
      // We need to paginate through messages to find enough from our target user
      while (messageCount < MAX_MESSAGES) {
        // Prepare fetch options
        const fetchOptions = { limit: FETCH_LIMIT };
        if (lastId) {
          fetchOptions.before = lastId;
        }
        
        // Fetch messages
        const messages = await channel.messages.fetch(fetchOptions);
        
        if (messages.size === 0) break; // No more messages
        
        // Update lastId for pagination
        lastId = messages.last().id;
        
        // Filter messages by the target user
        const userMessages = messages.filter(msg => msg.author.id === targetUser.id);
        
        // Add to our collection
        userMessages.forEach(msg => {
          if (messageCount < MAX_MESSAGES) {
            messagesCollection.push(msg);
            messageCount++;
          }
        });
        
        // If we've checked all messages in the channel or found enough, break
        if (messages.size < FETCH_LIMIT || messageCount >= MAX_MESSAGES) break;
      }
      
      // Check if we found any messages
      if (messagesCollection.length === 0) {
        return await interaction.editReply({
          content: `No recent messages from ${targetUser.tag} found in this channel.`,
        });
      }
      
      // Sort messages by timestamp (newest first)
      messagesCollection.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      
      // Create embeds for the messages (paginated if needed)
      const embeds = createMessageEmbeds(messagesCollection, targetUser, interaction.guild);
      
      // Create navigation buttons if there are multiple pages
      let components = [];
      if (embeds.length > 1) {
        components = [createNavigationRow()];
      }
      
      // Send the first page
      const response = await interaction.editReply({
        embeds: [embeds[0]],
        components: components,
      });
      
      // Only set up the collector if we have multiple pages
      if (embeds.length > 1) {
        // Set up a collector for button interactions
        const collector = response.createMessageComponentCollector({ 
          time: 300000 // 5 minutes
        });
        
        let currentPage = 0;
        
        collector.on('collect', async i => {
          // Verify that the interaction is from the user who used the command
          if (i.user.id !== interaction.user.id) {
            return await i.reply({ 
              content: 'This navigation is not for you.', 
              ephemeral: true 
            });
          }
          
          // Update current page based on which button was clicked
          if (i.customId === 'prev') {
            currentPage = currentPage > 0 ? currentPage - 1 : embeds.length - 1;
          } else if (i.customId === 'next') {
            currentPage = currentPage < embeds.length - 1 ? currentPage + 1 : 0;
          }
          
          // Update the message with the new page
          await i.update({
            embeds: [embeds[currentPage]],
            components: components,
          });
        });
        
        collector.on('end', async () => {
          // Remove buttons when collector expires
          try {
            await interaction.editReply({
              embeds: [embeds[currentPage]],
              components: [],
            });
          } catch (error) {
            logger.error('Error removing buttons after collector end:', { error });
          }
        });
      }
      
      logger.debug('Message History command executed successfully', {
        messagesFound: messagesCollection.length,
        pages: embeds.length
      });
      
    } catch (error) {
      Sentry.captureException(error);
      logger.error('Error executing Message History command:', { error });
      
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: 'An error occurred while retrieving message history.',
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content: 'An error occurred while retrieving message history.',
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error('Error sending error response:', { error: replyError });
      }
    }
  }
};

/**
 * Creates embeds for displaying messages
 * @param {Array} messages - Array of message objects
 * @param {User} user - The target user
 * @param {Guild} guild - The guild where the command was used
 * @returns {Array} - Array of embeds
 */
function createMessageEmbeds(messages, user, guild) {
  const embeds = [];
  const MESSAGES_PER_PAGE = 10;
  
  // Calculate number of pages needed
  const pageCount = Math.ceil(messages.length / MESSAGES_PER_PAGE);
  
  for (let i = 0; i < pageCount; i++) {
    // Get messages for this page
    const pageMessages = messages.slice(i * MESSAGES_PER_PAGE, (i + 1) * MESSAGES_PER_PAGE);
    
    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setAuthor({
        name: `Message History for ${user.tag}`,
        iconURL: user.displayAvatarURL()
      })
      .setThumbnail(user.displayAvatarURL())
      .setFooter({
        text: `Page ${i + 1}/${pageCount} • ${messages.length} messages total`,
      })
      .setTimestamp();
    
    // Add messages to embed
    pageMessages.forEach((msg, index) => {
      // Format the message content
      let content = msg.content || '[No text content]';
      
      // If message has attachments, add info
      if (msg.attachments.size > 0) {
        content += `\n[${msg.attachments.size} attachment(s)]`;
      }
      
      // If message has embeds, add info
      if (msg.embeds.length > 0) {
        content += `\n[${msg.embeds.length} embed(s)]`;
      }
      
      // Truncate if too long
      if (content.length > 1024) {
        content = content.substring(0, 1021) + '...';
      }
      
      // Format timestamp
      const timestamp = `<t:${Math.floor(msg.createdTimestamp / 1000)}:R>`;
      
      // Add field to embed
      embed.addFields({
        name: `#${(i * MESSAGES_PER_PAGE) + index + 1} • ${timestamp} in #${msg.channel.name}`,
        value: content
      });
    });
    
    embeds.push(embed);
  }
  
  return embeds;
}

/**
 * Creates navigation buttons for paginated results
 * @returns {ActionRowBuilder} - Row of buttons
 */
function createNavigationRow() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⬅️'),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('➡️')
    );
}
