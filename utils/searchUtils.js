const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * We define these configuration constants for consistent search behavior.
 * @type {number}
 */
const MAX_SEARCH_RESULTS = 10;
const SEARCH_TIMEOUT_MS = 5000;
const MIN_SEARCH_LENGTH = 2;

/**
 * Creates a paginated collector for search results.
 * This function is used to display search results with navigation buttons for better user experience.
 * 
 * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
 * @param {Array} items - The search result items.
 * @param {Function} generateEmbed - Function to generate an embed for a specific index.
 * @param {string} prefix - Prefix for button IDs (e.g., 'search' or 'img').
 * @param {number} timeout - Collector timeout in milliseconds.
 * @param {object} logger - Logger instance.
 * @param {object} options - Additional options for customization.
 * @param {ButtonStyle} options.buttonStyle - Button style (e.g., ButtonStyle.Primary, ButtonStyle.Danger).
 * @param {string} options.prevLabel - Label for the previous button.
 * @param {string} options.nextLabel - Label for the next button.
 * @param {string} options.prevEmoji - Emoji for the previous button.
 * @param {string} options.nextEmoji - Emoji for the next button.
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

  // We set default options for button styling and labels.
  const buttonStyle = options.buttonStyle || ButtonStyle.Primary;
  const prevLabel = options.prevLabel || '◀';
  const nextLabel = options.nextLabel || '▶';
  const prevEmoji = options.prevEmoji || null;
  const nextEmoji = options.nextEmoji || null;

  /**
   * Creates arrow buttons for navigation based on the current index.
   * Buttons are disabled when at the first or last page to prevent invalid navigation.
   * 
   * @param {number} index - The current page index.
   * @returns {ActionRowBuilder} A row of navigation buttons.
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
    
    // We add label or emoji based on provided options for better accessibility.
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

  // We send the initial embed with navigation buttons.
  const message = await interaction.editReply({ 
    embeds: [generateEmbed(currentIndex)], 
    components: [createArrowButtons(currentIndex)] 
  });

  // We create a collector to handle button interactions from the user.
  const filter = i => 
    (i.customId.startsWith(`${prefix}_prev_`) || 
     i.customId.startsWith(`${prefix}_next_`)) && 
    i.customId.includes(interaction.user.id);

  const collector = message.createMessageComponentCollector({ 
    filter, 
    time: timeout,
    idle: 60000 // We expire after 1 minute of inactivity to clean up resources.
  });
  
  collector.on('collect', async i => {
    const buttonType = i.customId.split('_')[1];
    
    logger.debug("Navigation button pressed.", {
      buttonType,
      currentIndex,
      userId: i.user.id
    });
    
    // We update the current index based on which button was pressed.
    if (buttonType === 'prev') {
      currentIndex = Math.max(0, currentIndex - 1);
    } else if (buttonType === 'next') {
      currentIndex = Math.min(items.length - 1, currentIndex + 1);
    }

    // We update the message with the new embed and buttons for the new index.
    await i.update({ 
      embeds: [generateEmbed(currentIndex)],
      components: [createArrowButtons(currentIndex)]
    });
  });

  // We disable buttons after the collector expires to prevent further interaction.
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
    
    // We maintain the same appearance for disabled buttons to avoid confusion.
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
    
    // We update the message with disabled buttons to indicate timeout.
    await interaction.editReply({
      components: [disabledNavRow]
    }).catch(err => logger.error("Failed to update timed out message.", { error: err.message }));
  });
}

/**
 * Validates and normalizes search parameters.
 * This function ensures the query is valid and the results count is within acceptable bounds.
 * 
 * @param {string} query - The search query.
 * @param {number} resultsCount - The requested number of results.
 * @param {number} defaultCount - Default number of results.
 * @param {number} minResults - Minimum allowed results.
 * @param {number} maxResults - Maximum allowed results.
 * @returns {Object} Normalized query and results count.
 */
function normalizeSearchParams(query, resultsCount, defaultCount, minResults, maxResults) {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: "Empty query" };
  }

  // We trim the query and enforce limits on the results count.
  const normalizedQuery = query.trim();
  const normalizedCount = Math.max(minResults, Math.min(resultsCount || defaultCount, maxResults));
  
  return {
    valid: true,
    query: normalizedQuery,
    count: normalizedCount
  };
}

