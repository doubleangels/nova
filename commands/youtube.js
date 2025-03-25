const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

/**
 * Module for the /youtube command.
 * Searches YouTube for videos and returns 5 results with interactive selection.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Search YouTube for videos and return 5 interactive results.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What videos do you want to search for?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('sort')
        .setDescription('How to sort results')
        .addChoices(
          { name: 'Relevance', value: 'relevance' },
          { name: 'View Count', value: 'viewCount' },
          { name: 'Upload Date', value: 'date' },
          { name: 'Rating', value: 'rating' }
        )
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Video length')
        .addChoices(
          { name: 'Any', value: 'any' },
          { name: 'Short (<4 min)', value: 'short' },
          { name: 'Medium (4-20 min)', value: 'medium' },
          { name: 'Long (>20 min)', value: 'long' }
        )
    ),
    
  /**
   * Executes the /youtube command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the API calls.
      await interaction.deferReply();
      logger.debug("/youtube command received:", { user: interaction.user.tag });
      
      // Retrieve and format the user's search query and options.
      const query = interaction.options.getString('query');
      const sortMethod = interaction.options.getString('sort') || 'relevance';
      const duration = interaction.options.getString('duration') || 'any';
      
      logger.debug("User input:", { query, sortMethod, duration });
      
      const formattedQuery = query.trim();
      logger.debug("Formatted query:", { formattedQuery });

      // Construct the YouTube API URL with the enhanced parameters.
      const searchUrl = "https://www.googleapis.com/youtube/v3/search";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        part: "snippet",
        q: formattedQuery,
        type: "video",
        maxResults: "5", // Always get 5 results
        order: sortMethod // Use user's sort preference
      });
      
      // Add duration parameter only if it's not 'any'
      if (duration !== 'any') {
        params.append('videoDuration', duration);
      }
      
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making YouTube API request:", { requestUrl });
      
      // Make the API request using axios.
      const response = await axios.get(requestUrl);
      logger.debug("YouTube API response:", { status: response.status });
      
      if (response.status === 200) {
        // Parse the JSON response.
        const data = response.data;
        logger.debug("Received YouTube data:", { resultCount: data.items?.length });
        
        // Check if the API returned any items.
        if (data.items && data.items.length > 0) {
          // Get the video IDs from the search results
          const videoIds = data.items.map(item => item.id.videoId).join(',');
          
          // Get detailed video information
          const videoDetailsUrl = "https://www.googleapis.com/youtube/v3/videos";
          const detailsParams = new URLSearchParams({
            key: config.googleApiKey,
            id: videoIds,
            part: "snippet,statistics,contentDetails"
          });
          
          const detailsResponse = await axios.get(`${videoDetailsUrl}?${detailsParams.toString()}`);
          const videoDetails = detailsResponse.data.items;
          logger.debug("Retrieved video details:", { count: videoDetails.length });
          
          // Sort by a custom relevance algorithm (views + likes)
          videoDetails.sort((a, b) => {
            const aViews = parseInt(a.statistics.viewCount) || 0;
            const bViews = parseInt(b.statistics.viewCount) || 0;
            const aLikes = parseInt(a.statistics.likeCount) || 0;
            const bLikes = parseInt(b.statistics.likeCount) || 0;
            
            // Simple algorithm: views × (likes ÷ 1000)
            return (bViews * (bLikes/1000)) - (aViews * (aLikes/1000));
          });
          
          // Function to format video duration from ISO 8601 format
          const formatDuration = (isoDuration) => {
            const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (!match) return "Unknown";
            
            const hours = match[1] ? match[1] + ':' : '';
            const minutes = match[2] ? (hours && match[2].padStart(2, '0') || match[2]) + ':' : '0:';
            const seconds = match[3] ? match[3].padStart(2, '0') : '00';
            
            return `${hours}${minutes}${seconds}`;
          };
          
          // Function to create an embed for a video
          const createVideoEmbed = (video) => {
            const snippet = video.snippet;
            const statistics = video.statistics;
            const title = snippet.title || "No Title";
            const description = snippet.description || "No Description";
            const channelTitle = snippet.channelTitle || "Unknown Channel";
            const publishedAt = snippet.publishedAt;
            const viewCount = parseInt(statistics.viewCount) || 0;
            const likeCount = parseInt(statistics.likeCount) || 0;
            const duration = formatDuration(video.contentDetails.duration);
            const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
            const thumbnail = snippet.thumbnails.high?.url || snippet.thumbnails.default?.url;
            
            return new EmbedBuilder()
              .setTitle(`🎬 ${title}`)
              .setDescription(`${description.substring(0, 150)}${description.length > 150 ? '...' : ''}`)
              .setURL(videoUrl)
              .setColor(0xFF0000)
              .addFields(
                { name: "👁️ Views", value: viewCount.toLocaleString(), inline: true },
                { name: "👍 Likes", value: likeCount.toLocaleString(), inline: true },
                { name: "⏱️ Duration", value: duration, inline: true },
                { name: "📅 Published", value: new Date(publishedAt).toLocaleDateString(), inline: true },
                { name: "👤 Channel", value: channelTitle, inline: true }
              )
              .setImage(thumbnail) // Use setImage for larger thumbnail
              .setFooter({ text: "Powered by YouTube Data API" });
          };
          
          // Always use interactive mode for all 5 videos
          const results = videoDetails.slice(0, 5);
          
          // Create buttons for all 5 results
          const resultButtons = results.map((video, index) => {
            const title = video.snippet.title || "Result";
            // Truncate long titles for button labels
            const shortTitle = title.length > 15 ? title.substring(0, 12) + '...' : title;
            
            return new ButtonBuilder()
              .setCustomId(`youtube_select_${index}_${interaction.user.id}`)
              .setLabel(`${index + 1}. ${shortTitle}`)
              .setStyle(ButtonStyle.Primary);
          });
          
          // Split buttons into rows of 3 and 2 for better UI
          const row1 = new ActionRowBuilder().addComponents(resultButtons.slice(0, 3));
          const row2 = new ActionRowBuilder().addComponents(resultButtons.slice(3, 5));
          
          // Send interactive message with first result
          await interaction.editReply({ 
            content: "📺 **YouTube Search Results** - Click a button to view details:",
            components: [row1, row2],
            embeds: [createVideoEmbed(results[0])] // Show first result initially
          });
          
          // Create a button collector
          const filter = i => 
            i.customId.startsWith('youtube_select_') && 
            i.customId.endsWith(interaction.user.id) &&
            i.user.id === interaction.user.id;
          
          const collector = interaction.channel.createMessageComponentCollector({ 
            filter, 
            time: 120000 // 2 minute timeout
          });
          
          collector.on('collect', async i => {
            const selectedIndex = parseInt(i.customId.split('_')[2]);
            
            // Update buttons to show which one is selected
            const updatedButtons = results.map((video, index) => {
              const title = video.snippet.title || "Result";
              const shortTitle = title.length > 15 ? title.substring(0, 12) + '...' : title;
              
              return new ButtonBuilder()
                .setCustomId(`youtube_select_${index}_${interaction.user.id}`)
                .setLabel(`${index + 1}. ${shortTitle}`)
                .setStyle(index === selectedIndex ? ButtonStyle.Success : ButtonStyle.Primary);
            });
            
            const updatedRow1 = new ActionRowBuilder().addComponents(updatedButtons.slice(0, 3));
            const updatedRow2 = new ActionRowBuilder().addComponents(updatedButtons.slice(3, 5));
            
            await i.update({ 
              embeds: [createVideoEmbed(results[selectedIndex])],
              components: [updatedRow1, updatedRow2]
            });
          });
          
          collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
              // If timed out, disable the buttons
              const disabledButtons = results.map((video, index) => {
                const title = video.snippet.title || "Result";
                const shortTitle = title.length > 15 ? title.substring(0, 12) + '...' : title;
                
                return new ButtonBuilder()
                  .setCustomId(`youtube_select_${index}_disabled`)
                  .setLabel(`${index + 1}. ${shortTitle}`)
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true);
              });
              
              const disabledRow1 = new ActionRowBuilder().addComponents(disabledButtons.slice(0, 3));
              const disabledRow2 = new ActionRowBuilder().addComponents(disabledButtons.slice(3, 5));
              
              await interaction.editReply({
                content: "📺 **YouTube Search Results** - Selection timed out",
                components: [disabledRow1, disabledRow2]
              }).catch(err => logger.error("Failed to update timed out message:", err));
            }
          });
          
          logger.debug("YouTube interactive results sent successfully:", { user: interaction.user.tag });
        } else {
          // No video results found.
          logger.warn("No video results found:", { query: formattedQuery });
          await interaction.editReply(`❌ No video results found for **${formattedQuery}**. Try another search!`);
        }
      } else {
        // Handle API error responses.
        logger.warn("YouTube API error:", { status: response.status });
        await interaction.editReply(`⚠️ Error: YouTube API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log and report any unexpected errors.
      logger.error("Error in /youtube command:", { error: error.message, stack: error.stack });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
