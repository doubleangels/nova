/**
 * YouTube command module for searching and displaying YouTube content.
 * Handles API interactions, result formatting, and pagination.
 * @module commands/youtube
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const crypto = require('crypto');
const { createPaginatedResults, formatApiError } = require('../utils/searchUtils');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const YOUTUBE_API_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_API_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_API_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_API_PLAYLISTS_URL = 'https://www.googleapis.com/youtube/v3/playlists';
const YOUTUBE_API_TIMEOUT_MS = 5000;
const YOUTUBE_SEARCH_MAX_RESULTS = 10;
const YOUTUBE_EMBED_COLOR = 0xFF0000;
const YOUTUBE_DESCRIPTION_MAX_LENGTH = 1024;
const YOUTUBE_COLLECTOR_TIMEOUT_MS = 120000;
const YOUTUBE_REQUEST_TIMEOUT = 10000;

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 10;

/**
 * We handle the youtube command.
 * This function allows users to search for videos on YouTube.
 *
 * We perform several tasks:
 * 1. We validate YouTube API configuration.
 * 2. We process search requests for videos.
 * 3. We format and display search results.
 * 4. We handle errors and provide user feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Search for a video on YouTube.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What would you like to search for?')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('The type of content to search for')
        .addChoices(
          { name: 'Video', value: 'video' },
          { name: 'Channel', value: 'channel' },
          { name: 'Playlist', value: 'playlist' }
        )),

  /**
   * Executes the YouTube command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If search or content retrieval fails
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }

      await interaction.deferReply();
      logger.info("/youtube command initiated:", { 
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const query = interaction.options.getString('query');
      const contentType = interaction.options.getString('type') || 'video';
      const sortMethod = interaction.options.getString('sort') || 'relevance';
      const duration = interaction.options.getString('duration') || 'any';

      const searchResults = await this.searchYouTube(query, contentType, sortMethod, duration);
      
      if (!searchResults || searchResults.length === 0) {
        logger.warn("No search results found for query:", { query });
        return await interaction.editReply({ 
          content: ERROR_MESSAGES.NO_RESULTS_FOUND,
          ephemeral: true
        });
      }

      const generateEmbed = (index) => this.createContentEmbed(searchResults[index], contentType, index, searchResults.length);

      await createPaginatedResults(
        interaction,
        searchResults,
        generateEmbed,
        'youtube',
        YOUTUBE_COLLECTOR_TIMEOUT_MS,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          nextLabel: 'Next',
          prevEmoji: '⬅️',
          nextEmoji: '➡️'
        }
      );

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Gets detailed information about a YouTube video.
   * @async
   * @function getVideoDetails
   * @param {string} videoId - The ID of the video to get details for
   * @returns {Promise<Object>} The video details
   */
  async getVideoDetails(videoId) {
    try {
      const response = await axios.get(`${YOUTUBE_API_VIDEOS_URL}`, {
        params: {
          part: 'contentDetails,statistics',
          id: videoId,
          key: config.googleApiKey
        },
        timeout: YOUTUBE_REQUEST_TIMEOUT
      });

      return {
        duration: response.data.items[0].contentDetails.duration,
        viewCount: parseInt(response.data.items[0].statistics.viewCount)
      };
    } catch (error) {
      logger.error("Failed to get video details:", {
        error: error.message,
        videoId
      });
      throw new Error("API_ERROR");
    }
  },

  /**
   * Formats a YouTube duration string into a human-readable format.
   * @function formatDuration
   * @param {string} duration - The duration in ISO 8601 format
   * @returns {string} The formatted duration
   */
  formatDuration(duration) {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    const hours = (match[1] || '').replace('H', '');
    const minutes = (match[2] || '').replace('M', '');
    const seconds = (match[3] || '').replace('S', '');

    let result = '';
    if (hours) result += `${hours}:`;
    result += `${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
    return result;
  },

  /**
   * Truncates text to a maximum length and adds ellipsis if needed.
   * @function truncateText
   * @param {string} text - The text to truncate
   * @param {number} maxLength - The maximum length allowed
   * @returns {string} The truncated text
   */
  truncateText(text, maxLength) {
    if (!text) return 'No description available.';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'youtube', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.YOUTUBE_API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    } else if (error.message === "NO_RESULTS") {
      errorMessage = ERROR_MESSAGES.YOUTUBE_NO_RESULTS;
    } else if (error.message === "INVALID_VIDEO") {
      errorMessage = ERROR_MESSAGES.YOUTUBE_INVALID_VIDEO;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for youtube command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
      });
    }
  },

  /**
   * Retrieves cached search results if they exist and haven't expired.
   * @function getCachedResults
   * @param {string} key - The cache key
   * @returns {Array|null} The cached results or null if not found or expired
   */
  getCachedResults(key) {
    if (cache.has(key)) {
      const { timestamp, data } = cache.get(key);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
      cache.delete(key);
    }
    return null;
  },
  
  /**
   * Caches search results for future use.
   * @function cacheResults
   * @param {string} key - The cache key
   * @param {Array} data - The data to cache
   */
  cacheResults(key, data) {
    cache.set(key, {
      timestamp: Date.now(),
      data
    });
  },
  
  /**
   * Searches YouTube for content based on the provided parameters.
   * @async
   * @function searchYouTube
   * @param {string} query - The search query
   * @param {string} contentType - The type of content to search for
   * @param {string} sortMethod - The method to sort results by
   * @param {string} duration - The duration filter for videos
   * @returns {Promise<Array>} The search results
   */
  async searchYouTube(query, contentType, sortMethod, duration) {
    try {
      const params = {
        part: 'snippet',
        q: query,
        type: contentType,
        maxResults: YOUTUBE_SEARCH_MAX_RESULTS * 2, // We get more results than needed for filtering.
        key: config.googleApiKey,
        order: sortMethod,
        safeSearch: 'moderate'
      };
      
      if (contentType === 'video' && duration !== 'any') {
        params.videoDuration = duration;
      }
      
      const response = await axios.get(YOUTUBE_API_SEARCH_URL, {
        params,
        timeout: YOUTUBE_API_TIMEOUT_MS
      });
      
      if (!response.data || !response.data.items || response.data.items.length === 0) {
        logger.debug("YouTube API returned no results.", { query, contentType });
        return [];
      }
      
      let results = response.data.items;
      
      if (contentType === 'video') {
        results = await this.enrichVideoResults(results);
      } else if (contentType === 'channel') {
        results = await this.enrichChannelResults(results);
      } else if (contentType === 'playlist') {
        results = await this.enrichPlaylistResults(results);
      }
      
      return results;
    } catch (error) {
      logger.error("YouTube API search failed:", {
        error: error.message,
        query,
        contentType
      });
      throw error;
    }
  },
  
  /**
   * Enriches video results with additional details.
   * @async
   * @function enrichVideoResults
   * @param {Array} videos - The video search results
   * @returns {Promise<Array>} The enriched video results
   */
  async enrichVideoResults(videos) {
    if (!videos || videos.length === 0) return [];
    
    try {
      const videoIds = videos.map(video => video.id.videoId).join(',');
      
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
      
      const detailedVideos = response.data.items;
      
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
      logger.error("Failed to enrich video results:", {
        error: error.message
      });
      return videos;
    }
  },
  
  /**
   * Enriches channel results with additional details.
   * @async
   * @function enrichChannelResults
   * @param {Array} channels - The channel search results
   * @returns {Promise<Array>} The enriched channel results
   */
  async enrichChannelResults(channels) {
    if (!channels || channels.length === 0) return [];
    
    try {
      const channelIds = channels.map(channel => channel.id.channelId).join(',');
      
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
      
      const detailedChannels = response.data.items;
      
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
      logger.error("Failed to enrich channel results:", {
        error: error.message
      });
      return channels;
    }
  },
  
  /**
   * Enriches playlist results with additional details.
   * @async
   * @function enrichPlaylistResults
   * @param {Array} playlists - The playlist search results
   * @returns {Promise<Array>} The enriched playlist results
   */
  async enrichPlaylistResults(playlists) {
    if (!playlists || playlists.length === 0) return [];
    
    try {
      const playlistIds = playlists.map(playlist => playlist.id.playlistId).join(',');
      
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
      
      const detailedPlaylists = response.data.items;
      
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
      logger.error("Failed to enrich playlist results:", {
        error: error.message
      });
      return playlists;
    }
  },
  
  /**
   * Creates an embed for a search result.
   * @function createContentEmbed
   * @param {Object} item - The search result item
   * @param {string} contentType - The type of content
   * @param {number} index - The index of the current item
   * @param {number} totalItems - The total number of items
   * @returns {EmbedBuilder} The generated embed
   */
  createContentEmbed(item, contentType, index, totalItems) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
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
   * @function createVideoEmbed
   * @param {Object} video - The video search result
   * @param {EmbedBuilder} embed - The embed builder
   * @param {number} index - The index of the current item
   * @param {number} totalItems - The total number of items
   * @returns {EmbedBuilder} The generated embed
   */
  createVideoEmbed(video, embed, index, totalItems) {
    const snippet = video.snippet;
    const statistics = video.statistics || {};
    const videoId = video.id.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnailUrl = snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url;
    
    const viewCount = statistics.viewCount ? 
      `👁️ ${parseInt(statistics.viewCount).toLocaleString()} views` : '';
    const likeCount = statistics.likeCount ? 
      `👍 ${parseInt(statistics.likeCount).toLocaleString()} likes` : '';
    const stats = [viewCount, likeCount].filter(Boolean).join(' • ');
    
    let description = snippet.description || 'No description available';
    if (description.length > YOUTUBE_DESCRIPTION_MAX_LENGTH) {
      description = description.substring(0, YOUTUBE_DESCRIPTION_MAX_LENGTH) + '...';
    }
    
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
   * @function createChannelEmbed
   * @param {Object} channel - The channel search result
   * @param {EmbedBuilder} embed - The embed builder
   * @param {number} index - The index of the current item
   * @param {number} totalItems - The total number of items
   * @returns {EmbedBuilder} The generated embed
   */
  createChannelEmbed(channel, embed, index, totalItems) {
    const snippet = channel.snippet;
    const statistics = channel.statistics || {};
    const channelId = channel.id.channelId;
    const channelUrl = `https://www.youtube.com/channel/${channelId}`;
    const thumbnailUrl = snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url;
    
    const subscriberCount = statistics.subscriberCount ? 
      `👥 ${parseInt(statistics.subscriberCount).toLocaleString()} subscribers` : '';
    const videoCount = statistics.videoCount ? 
      `🎬 ${parseInt(statistics.videoCount).toLocaleString()} videos` : '';
    const stats = [subscriberCount, videoCount].filter(Boolean).join(' • ');
    
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
   * @function createPlaylistEmbed
   * @param {Object} playlist - The playlist search result
   * @param {EmbedBuilder} embed - The embed builder
   * @param {number} index - The index of the current item
   * @param {number} totalItems - The total number of items
   * @returns {EmbedBuilder} The generated embed
   */
  createPlaylistEmbed(playlist, embed, index, totalItems) {
    const snippet = playlist.snippet;
    const contentDetails = playlist.contentDetails || {};
    const playlistId = playlist.id.playlistId;
    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    const thumbnailUrl = snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url;
    
    const itemCount = contentDetails.itemCount ? 
      `🎬 ${contentDetails.itemCount} videos` : '';
    
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
  },

  /**
   * Validates that the YouTube API configuration is properly set up.
   * @function validateConfiguration
   * @returns {boolean} Whether the configuration is valid
   */
  validateConfiguration() {
    return config.googleApiKey;
  }
};