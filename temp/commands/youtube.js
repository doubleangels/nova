const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults } = require('../utils/searchUtils');

const cache = new Map();

/**
 * Command module for searching and displaying YouTube content.
 * Supports searching for videos, channels, and playlists with rich embeds.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Search for a video on YouTube.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What do you want to search for?')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('What type of content do you want to search for?')
        .addChoices(
          { name: 'Video', value: 'video' },
          { name: 'Channel', value: 'channel' },
          { name: 'Playlist', value: 'playlist' }
        )),

  /**
   * Executes the YouTube search command.
   * This function:
   * 1. Validates API configuration
   * 2. Performs search based on query and content type
   * 3. Creates paginated results with rich embeds
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error searching YouTube
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ YouTube API configuration is missing. Please contact an administrator.",
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
          content: "⚠️ No results found for your search.",
          ephemeral: true
        });
      }

      const generateEmbed = (index) => this.createContentEmbed(searchResults[index], contentType, index, searchResults.length);

      await createPaginatedResults(
        interaction,
        searchResults,
        generateEmbed,
        'youtube',
        120000,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          nextLabel: 'Next',
          prevEmoji: '⬅️',
          nextEmoji: '➡️'
        }
      );

      logger.info("/youtube command completed successfully:", {
        userId: interaction.user.id,
        query,
        contentType,
        resultCount: searchResults.length
      });

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Fetches detailed information for a specific video.
   * 
   * @param {string} videoId - YouTube video ID
   * @returns {Promise<Object>} Video details including duration and view count
   * @throws {Error} If there's an error fetching video details
   */
  async getVideoDetails(videoId) {
    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'contentDetails,statistics',
          id: videoId,
          key: config.googleApiKey
        },
        timeout: 10000
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
   * Formats ISO 8601 duration string to human-readable format.
   * 
   * @param {string} duration - ISO 8601 duration string
   * @returns {string} Formatted duration string (HH:MM:SS)
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
   * Truncates text to specified maximum length.
   * 
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length before truncation
   * @returns {string} Truncated text with ellipsis if needed
   */
  truncateText(text, maxLength) {
    if (!text) return 'No description available.';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  },

  /**
   * Handles errors that occur during command execution.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in youtube command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching YouTube.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to search YouTube. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message === "NO_RESULTS") {
      errorMessage = "⚠️ No results found for your search query.";
    } else if (error.message === "INVALID_QUERY") {
      errorMessage = "⚠️ Please provide a valid search query.";
    } else if (error.message === "INVALID_CONTENT_TYPE") {
      errorMessage = "⚠️ Invalid content type specified.";
    } else if (error.message === "INVALID_SORT_METHOD") {
      errorMessage = "⚠️ Invalid sort method specified.";
    } else if (error.message === "INVALID_DURATION") {
      errorMessage = "⚠️ Invalid duration specified.";
    } else if (error.message === "CONFIG_MISSING") {
      errorMessage = "⚠️ YouTube API key is missing. Please contact an administrator.";
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
      }).catch(() => {});
    }
  },

  /**
   * Retrieves cached search results if available and not expired.
   * 
   * @param {string} key - Cache key
   * @returns {Array|null} Cached results or null if not found/expired
   */
  getCachedResults(key) {
    if (cache.has(key)) {
      const { timestamp, data } = cache.get(key);
      if (Date.now() - timestamp < (1000 * 60 * 10)) {
        return data;
      }
      cache.delete(key);
    }
    return null;
  },
  
  /**
   * Stores search results in cache with timestamp.
   * 
   * @param {string} key - Cache key
   * @param {Array} data - Search results to cache
   */
  cacheResults(key, data) {
    cache.set(key, {
      timestamp: Date.now(),
      data
    });
  },
  
  /**
   * Searches YouTube for content matching the query.
   * 
   * @param {string} query - Search query
   * @param {string} contentType - Type of content to search for
   * @param {string} sortMethod - Method to sort results by
   * @param {string} duration - Duration filter for videos
   * @returns {Promise<Array>} Array of search results
   * @throws {Error} If there's an error searching YouTube
   */
  async searchYouTube(query, contentType, sortMethod, duration) {
    try {
      const params = {
        part: 'snippet',
        q: query,
        type: contentType,
        maxResults: 20,
        key: config.googleApiKey,
        order: sortMethod,
        safeSearch: 'moderate'
      };
      
      if (contentType === 'video' && duration !== 'any') {
        params.videoDuration = duration;
      }
      
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params,
        timeout: 5000
      });
      
      if (!response.data || !response.data.items || response.data.items.length === 0) {
        logger.debug("YouTube API returned no results:", { query, contentType });
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
   * Enriches video search results with additional details.
   * 
   * @param {Array} videos - Array of video search results
   * @returns {Promise<Array>} Enriched video results
   */
  async enrichVideoResults(videos) {
    if (!videos || videos.length === 0) return [];
    
    try {
      const videoIds = videos.map(video => video.id.videoId).join(',');
      
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'snippet,statistics,contentDetails',
          id: videoIds,
          key: config.googleApiKey
        },
        timeout: 5000
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
   * Enriches channel search results with additional details.
   * 
   * @param {Array} channels - Array of channel search results
   * @returns {Promise<Array>} Enriched channel results
   */
  async enrichChannelResults(channels) {
    if (!channels || channels.length === 0) return [];
    
    try {
      const channelIds = channels.map(channel => channel.id.channelId).join(',');
      
      const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: {
          part: 'snippet,statistics',
          id: channelIds,
          key: config.googleApiKey
        },
        timeout: 5000
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
   * Enriches playlist search results with additional details.
   * 
   * @param {Array} playlists - Array of playlist search results
   * @returns {Promise<Array>} Enriched playlist results
   */
  async enrichPlaylistResults(playlists) {
    if (!playlists || playlists.length === 0) return [];
    
    try {
      const playlistIds = playlists.map(playlist => playlist.id.playlistId).join(',');
      
      const response = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
        params: {
          part: 'snippet,contentDetails',
          id: playlistIds,
          key: config.googleApiKey
        },
        timeout: 5000
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
   * Creates a Discord embed for search results.
   * 
   * @param {Object} item - Search result item
   * @param {string} contentType - Type of content
   * @param {number} index - Index in results
   * @param {number} totalItems - Total number of results
   * @returns {EmbedBuilder} Discord embed with content information
   */
  createContentEmbed(item, contentType, index, totalItems) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setFooter({ 
        text: `Powered by YouTube • Result ${index + 1} of ${totalItems}`
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
   * Creates a Discord embed for video results.
   * 
   * @param {Object} video - Video search result
   * @param {EmbedBuilder} embed - Base embed to modify
   * @param {number} index - Index in results
   * @param {number} totalItems - Total number of results
   * @returns {EmbedBuilder} Discord embed with video information
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
    if (description.length > 1024) {
      description = description.substring(0, 1021) + '...';
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
   * Creates a Discord embed for channel results.
   * 
   * @param {Object} channel - Channel search result
   * @param {EmbedBuilder} embed - Base embed to modify
   * @param {number} index - Index in results
   * @param {number} totalItems - Total number of results
   * @returns {EmbedBuilder} Discord embed with channel information
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
    if (description.length > 1024) {
      description = description.substring(0, 1021) + '...';
    }
    
    return embed
      .setTitle(`📺 ${snippet.title}`)
      .setURL(channelUrl)
      .setDescription(`${description}\n\n${stats}`)
      .setThumbnail(thumbnailUrl);
  },

  /**
   * Creates a Discord embed for playlist results.
   * 
   * @param {Object} playlist - Playlist search result
   * @param {EmbedBuilder} embed - Base embed to modify
   * @param {number} index - Index in results
   * @param {number} totalItems - Total number of results
   * @returns {EmbedBuilder} Discord embed with playlist information
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
    if (description.length > 1024) {
      description = description.substring(0, 1021) + '...';
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
   * Validates that required API configuration is present.
   * 
   * @returns {boolean} True if configuration is valid
   */
  validateConfiguration() {
    return config.googleApiKey;
  }
};
