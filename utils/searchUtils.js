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

module.exports = {
  createPaginatedResults,
  normalizeSearchParams,
  formatApiError
};