const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../logger')('messageCount.js'); // Adjust path as needed

module.exports = {
  data: new SlashCommandBuilder()
    .setName('messagecount')
    .setDescription('Count how many messages a user has sent in this server')
    .addUserOption(option => 
      option
        .setName('user')
        .setDescription('What user do you want to count messages for?')
        .setRequired(true))
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('How many days do you want to look back? (1-365, Default: 365)')
        .setMinValue(1)
        .setMaxValue(365)),

  async execute(interaction) {
    try {
      // Defer reply as ephemeral since this might take some time
      await interaction.deferReply({ ephemeral: true });
      
      // Get the target user from options
      const targetUser = interaction.options.getUser('user');
      const targetMember = interaction.options.getMember('user');
      
      if (!targetUser) {
        return interaction.editReply('User not found.');
      }
      
      // Get the number of days to look back (default: 365, max: 365)
      const days = interaction.options.getInteger('days') || 365;
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      
      logger.info(`Counting messages for user: ${targetUser.tag} (${targetUser.id}) over the past ${days} days`);
      
      // Get all accessible channels in the guild
      const channels = interaction.guild.channels.cache.filter(
        channel => channel.type === 0 && // 0 is TextChannel
                  channel.permissionsFor(interaction.client.user).has(['ViewChannel', 'ReadMessageHistory'])
      );
      
      // Initialize counters
      const channelCounts = {};
      let totalMessages = 0;
      let processedChannels = 0;
      const totalChannels = channels.size;
      
      // Update message every few channels to show progress
      const progressInterval = Math.max(1, Math.floor(totalChannels / 5));
      
      // For each channel, count messages from this user
      await interaction.editReply(`Counting messages from ${targetUser.username} over the past ${days} days... This may take a while.`);
      
      for (const [channelId, channel] of channels) {
        try {
          let messageCount = 0;
          let lastId = null;
          let done = false;
          let batchCount = 0;
          const maxBatches = 50; // Limit to prevent excessive API calls for very active channels
          
          // We need to paginate through messages since we can only fetch 100 at a time
          while (!done && batchCount < maxBatches) {
            batchCount++;
            
            // Fetch options
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            
            const messages = await channel.messages.fetch(options);
            
            if (messages.size === 0) {
              done = true;
              continue;
            }
            
            // Get the last message ID for pagination
            lastId = messages.last().id;
            
            // Count messages from the target user that are newer than the cutoff time
            const userMessagesInBatch = messages.filter(
              msg => msg.author.id === targetUser.id && msg.createdTimestamp > cutoffTime
            ).size;
            
            messageCount += userMessagesInBatch;
            
            // If we've gone past our cutoff date, or if we got fewer than 100 messages, we're done with this channel
            const oldestMessageTime = messages.last().createdTimestamp;
            if (oldestMessageTime < cutoffTime || messages.size < 100) {
              done = true;
            }
          }
          
          // Store the count for this channel
          if (messageCount > 0) {
            channelCounts[channel.name] = messageCount;
            totalMessages += messageCount;
          }
          
          // Update progress counter
          processedChannels++;
          
          // Update progress message occasionally
          if (processedChannels % progressInterval === 0 || processedChannels === totalChannels) {
            await interaction.editReply(
              `Counting messages from ${targetUser.username}... Progress: ${processedChannels}/${totalChannels} channels processed.`
            );
          }
          
        } catch (error) {
          // Continue to next channel if there's an error with this one
          logger.warn(`Error counting messages in channel ${channel.name}:`, { error });
          processedChannels++;
        }
      }
      
      // Sort channels by message count (highest first)
      const sortedChannels = Object.entries(channelCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Get top 10 channels
      
      // Create embed with custom color #cd41ff
      const embed = new EmbedBuilder()
        .setColor(0xcd41ff) // Set the custom color
        .setAuthor({
          name: `Message Count for ${targetUser.username}`,
          iconURL: targetUser.displayAvatarURL()
        })
        .setDescription(`Found **${totalMessages}** messages in the past **${days} days**.`)
        .setFooter({
          text: `Searched ${processedChannels} channels • ${new Date().toLocaleDateString()}`
        });
      
      // Add top channels field if we have any
      if (sortedChannels.length > 0) {
        const topChannelsText = sortedChannels
          .map(([channelName, count], index) => `${index + 1}. #${channelName}: **${count}** messages`)
          .join('\n');
        
        embed.addFields({
          name: 'Most Active Channels',
          value: topChannelsText
        });
      }
      
      // Add average messages per day
      const avgPerDay = (totalMessages / days).toFixed(1);
      embed.addFields({
        name: 'Average Per Day',
        value: `${avgPerDay} messages`
      });
      
      // Add time period in days
      embed.addFields({
        name: 'Time Period',
        value: `Last ${days} days`
      });
      
      await interaction.editReply({ 
        content: `Message count for ${targetUser.username} completed.`,
        embeds: [embed]
      });
      
      logger.info(`Successfully counted ${totalMessages} messages for user ${targetUser.tag}`);
      
    } catch (error) {
      logger.error('Error executing messagecount command:', { error });
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('There was an error counting the messages. Please try again later.');
      } else {
        await interaction.reply({ content: 'There was an error counting the messages. Please try again later.', ephemeral: true });
      }
    }
  }
};
