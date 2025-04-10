/**
 * Module for the /youtube command.
 * 
 * Searches YouTube for videos and returns 5 results with arrow navigation.
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants.
const YOUTUBE_CONFIG = {
  COMMAND: {
    NAME: 'youtube',
    DESCRIPTION: 'Search YouTube for videos.'
  },
  OPTIONS: {
    QUERY: {
      NAME: 'query',
      DESCRIPTION: 'What videos do you want to search for?'
    },
    SORT: {
      NAME: 'sort',
      DESCRIPTION: 'How do you want to sort the results?',
      CHOICES: [
        { name: 'Relevance', value: 'relevance' },
        { name: 'View Count', value: 'viewCount' },
        { name: 'Upload Date', value: 'date' },
        { name: 'Rating', value: 'rating' }
      ],
      DEFAULT: 'relevance'
    },
    DURATION: {
      NAME: 'duration',
      DESCRIPTION: 'How long should the videos be?',
      CHOICES: [
        { name: 'Any', value: 'any' },
        { name: 'Short (<4 min)', value: 'short' },
        { name: 'Medium (4-20 min)', value: 'medium' },
        { name: 'Long (>20 min)', value: 'long' }
      ],
      DEFAULT: 'any'
    }
  },
  API: {
    SEARCH_URL: 'https://www.googleapis.com/youtube/v3/search',
    VIDEOS_URL: 'https://www.googleapis.com/youtube/v3/videos',
    SEARCH_PARAMS: {
      PART: 'snippet',
      TYPE: 'video',
      MAX_RESULTS: '5'
    },
    VIDEO_PARAMS: {
      PART: 'snippet,statistics,contentDetails'
    },
    TIMEOUT_MS: 5000
  },
  EMBED: {
    COLOR: 0xFF0000, // YouTube red
    TITLE_PREFIX: '🎬 %s',
    DESCRIPTION_MAX_LENGTH: 150,
    FIELDS: {
      VIEWS: '👁️ Views',
      LIKES: '👍 Likes',
      DURATION: '⏱️ Duration',
      PUBLISHED: '📅 Published',
      CHANNEL: '👤 Channel'
    },
    FOOTER: 'Result %s of %s • Powered by YouTube Data API'
  },
  BUTTONS: {
    PREV: {
      ID_PREFIX: 'yt_prev_',
      LABEL: '◀',
      STYLE: ButtonStyle.Danger
    },
    NEXT: {
      ID_PREFIX: 'yt_next_',
      LABEL: '▶',
      STYLE: ButtonStyle.Danger
    },
    DISABLED: {
      PREV_ID: 'yt_prev_disabled',
      NEXT_ID: 'yt_next_disabled'
    }
  },
  RESPONSES: {
    NO_RESULTS: '⚠️ No video results found for **%s**. Try another search!',
    API_ERROR: '⚠️ Error: YouTube API returned status code %s.',
    GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.',
    API_KEY_MISSING: '⚠️ YouTube API key is not configured. Please contact the bot administrator.'
  },
  COLLECTOR: {
    TIMEOUT_MS: 120000 // 2 minutes
  },
  RELEVANCE_ALGORITHM: {
    LIKES_WEIGHT: 0.001 // Factor to multiply likes by in relevance calculation
  }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName(YOUTUBE_CONFIG.COMMAND.NAME)
    .setDescription(YOUTUBE_CONFIG.COMMAND.DESCRIPTION)
    .addStringOption(option =>
      option
        .setName(YOUTUBE_CONFIG.OPTIONS.QUERY.NAME)
        .setDescription(YOUTUBE_CONFIG.OPTIONS.QUERY.DESCRIPTION)
        .setRequired(true)
    )
    .addStringOption(option => {
      const sortOption = option
        .setName(YOUTUBE_CONFIG.OPTIONS.SORT.NAME)
        .setDescription(YOUTUBE_CONFIG.OPTIONS.SORT.DESCRIPTION);
      
      YOUTUBE_CONFIG.OPTIONS.SORT.CHOICES.forEach(choice => {
        sortOption.addChoices(choice);
      });
      
      return sortOption;
    })
    .addStringOption(option => {
      const durationOption = option
        .setName(YOUTUBE_CONFIG.OPTIONS.DURATION.NAME)
        .setDescription(YOUTUBE_CONFIG.OPTIONS.DURATION.DESCRIPTION);
      
      YOUTUBE_CONFIG.OPTIONS.DURATION.CHOICES.forEach(choice => {
        durationOption.addChoices(choice);
      });
      
      return durationOption;
    }),
    
  /**
   * Executes the /youtube command.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the API calls.
      await interaction.deferReply();
      
      logger.debug("YouTube command received.", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag 
      });
      
      // Check if API key is configured.
      if (!config.googleApiKey) {
        logger.error("YouTube API key is missing in configuration.");
        await interaction.editReply({ 
          content: YOUTUBE_CONFIG.RESPONSES.API_KEY_MISSING, 
          ephemeral: true 
        });
        return;
      }
      
      // Retrieve and format the user's search query and options.
      const query = interaction.options.getString(YOUTUBE_CONFIG.OPTIONS.QUERY.NAME);
      const sortMethod = interaction.options.getString(YOUTUBE_CONFIG.OPTIONS.SORT.NAME) || 
                         YOUTUBE_CONFIG.OPTIONS.SORT.DEFAULT;
      const duration = interaction.options.getString(YOUTUBE_CONFIG.OPTIONS.DURATION.NAME) || 
                       YOUTUBE_CONFIG.OPTIONS.DURATION.DEFAULT;
      
      logger.debug("Processing search request.", { 
        query, 
        sortMethod, 
        duration,
        userId: interaction.user.id 
      });
      
      const formattedQuery = query.trim();
      
      // Search for videos using the YouTube API.
      const videoResults = await this.searchYouTubeVideos(formattedQuery, sortMethod, duration);
      
      if (!videoResults || videoResults.length === 0) {
        logger.warn("No video results found.", { query: formattedQuery });
        await interaction.editReply({ 
          content: YOUTUBE_CONFIG.RESPONSES.NO_RESULTS.replace('%s', formattedQuery), 
          ephemeral: true 
        });
        return;
      }
      
      // Create interactive navigation for the search results.
      await this.createInteractiveNavigation(interaction, videoResults);
      
      logger.info("YouTube search results sent successfully.", { 
        query: formattedQuery, 
        resultCount: videoResults.length,
        userId: interaction.user.id 
      });
      
    } catch (error) {
      // Log and report any unexpected errors.
      logger.error("Error in YouTube command.", { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user?.id 
      });
      
      await interaction.editReply({ 
        content: YOUTUBE_CONFIG.RESPONSES.GENERAL_ERROR, 
        ephemeral: true
      });
    }
  },

  /**
   * Searches for YouTube videos based on the given parameters.
   * 
   * @param {string} query - The search query.
   * @param {string} sortMethod - How to sort the results.
   * @param {string} duration - Duration filter for videos.
   * @returns {Promise<Array|null>} - Array of video objects or null on error.
   */
  async searchYouTubeVideos(query, sortMethod, duration) {
    try {
      // Construct the YouTube API URL with the search parameters.
      const params = new URLSearchParams({
        key: config.googleApiKey,
        part: YOUTUBE_CONFIG.API.SEARCH_PARAMS.PART,
        q: query,
        type: YOUTUBE_CONFIG.API.SEARCH_PARAMS.TYPE,
        maxResults: YOUTUBE_CONFIG.API.SEARCH_PARAMS.MAX_RESULTS,
        order: sortMethod
      });
      
      // Add duration parameter only if it's not 'any'.
      if (duration !== YOUTUBE_CONFIG.OPTIONS.DURATION.CHOICES[0].value) {
        params.append('videoDuration', duration);
      }
      
      const requestUrl = `${YOUTUBE_CONFIG.API.SEARCH_URL}?${params.toString()}`;
      logger.debug("Making YouTube API search request.", { requestUrl });
      
      // Make the API request with a timeout.
      const response = await axios.get(requestUrl, { 
        timeout: YOUTUBE_CONFIG.API.TIMEOUT_MS 
      });
      
      if (response.status !== 200) {
        logger.warn("YouTube API returned non-200 status.", { 
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }
      
      // Parse the JSON response.
      const data = response.data;
      
      // Check if the API returned any items.
      if (!data.items || data.items.length === 0) {
        return null;
      }
      
      logger.debug("YouTube search results received.", { 
        resultCount: data.items.length 
      });
      
      // Get the video IDs from the search results.
      const videoIds = data.items.map(item => item.id.videoId);
      
      // Get detailed video information.
      return await this.fetchVideoDetails(videoIds);
      
    } catch (error) {
      logger.error("Error searching YouTube.", { 
        error: error.message, 
        stack: error.stack 
      });
      return null;
    }
  },

  /**
   * Fetches detailed information about specific videos.
   * 
   * @param {Array<string>} videoIds - Array of video IDs.
   * @returns {Promise<Array|null>} - Array of video details or null on error.
   */
  async fetchVideoDetails(videoIds) {
    try {
      const detailsParams = new URLSearchParams({
        key: config.googleApiKey,
        id: videoIds.join(','),
        part: YOUTUBE_CONFIG.API.VIDEO_PARAMS.PART
      });
      
      const detailsRequestUrl = `${YOUTUBE_CONFIG.API.VIDEOS_URL}?${detailsParams.toString()}`;
      logger.debug("Making YouTube API video details request.", { detailsRequestUrl });
      
      const detailsResponse = await axios.get(detailsRequestUrl, { 
        timeout: YOUTUBE_CONFIG.API.TIMEOUT_MS 
      });
      
      if (detailsResponse.status !== 200 || !detailsResponse.data.items) {
        return null;
      }
      
      const videoDetails = detailsResponse.data.items;
      logger.debug("Video details received.", { count: videoDetails.length });
      
      // Sort videos by a custom relevance algorithm (views + likes).
      return this.sortVideosByRelevance(videoDetails);
      
    } catch (error) {
      logger.error("Error fetching video details.", { 
        error: error.message, 
        stack: error.stack 
      });
      return null;
    }
  },

  /**
   * Sorts videos by a custom relevance algorithm.
   * 
   * @param {Array} videos - Array of video details.
   * @returns {Array} - Sorted array of videos.
   */
  sortVideosByRelevance(videos) {
    return [...videos].sort((a, b) => {
      const aViews = parseInt(a.statistics.viewCount) || 0;
      const bViews = parseInt(b.statistics.viewCount) || 0;
      const aLikes = parseInt(a.statistics.likeCount) || 0;
      const bLikes = parseInt(b.statistics.likeCount) || 0;
      
      // Simple algorithm: views × (likes × factor)
      const aScore = aViews * (aLikes * YOUTUBE_CONFIG.RELEVANCE_ALGORITHM.LIKES_WEIGHT);
      const bScore = bViews * (bLikes * YOUTUBE_CONFIG.RELEVANCE_ALGORITHM.LIKES_WEIGHT);
      return bScore - aScore;
    });
  },

  /**
   * Creates an interactive navigation interface for the search results.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @param {Array} results - Array of video results.
   * @returns {Promise<void>}
   */
  async createInteractiveNavigation(interaction, results) {
    // Always use interactive mode for all videos (up to 5).
    const videosToDisplay = results.slice(0, 5);
    
    // Initial state - show the first video.
    let currentIndex = 0;
    
    await interaction.editReply({ 
      components: this.createArrowButtons(currentIndex, videosToDisplay.length),
      embeds: [this.createVideoEmbed(videosToDisplay[currentIndex], currentIndex, videosToDisplay.length)]
    });
    
    // Create a button collector.
    const filter = i => 
      (i.customId.startsWith(YOUTUBE_CONFIG.BUTTONS.PREV.ID_PREFIX) || 
       i.customId.startsWith(YOUTUBE_CONFIG.BUTTONS.NEXT.ID_PREFIX)) && 
      i.customId.includes(interaction.user.id) &&
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel.createMessageComponentCollector({ 
      filter, 
      time: YOUTUBE_CONFIG.COLLECTOR.TIMEOUT_MS
    });
    
    collector.on('collect', async i => {
      const buttonType = i.customId.split('_')[1];
      
      if (buttonType === 'prev') {
        // Previous button clicked.
        currentIndex = Math.max(0, currentIndex - 1);
        logger.debug("User navigated to previous video.", { 
          userId: i.user.id, 
          newIndex: currentIndex 
        });
      } else if (buttonType === 'next') {
        // Next button clicked.
        currentIndex = Math.min(videosToDisplay.length - 1, currentIndex + 1);
        logger.debug("User navigated to next video.", { 
          userId: i.user.id, 
          newIndex: currentIndex 
        });
      }
      
      await i.update({ 
        components: this.createArrowButtons(currentIndex, videosToDisplay.length),
        embeds: [this.createVideoEmbed(videosToDisplay[currentIndex], currentIndex, videosToDisplay.length)]
      });
    });
    
    collector.on('end', async (collected, reason) => {
      if (reason === 'time') {
        logger.debug("Navigation timeout reached.", { 
          userId: interaction.user.id, 
          buttonsPressed: collected.size 
        });
        
        // Disable buttons when timed out.
        const disabledButtons = this.createDisabledButtons();
        
        await interaction.editReply({
          components: [disabledButtons]
        }).catch(err => {
          logger.error("Failed to update timed out message.", { 
            error: err.message 
          });
        });
      }
    });
  },

  /**
   * Creates navigation buttons for the video carousel.
   * 
   * @param {number} currentIndex - Current video index.
   * @param {number} totalCount - Total number of videos.
   * @returns {Array} - Array of ActionRowBuilders with button components.
   */
  createArrowButtons(currentIndex, totalCount) {
    // Create arrow buttons for navigation in YouTube red color.
    const prevButton = new ButtonBuilder()
      .setCustomId(`${YOUTUBE_CONFIG.BUTTONS.PREV.ID_PREFIX}${currentIndex}`)
      .setLabel(YOUTUBE_CONFIG.BUTTONS.PREV.LABEL)
      .setStyle(YOUTUBE_CONFIG.BUTTONS.PREV.STYLE)
      .setDisabled(currentIndex === 0); // Disable when on first item.
      
    const nextButton = new ButtonBuilder()
      .setCustomId(`${YOUTUBE_CONFIG.BUTTONS.NEXT.ID_PREFIX}${currentIndex}`)
      .setLabel(YOUTUBE_CONFIG.BUTTONS.NEXT.LABEL)
      .setStyle(YOUTUBE_CONFIG.BUTTONS.NEXT.STYLE)
      .setDisabled(currentIndex === totalCount - 1); // Disable when on last item.
    
    const navRow = new ActionRowBuilder().addComponents(prevButton, nextButton);
    return [navRow];
  },

  /**
   * Creates disabled navigation buttons for when the interaction times out.
   * 
   * @returns {ActionRowBuilder} - ActionRowBuilder with disabled button components.
   */
  createDisabledButtons() {
    const disabledPrevButton = new ButtonBuilder()
      .setCustomId(YOUTUBE_CONFIG.BUTTONS.DISABLED.PREV_ID)
      .setLabel(YOUTUBE_CONFIG.BUTTONS.PREV.LABEL)
      .setStyle(YOUTUBE_CONFIG.BUTTONS.PREV.STYLE)
      .setDisabled(true);
      
    const disabledNextButton = new ButtonBuilder()
      .setCustomId(YOUTUBE_CONFIG.BUTTONS.DISABLED.NEXT_ID)
      .setLabel(YOUTUBE_CONFIG.BUTTONS.NEXT.LABEL)
      .setStyle(YOUTUBE_CONFIG.BUTTONS.NEXT.STYLE)
      .setDisabled(true);
    
    return new ActionRowBuilder().addComponents(
      disabledPrevButton, disabledNextButton
    );
  },

  /**
   * Creates an embed for a video.
   * 
   * @param {Object} video - Video data object.
   * @param {number} currentIndex - Current index in the results.
   * @param {number} totalCount - Total number of results.
   * @returns {EmbedBuilder} - Discord embed with video information.
   */
  createVideoEmbed(video, currentIndex, totalCount) {
    const snippet = video.snippet;
    const statistics = video.statistics || {};
    
    // Extract video details with fallbacks.
    const title = snippet.title || "No Title";
    const description = snippet.description || "No Description";
    const channelTitle = snippet.channelTitle || "Unknown Channel";
    const publishedAt = snippet.publishedAt;
    const viewCount = parseInt(statistics.viewCount) || 0;
    const likeCount = parseInt(statistics.likeCount) || 0;
    const duration = this.formatDuration(video.contentDetails?.duration || "PT0S");
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const thumbnail = snippet.thumbnails.high?.url || snippet.thumbnails.default?.url;
    
    const truncatedDescription = description.length > YOUTUBE_CONFIG.EMBED.DESCRIPTION_MAX_LENGTH ? 
      `${description.substring(0, YOUTUBE_CONFIG.EMBED.DESCRIPTION_MAX_LENGTH)}...` : 
      description;
    
    return new EmbedBuilder()
      .setTitle(YOUTUBE_CONFIG.EMBED.TITLE_PREFIX.replace('%s', title))
      .setDescription(truncatedDescription)
      .setURL(videoUrl)
      .setColor(YOUTUBE_CONFIG.EMBED.COLOR)
      .addFields(
        { name: YOUTUBE_CONFIG.EMBED.FIELDS.VIEWS, value: viewCount.toLocaleString(), inline: true },
        { name: YOUTUBE_CONFIG.EMBED.FIELDS.LIKES, value: likeCount.toLocaleString(), inline: true },
        { name: YOUTUBE_CONFIG.EMBED.FIELDS.DURATION, value: duration, inline: true },
        { name: YOUTUBE_CONFIG.EMBED.FIELDS.PUBLISHED, value: new Date(publishedAt).toLocaleDateString(), inline: true },
        { name: YOUTUBE_CONFIG.EMBED.FIELDS.CHANNEL, value: channelTitle, inline: true }
      )
      .setImage(thumbnail)
      .setFooter({ 
        text: YOUTUBE_CONFIG.EMBED.FOOTER.replace('%s', currentIndex + 1).replace('%s', totalCount) 
      });
  },

  /**
   * Formats video duration from ISO 8601 format to a human-readable string.
   * 
   * @param {string} isoDuration - Duration in ISO 8601 format (e.g., "PT1H30M15S").
   * @returns {string} - Formatted duration string (e.g., "1:30:15").
   */
  formatDuration(isoDuration) {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return "Unknown";
    
    const hours = match[1] ? `${match[1]}:` : '';
    const minutes = match[2] ? 
      (hours && match[2].padStart(2, '0') || match[2]) + ':' : 
      '0:';
    const seconds = match[3] ? match[3].padStart(2, '0') : '00';
    
    return `${hours}${minutes}${seconds}`;
  }
};
