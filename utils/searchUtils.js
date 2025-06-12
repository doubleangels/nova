const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Creates a paginated message with navigation buttons
 * @param {CommandInteraction} interaction - The interaction that triggered the pagination
 * @param {Array} items - The items to paginate through
 * @param {Function} generateEmbed - Function to generate the embed for each page
 * @param {string} prefix - Prefix for button custom IDs
 * @param {number} timeout - Timeout in milliseconds for the collector
 * @param {Logger} logger - Logger instance for debugging
 * @param {Object} [options={}] - Additional options for customization
 * @param {ButtonStyle} [options.buttonStyle] - Style for the navigation buttons
 * @param {string} [options.prevLabel] - Label for the previous button
 * @param {string} [options.nextLabel] - Label for the next button
 * @param {string} [options.prevEmoji] - Emoji for the previous button
 * @param {string} [options.nextEmoji] - Emoji for the next button
 * @returns {Promise<void>}
 */
async function createPaginatedResults(
  interaction, 
  items, 
  generateEmbed, 
  prefix, 
  timeout, 
  logger,
  options = {}
) {
  let currentIndex = 0;

  const buttonStyle = options.buttonStyle || ButtonStyle.Primary;
  const prevLabel = options.prevLabel || '◀';
  const nextLabel = options.nextLabel || '▶';
  const prevEmoji = options.prevEmoji || null;
  const nextEmoji = options.nextEmoji || null;

  const createArrowButtons = (index) => {
    const prevButton = new ButtonBuilder()
      .setCustomId(`${prefix}_prev_${interaction.user.id}_${Date.now()}`)
      .setStyle(buttonStyle)
      .setDisabled(index === 0);
      
    const nextButton = new ButtonBuilder()
      .setCustomId(`${prefix}_next_${interaction.user.id}_${Date.now()}`)
      .setStyle(buttonStyle)
      .setDisabled(index === items.length - 1);
    
    if (prevEmoji) {
      prevButton.setEmoji(prevEmoji);
      if (prevLabel !== '◀') prevButton.setLabel(prevLabel);
    } else {
      prevButton.setLabel(prevLabel);
    }

    if (nextEmoji) {
      nextButton.setEmoji(nextEmoji);
      if (nextLabel !== '▶') nextButton.setLabel(nextLabel);
    } else {
      nextButton.setLabel(nextLabel);
    }
    
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
  };

  const message = await interaction.editReply({ 
    embeds: [generateEmbed(currentIndex)], 
    components: [createArrowButtons(currentIndex)] 
  });

  const filter = i => 
    (i.customId.startsWith(`${prefix}_prev_`) || 
     i.customId.startsWith(`${prefix}_next_`)) && 
    i.customId.includes(interaction.user.id);

  const collector = message.createMessageComponentCollector({ 
    filter, 
    time: timeout,
    idle: 60000
  });
  
  collector.on('collect', async i => {
    const buttonType = i.customId.split('_')[1];
    
    logger.debug("Navigation button pressed.", {
      buttonType,
      currentIndex,
      userId: i.user.id
    });
    
    if (buttonType === 'prev') {
      currentIndex = Math.max(0, currentIndex - 1);
    } else if (buttonType === 'next') {
      currentIndex = Math.min(items.length - 1, currentIndex + 1);
    }

    await i.update({ 
      embeds: [generateEmbed(currentIndex)],
      components: [createArrowButtons(currentIndex)]
    });
  });

  collector.on('end', async (collected) => {
    logger.debug("Button collector ended.", {
      reason: collected.size ? "timeout" : "idle",
      totalInteractions: collected.size,
      userId: interaction.user.id
    });
    
    const disabledPrevButton = new ButtonBuilder()
      .setCustomId(`${prefix}_prev_disabled`)
      .setStyle(buttonStyle)
      .setDisabled(true);
      
    const disabledNextButton = new ButtonBuilder()
      .setCustomId(`${prefix}_next_disabled`)
      .setStyle(buttonStyle)
      .setDisabled(true);
    
    if (prevEmoji) {
      disabledPrevButton.setEmoji(prevEmoji);
      if (prevLabel !== '◀') disabledPrevButton.setLabel(prevLabel);
    } else {
      disabledPrevButton.setLabel(prevLabel);
    }
    
    if (nextEmoji) {
      disabledNextButton.setEmoji(nextEmoji);
      if (nextLabel !== '▶') disabledNextButton.setLabel(nextLabel);
    } else {
      disabledNextButton.setLabel(nextLabel);
    }
    
    const disabledNavRow = new ActionRowBuilder().addComponents(
      disabledPrevButton, disabledNextButton
    );
    
    await interaction.editReply({
      components: [disabledNavRow]
    }).catch(err => logger.error("Failed to update timed out message.", { error: err.message }));
  });
}

