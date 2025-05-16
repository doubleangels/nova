const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Search configuration constants
const MAX_SEARCH_RESULTS = 10;
const SEARCH_TIMEOUT_MS = 5000;
const MIN_SEARCH_LENGTH = 2;

/**
 * Creates a paginated results display with navigation buttons.
 * 
 * @async
 * @param {CommandInteraction} interaction - The Discord interaction that triggered the search
 * @param {Array} items - Array of items to paginate through
 * @param {Function} generateEmbed - Function that takes an index and returns an embed for that item
 * @param {string} prefix - Unique prefix for button IDs to prevent conflicts
 * @param {number} timeout - Time in milliseconds until buttons expire
 * @param {Object} logger - Logger object for debugging
 * @param {Object} [options={}] - Optional configuration
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

  // Extract options with defaults
  const buttonStyle = options.buttonStyle || ButtonStyle.Primary;
  const prevLabel = options.prevLabel || '◀';
  const nextLabel = options.nextLabel || '▶';
  const prevEmoji = options.prevEmoji || null;
  const nextEmoji = options.nextEmoji || null;

  /**
   * Creates navigation buttons based on current index.
   * 
   * @param {number} index - Current index in the items array
   * @returns {ActionRowBuilder} Row of buttons for navigation
   */
  const createArrowButtons = (index) => {
    const prevButton = new ButtonBuilder()
      .setCustomId(`${prefix}_prev_${interaction.user.id}_${Date.now()}`)
      .setStyle(buttonStyle)
      .setDisabled(index === 0);
      
    const nextButton = new ButtonBuilder()
      .setCustomId(`${prefix}_next_${interaction.user.id}_${Date.now()}`)
      .setStyle(buttonStyle)
      .setDisabled(index === items.length - 1);
    
    // Set emoji and/or label for previous button
    if (prevEmoji) {
      prevButton.setEmoji(prevEmoji);
      if (prevLabel !== '◀') prevButton.setLabel(prevLabel);
    } else {
      prevButton.setLabel(prevLabel);
    }

    // Set emoji and/or label for next button
    if (nextEmoji) {
      nextButton.setEmoji(nextEmoji);
      if (nextLabel !== '▶') nextButton.setLabel(nextLabel);
    } else {
      nextButton.setLabel(nextLabel);
    }
    
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
  };

  // Send initial message with the first item
  const message = await interaction.editReply({ 
    embeds: [generateEmbed(currentIndex)], 
    components: [createArrowButtons(currentIndex)] 
  });

  // Create filter to only allow the original user to navigate
  const filter = i => 
    (i.customId.startsWith(`${prefix}_prev_`) || 
     i.customId.startsWith(`${prefix}_next_`)) && 
    i.customId.includes(interaction.user.id);

  // Create a collector for button interactions
  const collector = message.createMessageComponentCollector({ 
    filter, 
    time: timeout,
    idle: 60000
  });
  
  // Handle button clicks
  collector.on('collect', async i => {
    const buttonType = i.customId.split('_')[1];
    
    logger.debug("Navigation button pressed.", {
      buttonType,
      currentIndex,
      userId: i.user.id
    });
    
    // Update index based on button clicked
    if (buttonType === 'prev') {
      currentIndex = Math.max(0, currentIndex - 1);
    } else if (buttonType === 'next') {
      currentIndex = Math.min(items.length - 1, currentIndex + 1);
    }

    // Update the message with the new embed and buttons
    await i.update({ 
      embeds: [generateEmbed(currentIndex)],
      components: [createArrowButtons(currentIndex)]
    });
  });

  // Handle collector ending (timeout or idle)
  collector.on('end', async (collected) => {
    logger.debug("Button collector ended.", {
      reason: collected.size ? "timeout" : "idle",
      totalInteractions: collected.size,
      userId: interaction.user.id
    });
    
    // Create disabled buttons for the final state
    const disabledPrevButton = new ButtonBuilder()
      .setCustomId(`${prefix}_prev_disabled`)
      .setStyle(buttonStyle)
      .setDisabled(true);
      
    const disabledNextButton = new ButtonBuilder()
      .setCustomId(`${prefix}_next_disabled`)
      .setStyle(buttonStyle)
      .setDisabled(true);
    
    // Set emoji and/or label for disabled previous button
    if (prevEmoji) {
      disabledPrevButton.setEmoji(prevEmoji);
      if (prevLabel !== '◀') disabledPrevButton.setLabel(prevLabel);
    } else {
      disabledPrevButton.setLabel(prevLabel);
    }
    
    // Set emoji and/or label for disabled next button
    if (nextEmoji) {
      disabledNextButton.setEmoji(nextEmoji);
      if (nextLabel !== '▶') disabledNextButton.setLabel(nextLabel);
    } else {
      disabledNextButton.setLabel(nextLabel);
    }
    
    // Create a row with disabled buttons
    const disabledNavRow = new ActionRowBuilder().addComponents(
      disabledPrevButton, disabledNextButton
    );
    
    // Update the message with disabled buttons
    await interaction.editReply({
      components: [disabledNavRow]
    }).catch(err => logger.error("Failed to update timed out message.", { error: err.message }));
  });
}