/**
 * Formats an error message from the Google API response.
 * This function extracts relevant information to provide a clear error message to users.
 * 
 * @param {Error} apiError - The API error.
 * @returns {string} Formatted error message.
 */
function formatApiError(apiError) {
  const statusCode = apiError.response?.status || "unknown";
  const errorMessage = apiError.response?.data?.error?.message || apiError.message;
  return `⚠️ Google API error (${statusCode}): ${errorMessage}`;
}

/**
 * We perform a search across multiple data sources.
 * This function handles the coordination and aggregation of search results.
 *
 * We validate the search query and ensure it meets minimum length requirements.
 * We search across different data sources in parallel and combine the results.
 * We limit the total number of results to prevent overwhelming responses.
 *
 * @param {string} query - The search query string
 * @param {Object} options - Search options including data sources to search
 * @returns {Promise<Array>} Array of search results
 * @throws {Error} If the search query is invalid or search fails
 */
async function performSearch(query, options = {}) {
  try {
    // We validate the search query.
    if (!query || query.length < MIN_SEARCH_LENGTH) {
      throw new Error(`Search query must be at least ${MIN_SEARCH_LENGTH} characters long.`);
    }

    // We prepare the search options with defaults.
    const searchOptions = {
      includeUsers: true,
      includeChannels: true,
      includeMessages: true,
      ...options
    };

    // We perform parallel searches across different data sources.
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

    // We wait for all searches to complete with a timeout.
    const results = await Promise.race([
      Promise.all(searchPromises),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Search timed out')), SEARCH_TIMEOUT_MS)
      )
    ]);

    // We combine and sort the results.
    const combinedResults = results.flat().sort((a, b) => b.relevance - a.relevance);
    return combinedResults.slice(0, MAX_SEARCH_RESULTS);
  } catch (error) {
    logger.error(`Error performing search for query "${query}": ${error.message}`);
    throw error;
  }
}

/**
 * We search for users matching the query.
 * This function handles user-specific search logic.
 *
 * We search through user names, nicknames, and other relevant fields.
 * We calculate relevance scores based on match quality.
 *
 * @param {string} query - The search query string
 * @returns {Promise<Array>} Array of matching user results
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
 * We search for channels matching the query.
 * This function handles channel-specific search logic.
 *
 * We search through channel names and topics.
 * We calculate relevance scores based on match quality.
 *
 * @param {string} query - The search query string
 * @returns {Promise<Array>} Array of matching channel results
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
 * We search for messages matching the query.
 * This function handles message-specific search logic.
 *
 * We search through message content and attachments.
 * We calculate relevance scores based on match quality.
 *
 * @param {string} query - The search query string
 * @returns {Promise<Array>} Array of matching message results
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
 * We calculate the relevance score for a search result.
 * This function determines how well a result matches the search query.
 *
 * We use a combination of exact matches, partial matches, and position weighting.
 * We normalize the score to a value between 0 and 1.
 *
 * @param {string} text - The text to calculate relevance for
 * @param {string} query - The search query
 * @returns {number} Relevance score between 0 and 1
 */
function calculateRelevance(text, query) {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  
  // We check for exact matches first.
  if (normalizedText === normalizedQuery) {
    return 1.0;
  }
  
  // We check for partial matches.
  if (normalizedText.includes(normalizedQuery)) {
    const position = normalizedText.indexOf(normalizedQuery);
    const positionWeight = 1 - (position / normalizedText.length);
    return 0.5 + (positionWeight * 0.5);
  }
  
  // We check for word matches.
  const textWords = normalizedText.split(/\s+/);
  const queryWords = normalizedQuery.split(/\s+/);
  const matchingWords = queryWords.filter(word => 
    textWords.some(textWord => textWord.includes(word))
  );
  
  return matchingWords.length / queryWords.length;
}

/**
 * We export the search utility functions for use throughout the application.
 * This module provides consistent search capabilities across different data types.
 */
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