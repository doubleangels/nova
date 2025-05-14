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
const YOUTUBE_DESCRIPTION_MAX_LENGTH = 1024; // We truncate long descriptions to keep embeds clean.
const YOUTUBE_COLLECTOR_TIMEOUT_MS = 120000; // We set a 2-minute timeout for the pagination.
const YOUTUBE_RELEVANCE_LIKES_WEIGHT = 0.001; // We use this factor for relevance calculation.
const YOUTUBE_REQUEST_TIMEOUT = 10000;

// We use a simple in-memory cache to reduce API calls.
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 10; // We cache results for 10 minutes to stay within API limits.

/**
 * Module for the /youtube command.
 * We search for and display YouTube video information.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('We search for a video on YouTube.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What would you like to search for?')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('query');

    try {
      const response = await axios.get(`${YOUTUBE_API_SEARCH_URL}`, {
        params: {
          part: 'snippet',
          q: query,
          type: 'video',
          maxResults: 1,
          key: config.googleApiKey
        },
        timeout: YOUTUBE_REQUEST_TIMEOUT
      });

      if (!response.data.items || response.data.items.length === 0) {
        return await interaction.editReply({
          content: `We couldn't find any videos matching "${query}".`
        });
      }

      const video = response.data.items[0];
      const videoDetails = await this.getVideoDetails(video.id.videoId);

      const embed = new EmbedBuilder()
        .setColor(YOUTUBE_EMBED_COLOR)
        .setTitle(video.snippet.title)
        .setURL(`https://www.youtube.com/watch?v=${video.id.videoId}`)
        .setDescription(this.truncateText(video.snippet.description, YOUTUBE_DESCRIPTION_MAX_LENGTH))
        .setThumbnail(video.snippet.thumbnails.high.url)
        .addFields(
          { name: 'Channel', value: video.snippet.channelTitle, inline: true },
          { name: 'Views', value: videoDetails.viewCount.toLocaleString(), inline: true },
          { name: 'Duration', value: this.formatDuration(videoDetails.duration), inline: true }
        )
        .setFooter({ text: `Published on ${new Date(video.snippet.publishedAt).toLocaleDateString()}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Gets detailed information about a YouTube video.
   * @param {string} videoId - The ID of the video to get details for.
   * @returns {Promise<Object>} The video details.
   */
  async getVideoDetails(videoId) {
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
  },

  /**
   * Formats a YouTube duration string into a human-readable format.
   * @param {string} duration - The duration in ISO 8601 format.
   * @returns {string} The formatted duration.
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
   * @param {string} text - The text to truncate.
   * @param {number} maxLength - The maximum length allowed.
   * @returns {string} The truncated text.
   */
  truncateText(text, maxLength) {
    if (!text) return 'No description available.';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  },

  /**
   * Handles errors that occur during command execution.
   * @param {CommandInteraction} interaction - The interaction that triggered the command.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error('YouTube command error:', {
      error: error.message,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    let errorMessage = 'We encountered an error while searching YouTube.';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'The request to YouTube timed out. Please try again later.';
    } else if (error.response) {
      if (error.response.status === 403) {
        errorMessage = 'We\'re having trouble accessing the YouTube API. Please try again later.';
      } else if (error.response.status === 429) {
        errorMessage = 'We\'ve hit the rate limit for YouTube. Please try again later.';
      } else if (error.response.status >= 500) {
        errorMessage = 'YouTube is currently experiencing issues. Please try again later.';
      }
    }

    await interaction.editReply({ content: errorMessage });
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