/**
 * Normalizes and validates search parameters.
 * 
 * @param {string} query - Search query
 * @param {number} resultsCount - Requested number of results
 * @param {number} defaultCount - Default number of results if not specified
 * @param {number} minResults - Minimum number of results allowed
 * @param {number} maxResults - Maximum number of results allowed
 * @returns {Object} Normalized search parameters or error object
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
 * Formats API errors into user-friendly messages.
 * 
 * @param {Error} apiError - The API error object
 * @returns {string} Formatted error message
 */
function formatApiError(apiError) {
  const statusCode = apiError.response?.status || "unknown";
  const errorMessage = apiError.response?.data?.error?.message || apiError.message;
  return `⚠️ Google API error (${statusCode}): ${errorMessage}`;
}

/**
 * Performs a search across multiple Discord entity types.
 * 
 * @async
 * @param {string} query - Search query
 * @param {Object} [options={}] - Search options
 * @param {boolean} [options.includeUsers=true] - Whether to search users
 * @param {boolean} [options.includeChannels=true] - Whether to search channels
 * @param {boolean} [options.includeMessages=true] - Whether to search messages
 * @returns {Promise<Array>} Combined search results sorted by relevance
 * @throws {Error} If search query is invalid or search times out
 */
async function performSearch(query, options = {}) {
  try {
    // Validate query length
    if (!query || query.length < MIN_SEARCH_LENGTH) {
      throw new Error(`Search query must be at least ${MIN_SEARCH_LENGTH} characters long.`);
    }

    // Merge default options with provided options
    const searchOptions = {
      includeUsers: true,
      includeChannels: true,
      includeMessages: true,
      ...options
    };

    // Collect search promises based on enabled options
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

    // Execute searches with timeout protection
    const results = await Promise.race([
      Promise.all(searchPromises),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Search timed out')), SEARCH_TIMEOUT_MS)
      )
    ]);

    // Combine, sort, and limit results
    const combinedResults = results.flat().sort((a, b) => b.relevance - a.relevance);
    return combinedResults.slice(0, MAX_SEARCH_RESULTS);
  } catch (error) {
    logger.error(`Error performing search for query "${query}": ${error.message}`);
    throw error;
  }
}

/**
 * Searches users based on username or nickname.
 * 
 * @async
 * @param {string} query - Search query
 * @returns {Promise<Array>} User search results
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
 * Searches channels based on name or topic.
 * 
 * @async
 * @param {string} query - Search query
 * @returns {Promise<Array>} Channel search results
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
 * Searches messages based on content or attachment names.
 * 
 * @async
 * @param {string} query - Search query
 * @returns {Promise<Array>} Message search results
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
 * Calculates the relevance score for a search result.
 * Higher scores indicate better matches.
 * 
 * @param {string} text - The text to compare against the query
 * @param {string} query - The search query
 * @returns {number} Relevance score between 0 and 1
 */
function calculateRelevance(text, query) {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  
  // Exact match gets maximum relevance
  if (normalizedText === normalizedQuery) {
    return 1.0;
  }
  
  // Contains match gets relevance based on position (earlier = higher relevance)
  if (normalizedText.includes(normalizedQuery)) {
    const position = normalizedText.indexOf(normalizedQuery);
    const positionWeight = 1 - (position / normalizedText.length);
    return 0.5 + (positionWeight * 0.5);
  }
  
  // Partial word matches get relevance based on percentage of query words matched
  const textWords = normalizedText.split(/\s+/);
  const queryWords = normalizedQuery.split(/\s+/);
  const matchingWords = queryWords.filter(word => 
    textWords.some(textWord => textWord.includes(word))
  );
  
  return matchingWords.length / queryWords.length;
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