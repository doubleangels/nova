const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const crypto = require('crypto');
const { createPaginatedResults, formatApiError } = require('../utils/searchUtils');

// These are the configuration constants for the YouTube integration.
const YOUTUBE_API_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_API_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_API_PLAYLISTS_URL = 'https://www.googleapis.com/youtube/v3/playlists';
const YOUTUBE_API_TIMEOUT_MS = 5000; // We set a 5-second timeout for API requests.
const YOUTUBE_SEARCH_MAX_RESULTS = 10; // We limit to a maximum of 10 results per search.
const YOUTUBE_EMBED_COLOR = 0xFF0000; // We use YouTube's signature red color for embeds.
const YOUTUBE_DESCRIPTION_MAX_LENGTH = 150; // We truncate long descriptions to keep embeds clean.
const YOUTUBE_COLLECTOR_TIMEOUT_MS = 120000; // We set a 2-minute timeout for the pagination.
const YOUTUBE_RELEVANCE_LIKES_WEIGHT = 0.001; // We use this factor for relevance calculation.

// We use a simple in-memory cache to reduce API calls.
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 10; // We cache results for 10 minutes to stay within API limits.

module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Search YouTube for videos, channels, or playlists.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What do you want to search for?')
        .setRequired(true)
    )
    .addStringOption(option => {
      const typeOption = option
        .setName('type')
        .setDescription('What type of content do you want to search for?')
        .setRequired(false);
      
      [
        { name: 'Videos', value: 'video' },
        { name: 'Channels', value: 'channel' },
        { name: 'Playlists', value: 'playlist' }
      ].forEach(choice => {
        typeOption.addChoices(choice);
      });
      
      return typeOption;
    })
    .addStringOption(option => {
      const sortOption = option
        .setName('sort')
        .setDescription('How do you want to sort the results?')
        .setRequired(false);
      
      [
        { name: 'Relevance', value: 'relevance' },
        { name: 'View Count', value: 'viewCount' },
        { name: 'Upload Date', value: 'date' },
        { name: 'Rating', value: 'rating' }
      ].forEach(choice => {
        sortOption.addChoices(choice);
      });
      
      return sortOption;
    })
    .addStringOption(option => {
      const durationOption = option
        .setName('duration')
        .setDescription('How long should the videos be?')
        .setRequired(false);
      
      [
        { name: 'Any', value: 'any' },
        { name: 'Short (<4 min)', value: 'short' },
        { name: 'Medium (4-20 min)', value: 'medium' },
        { name: 'Long (>20 min)', value: 'long' }
      ].forEach(choice => {
        durationOption.addChoices(choice);
      });
      
      return durationOption;
    }),
    
  /**
   * Executes the YouTube search command.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // We defer the reply to allow time for the API calls.
      await interaction.deferReply();
      
      logger.debug("YouTube command received.", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag 
      });
      
      // We check if the API key is configured before proceeding.
      if (!config.googleApiKey) {
        logger.error("YouTube API key is missing in configuration.");
        await interaction.editReply({ 
          content: '⚠️ YouTube API key is not configured. Please contact the bot administrator.',
          ephemeral: true
        });
        return;
      }
      
      // We retrieve and format the user's search query and options.
      const query = interaction.options.getString('query');
      const contentType = interaction.options.getString('type') || 'video';
      const sortMethod = interaction.options.getString('sort') || 'relevance';
      const duration = interaction.options.getString('duration') || 'any';
      
      logger.debug("Processing search request.", { 
        query, 
        contentType,
        sortMethod, 
        duration,
        userId: interaction.user.id 
      });
      
      const formattedQuery = query.trim();
      
      // We check the cache for this query to avoid unnecessary API calls.
      const cacheKey = `${contentType}:${formattedQuery}:${sortMethod}:${duration}`;
      const cachedResults = this.getCachedResults(cacheKey);
      
      let results;
      if (cachedResults) {
        logger.debug("Using cached results.", { cacheKey });
        results = cachedResults;
      } else {
        // We search for content using the YouTube API.
        results = await this.searchYouTube(formattedQuery, contentType, sortMethod, duration);
        
        // We cache the results if valid to reduce API usage.
        if (results && results.length > 0) {
          this.cacheResults(cacheKey, results);
        }
      }
      
      if (!results || results.length === 0) {
        logger.warn("No results found.", { query: formattedQuery, contentType });
        await interaction.editReply({ 
          content: `⚠️ No ${contentType} results found for **${formattedQuery}**. Try another search!`,
          ephemeral: true
        });
        return;
      }
      
      // We use the paginated results utility for a consistent user experience.
      const itemsToDisplay = results.slice(0, YOUTUBE_SEARCH_MAX_RESULTS);
      
      // We create a function that generates an embed for a specific index.
      const generateEmbed = (index) => {
        return this.createContentEmbed(
          itemsToDisplay[index],
          contentType,
          index,
          itemsToDisplay.length
        );
      };
      
      // We use the reusable pagination utility with YouTube-specific styling.
      await createPaginatedResults(
        interaction,
        itemsToDisplay,
        generateEmbed,
        'yt',
        YOUTUBE_COLLECTOR_TIMEOUT_MS,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          prevLabel: 'Previous',
          nextLabel: 'Next',
          prevEmoji: '◀️',
          nextEmoji: '▶️'
        }
      );
      logger.info("YouTube search results sent successfully.", { 
        query: formattedQuery, 
        contentType,
        resultCount: results.length,
        userId: interaction.user.id 
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    // We log any unexpected errors and send an error message to the user.
    logger.error("Error executing YouTube command.", { 
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id
    });
    
    // We check if the interaction hasn't been replied to yet before sending an error.
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ 
        content: "⚠️ An error occurred while processing your request. Please try again later.",
        ephemeral: true
      }).catch(err => {
        logger.error("Failed to send error message.", { error: err.message });
      });
    }
  },
  
  /**
   * Retrieves cached search results if they exist and haven't expired.
   * 
   * @param {string} key - The cache key.
   * @returns {Array|null} The cached results or null if not found or expired.
   */
  getCachedResults(key) {
    if (cache.has(key)) {
      const { timestamp, data } = cache.get(key);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
      // We remove expired cache entries to keep memory usage in check.
      cache.delete(key);
    }
    return null;
  },
  
  /**
   * Caches search results for future use.
   * 
   * @param {string} key - The cache key.
   * @param {Array} data - The data to cache.
   */
  cacheResults(key, data) {
    cache.set(key, {
      timestamp: Date.now(),
      data
    });
  },
  
  /**
   * Searches YouTube for content based on the provided parameters.
   * 
   * @param {string} query - The search query.
   * @param {string} contentType - The type of content to search for (video, channel, playlist).
   * @param {string} sortMethod - The method to sort results by.
   * @param {string} duration - The duration filter for videos.
   * @returns {Promise<Array>} The search results.
   */
  async searchYouTube(query, contentType, sortMethod, duration) {
    try {
      // We build search parameters for the YouTube API request.
      const params = {
        part: 'snippet',
        q: query,
        type: contentType,
        maxResults: YOUTUBE_SEARCH_MAX_RESULTS * 2, // We get more results than needed for filtering.
        key: config.googleApiKey,
        order: sortMethod,
        safeSearch: 'moderate'
      };
      
      // We add duration filter for videos if specified.
      if (contentType === 'video' && duration !== 'any') {
        params.videoDuration = duration;
      }
      
      // We make the API request with a timeout for safety.
      const response = await axios.get(YOUTUBE_API_SEARCH_URL, {
        params,
        timeout: YOUTUBE_API_TIMEOUT_MS
      });
      
      if (!response.data || !response.data.items || response.data.items.length === 0) {
        logger.debug("YouTube API returned no results.", { query, contentType });
        return [];
      }
      
      // We process and enrich the results based on content type.
      let results = response.data.items;
      
      if (contentType === 'video') {
        // We get additional video details like view count, likes, etc.
        results = await this.enrichVideoResults(results);
      } else if (contentType === 'channel') {
        // We get additional channel details like subscriber count.
        results = await this.enrichChannelResults(results);
      } else if (contentType === 'playlist') {
        // We get additional playlist details like item count.
        results = await this.enrichPlaylistResults(results);
      }
      
      return results;
    } catch (error) {
      logger.error("YouTube API search failed.", {
        error: error.message,
        query,
        contentType
      });
      throw error;
    }
  },
  
  /**
   * Enriches video results with additional details.
   * 
   * @param {Array} videos - The video search results.
   * @returns {Promise<Array>} The enriched video results.
   */
  async enrichVideoResults(videos) {
    if (!videos || videos.length === 0) return [];
    
    try {
      // We extract video IDs for the detailed information request.
      const videoIds = videos.map(video => video.id.videoId).join(',');
      
      // We get detailed video information including statistics.
      const response = await axios.get(YOUTUBE_API_VIDEOS_URL, {
        params: {
          part: 'snippet,statistics,contentDetails',
          id: videoIds,
          key: config.googleApiKey
        },
        timeout: YOUTUBE_API_TIMEOUT_MS
      });
      
      if (!response.data || !response.data.items) {
        return videos;
      }
      
      // We combine search results with detailed information.
      const detailedVideos = response.data.items;
      
      // We map detailed info back to the original search results.
      return videos.map(searchResult => {
        const detailedInfo = detailedVideos.find(
          video => video.id === searchResult.id.videoId
        );
        
        if (!detailedInfo) return searchResult;
        
        return {
          ...searchResult,
          statistics: detailedInfo.statistics,
          contentDetails: detailedInfo.contentDetails
        };
      });
    } catch (error) {
      logger.error("Failed to enrich video results.", {
        error: error.message
      });
      return videos;
    }
  },
  
  /**
   * Enriches channel results with additional details.
   * 
   * @param {Array} channels - The channel search results.
   * @returns {Promise<Array>} The enriched channel results.
   */
  async enrichChannelResults(channels) {
    if (!channels || channels.length === 0) return [];
    
    try {
      // We extract channel IDs for the detailed information request.
      const channelIds = channels.map(channel => channel.id.channelId).join(',');
      
      // We get detailed channel information including statistics.
      const response = await axios.get(YOUTUBE_API_CHANNELS_URL, {
        params: {
          part: 'snippet,statistics',
          id: channelIds,
          key: config.googleApiKey
        },
        timeout: YOUTUBE_API_TIMEOUT_MS
      });
      
      if (!response.data || !response.data.items) {
        return channels;
      }
      
      // We combine search results with detailed information.
      const detailedChannels = response.data.items;
      
      // We map detailed info back to the original search results.
      return channels.map(searchResult => {
        const detailedInfo = detailedChannels.find(
          channel => channel.id === searchResult.id.channelId
        );
        
        if (!detailedInfo) return searchResult;
        
        return {
          ...searchResult,
          statistics: detailedInfo.statistics
        };
      });
    } catch (error) {
      logger.error("Failed to enrich channel results.", {
        error: error.message
      });
      return channels;
    }
  },
  
  /**
   * Enriches playlist results with additional details.
   * 
   * @param {Array} playlists - The playlist search results.
   * @returns {Promise<Array>} The enriched playlist results.
   */
  async enrichPlaylistResults(playlists) {
    if (!playlists || playlists.length === 0) return [];
    
    try {
      // We extract playlist IDs for the detailed information request.
      const playlistIds = playlists.map(playlist => playlist.id.playlistId).join(',');
      
      // We get detailed playlist information including content details.
      const response = await axios.get(YOUTUBE_API_PLAYLISTS_URL, {
        params: {
          part: 'snippet,contentDetails',
          id: playlistIds,
          key: config.googleApiKey
        },
        timeout: YOUTUBE_API_TIMEOUT_MS
      });
      
      if (!response.data || !response.data.items) {
        return playlists;
      }
      
      // We combine search results with detailed information.
      const detailedPlaylists = response.data.items;
      
      // We map detailed info back to the original search results.
      return playlists.map(searchResult => {
        const detailedInfo = detailedPlaylists.find(
          playlist => playlist.id === searchResult.id.playlistId
        );
        
        if (!detailedInfo) return searchResult;
        
        return {
          ...searchResult,
          contentDetails: detailedInfo.contentDetails
        };
      });
    } catch (error) {
      logger.error("Failed to enrich playlist results.", {
        error: error.message
      });
      return playlists;
    }
  },
  
  /**
   * Creates an embed for a search result.
   * 
   * @param {Object} item - The search result item.
   * @param {string} contentType - The type of content.
   * @param {number} index - The index of the current item.
   * @param {number} totalItems - The total number of items.
   * @returns {EmbedBuilder} The generated embed.
   */
  createContentEmbed(item, contentType, index, totalItems) {
    const embed = new EmbedBuilder()
      .setColor(YOUTUBE_EMBED_COLOR)
      .setFooter({ 
        text: `Result ${index + 1} of ${totalItems} • Powered by YouTube`
      });
    
    switch (contentType) {
      case 'video':
        return this.createVideoEmbed(item, embed, index, totalItems);
      case 'channel':
        return this.createChannelEmbed(item, embed, index, totalItems);
      case 'playlist':
        return this.createPlaylistEmbed(item, embed, index, totalItems);
      default:
        return embed.setDescription('Unknown content type');
    }
  },
  
  /**
   * Creates an embed for a video search result.
   * 
   * @param {Object} video - The video search result.
   * @param {EmbedBuilder} embed - The embed builder.
   * @param {number} index - The index of the current item.
   * @param {number} totalItems - The total number of items.
   * @returns {EmbedBuilder} The generated embed.
   */
  createVideoEmbed(video, embed, index, totalItems) {
    const snippet = video.snippet;
    const statistics = video.statistics || {};
    const videoId = video.id.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnailUrl = snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url;
    
    // We format view count and likes if available.
    const viewCount = statistics.viewCount ? 
      `👁️ ${parseInt(statistics.viewCount).toLocaleString()} views` : '';
    const likeCount = statistics.likeCount ? 
      `👍 ${parseInt(statistics.likeCount).toLocaleString()} likes` : '';
    const stats = [viewCount, likeCount].filter(Boolean).join(' • ');
    
    // We format the description, truncating if necessary.
    let description = snippet.description || 'No description available';
    if (description.length > YOUTUBE_DESCRIPTION_MAX_LENGTH) {
      description = description.substring(0, YOUTUBE_DESCRIPTION_MAX_LENGTH) + '...';
    }
    
    // We format the upload date.
    const uploadDate = snippet.publishedAt ? 
      `📅 ${new Date(snippet.publishedAt).toLocaleDateString()}` : '';
    
    return embed
      .setTitle(`🎬 ${snippet.title}`)
      .setURL(videoUrl)
      .setDescription(`${description}\n\n${stats}\n${uploadDate}`)
      .setImage(thumbnailUrl)
      .setAuthor({
        name: snippet.channelTitle,
        url: `https://www.youtube.com/channel/${snippet.channelId}`
      });
  },
  
  /**
   * Creates an embed for a channel search result.
   * 
   * @param {Object} channel - The channel search result.
   * @param {EmbedBuilder} embed - The embed builder.
   * @param {number} index - The index of the current item.
   * @param {number} totalItems - The total number of items.
   * @returns {EmbedBuilder} The generated embed.
   */
  createChannelEmbed(channel, embed, index, totalItems) {
    const snippet = channel.snippet;
    const statistics = channel.statistics || {};
    const channelId = channel.id.channelId;
    const channelUrl = `https://www.youtube.com/channel/${channelId}`;
    const thumbnailUrl = snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url;
    
    // We format subscriber count if available.
    const subscriberCount = statistics.subscriberCount ? 
      `👥 ${parseInt(statistics.subscriberCount).toLocaleString()} subscribers` : '';
    const videoCount = statistics.videoCount ? 
      `🎬 ${parseInt(statistics.videoCount).toLocaleString()} videos` : '';
    const stats = [subscriberCount, videoCount].filter(Boolean).join(' • ');
    
    // We format the description, truncating if necessary.
    let description = snippet.description || 'No description available';
    if (description.length > YOUTUBE_DESCRIPTION_MAX_LENGTH) {
      description = description.substring(0, YOUTUBE_DESCRIPTION_MAX_LENGTH) + '...';
    }
    
    return embed
      .setTitle(`📺 ${snippet.title}`)
      .setURL(channelUrl)
      .setDescription(`${description}\n\n${stats}`)
      .setThumbnail(thumbnailUrl);
  },
  
  /**
   * Creates an embed for a playlist search result.
   * 
   * @param {Object} playlist - The playlist search result.
   * @param {EmbedBuilder} embed - The embed builder.
   * @param {number} index - The index of the current item.
   * @param {number} totalItems - The total number of items.
   * @returns {EmbedBuilder} The generated embed.
   */
  createPlaylistEmbed(playlist, embed, index, totalItems) {
    const snippet = playlist.snippet;
    const contentDetails = playlist.contentDetails || {};
    const playlistId = playlist.id.playlistId;
    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    const thumbnailUrl = snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url;
    
    // We format item count if available.
    const itemCount = contentDetails.itemCount ? 
      `🎬 ${contentDetails.itemCount} videos` : '';
    
    // We format the description, truncating if necessary.
    let description = snippet.description || 'No description available';
    if (description.length > YOUTUBE_DESCRIPTION_MAX_LENGTH) {
      description = description.substring(0, YOUTUBE_DESCRIPTION_MAX_LENGTH) + '...';
    }
    
    return embed
      .setTitle(`📋 ${snippet.title}`)
      .setURL(playlistUrl)
      .setDescription(`${description}\n\n${itemCount}`)
      .setThumbnail(thumbnailUrl)
      .setAuthor({
        name: snippet.channelTitle,
        url: `https://www.youtube.com/channel/${snippet.channelId}`
      });
  }
};