/**
 * Normalizes search parameters and validates them
 * @param {string} query - The search query
 * @param {number} resultsCount - Number of results requested
 * @param {number} defaultCount - Default number of results
 * @param {number} minResults - Minimum allowed results
 * @param {number} maxResults - Maximum allowed results
 * @returns {{valid: boolean, error?: string, query?: string, count?: number}} Normalized parameters or error
 */
function normalizeSearchParams(query, resultsCount, defaultCount, minResults, maxResults) {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: "Empty query" };
  }

  const normalizedQuery = query.trim();
  const normalizedCount = Math.max(minResults, Math.min(resultsCount || defaultCount, maxResults));
  
  return {
    valid: true,
    query: normalizedQuery,
    count: normalizedCount
  };
}

/**
 * Formats an API error message
 * @param {Error} apiError - The API error object
 * @returns {string} Formatted error message
 */
function formatApiError(apiError) {
  const statusCode = apiError.response?.status || "unknown";
  const errorMessage = apiError.response?.data?.error?.message || apiError.message;
  return `⚠️ Google API error (${statusCode}): ${errorMessage}`;
}

/**
 * Performs a search across multiple categories
 * @param {string} query - The search query
 * @param {Object} [options={}] - Search options
 * @param {boolean} [options.includeUsers=true] - Whether to include user results
 * @param {boolean} [options.includeChannels=true] - Whether to include channel results
 * @param {boolean} [options.includeMessages=true] - Whether to include message results
 * @returns {Promise<Array>} Combined and sorted search results
 * @throws {Error} If search fails or times out
 */
async function performSearch(query, options = {}) {
  try {
    if (!query || query.length < 2) {
      throw new Error(`Search query must be at least 2 characters long.`);
    }

    const searchOptions = {
      includeUsers: true,
      includeChannels: true,
      includeMessages: true,
      ...options
    };

    const searchPromises = [];
    if (searchOptions.includeUsers) {
      searchPromises.push(searchUsers(query));
    }
    if (searchOptions.includeChannels) {
      searchPromises.push(searchChannels(query));
    }
    if (searchOptions.includeMessages) {
      searchPromises.push(searchMessages(query));
    }

    const results = await Promise.race([
      Promise.all(searchPromises),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Search timed out')), 5000)
      )
    ]);

    const combinedResults = results.flat().sort((a, b) => b.relevance - a.relevance);
    return combinedResults.slice(0, 10);
  } catch (error) {
    logger.error('Search operation failed', error);
    throw new Error("⚠️ Search operation failed.");
  }
}

/**
 * Searches for users matching the query
 * @param {string} query - The search query
 * @returns {Promise<Array<{type: string, id: string, name: string, nickname?: string, relevance: number}>>} Matching users
 */
async function searchUsers(query) {
  try {
    const users = await getAllUsers();
    const normalizedQuery = query.toLowerCase();
    
    return users
      .filter(user => {
        const username = user.username.toLowerCase();
        const nickname = (user.nickname || '').toLowerCase();
        return username.includes(normalizedQuery) || nickname.includes(normalizedQuery);
      })
      .map(user => ({
        type: 'user',
        id: user.id,
        name: user.username,
        nickname: user.nickname,
        relevance: calculateRelevance(user.username, query)
      }));
  } catch (error) {
    logger.error(`Error searching users for query "${query}": ${error.message}`);
    return [];
  }
}

/**
 * Searches for channels matching the query
 * @param {string} query - The search query
 * @returns {Promise<Array<{type: string, id: string, name: string, topic?: string, relevance: number}>>} Matching channels
 */
async function searchChannels(query) {
  try {
    const channels = await getAllChannels();
    const normalizedQuery = query.toLowerCase();
    
    return channels
      .filter(channel => {
        const name = channel.name.toLowerCase();
        const topic = (channel.topic || '').toLowerCase();
        return name.includes(normalizedQuery) || topic.includes(normalizedQuery);
      })
      .map(channel => ({
        type: 'channel',
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        relevance: calculateRelevance(channel.name, query)
      }));
  } catch (error) {
    logger.error(`Error searching channels for query "${query}": ${error.message}`);
    return [];
  }
}

/**
 * Searches for messages matching the query
 * @param {string} query - The search query
 * @returns {Promise<Array<{type: string, id: string, content: string, author: Object, channel: Object, relevance: number}>>} Matching messages
 */
async function searchMessages(query) {
  try {
    const messages = await getRecentMessages();
    const normalizedQuery = query.toLowerCase();
    
    return messages
      .filter(message => {
        const content = message.content.toLowerCase();
        const attachments = message.attachments.map(a => a.name.toLowerCase());
        return content.includes(normalizedQuery) || 
               attachments.some(name => name.includes(normalizedQuery));
      })
      .map(message => ({
        type: 'message',
        id: message.id,
        content: message.content,
        author: message.author,
        channel: message.channel,
        relevance: calculateRelevance(message.content, query)
      }));
  } catch (error) {
    logger.error(`Error searching messages for query "${query}": ${error.message}`);
    return [];
  }
}

/**
 * Calculates the relevance score for a search result
 * @param {string} text - The text to search in
 * @param {string} query - The search query
 * @returns {number} Relevance score between 0 and 1
 */
function calculateRelevance(text, query) {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  
  if (normalizedText === normalizedQuery) {
    return 1.0;
  }
  
  if (normalizedText.includes(normalizedQuery)) {
    const position = normalizedText.indexOf(normalizedQuery);
    const positionWeight = 1 - (position / normalizedText.length);
    return 0.5 + (positionWeight * 0.5);
  }
  
  const textWords = normalizedText.split(/\s+/);
  const queryWords = normalizedQuery.split(/\s+/);
  const matchingWords = queryWords.filter(word => 
    textWords.some(textWord => textWord.includes(word))
  );
  
  return matchingWords.length / queryWords.length;
}

/**
 * Handles errors that occur during search operations
 * @param {Error} error - The error that occurred
 * @param {string} context - The context where the error occurred
 * @throws {Error} A formatted error message based on the error type
 */
function handleError(error, context) {
  logger.error(`Error in ${context}:`, {
    error: error.message,
    stack: error.stack,
    status: error.response?.status,
    data: error.response?.data
  });

  if (error.response) {
    switch (error.response.status) {
      case 429:
        throw new Error("API_RATE_LIMIT");
      case 403:
        throw new Error("API_ACCESS_ERROR");
      case 404:
        throw new Error("NO_RESULTS");
      default:
        throw new Error("API_ERROR");
    }
  } else if (error.request) {
    throw new Error("API_NETWORK_ERROR");
  } else {
    throw new Error("API_ERROR");
  }
}

module.exports = {
  createPaginatedResults,
  normalizeSearchParams,
  formatApiError,
  performSearch,
  searchUsers,
  searchChannels,
  searchMessages,
  calculateRelevance
};