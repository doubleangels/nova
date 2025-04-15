const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants.
const URBAN_EMBED_COLOR = 0x1D2439;
const URBAN_DICTIONARY_API_URL = 'https://api.urbandictionary.com/v0/define';
const URBAN_DICTIONARY_WEB_URL = 'https://www.urbandictionary.com/define.php';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urban')
    .setDescription('Search Urban Dictionary for definitions.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What term do you want to search for?')
        .setRequired(true)
    ),
    
  /**
   * Executes the Urban Dictionary search command and returns the definition.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Check if the channel is NSFW
      if (!this.isNsfwChannel(interaction)) {
        logger.warn("Urban Dictionary command used in non-NSFW channel.", {
          userId: interaction.user.id,
          channelId: interaction.channelId,
          guildId: interaction.guildId
        });
      
        return await interaction.reply({
          content: '⚠️ This command can only be used in NSFW channels due to potential adult content.',
          ephemeral: true
        });
      }
      
      // Get the query term from the interaction options.
      const query = interaction.options.getString('query');
      
      logger.info("Urban Dictionary search initiated.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query: query,
        channelId: interaction.channelId,
        guildId: interaction.guildId
      });
        
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      // Fetch definitions from Urban Dictionary
      const definitions = await this.fetchDefinitions(query);
      
      if (definitions.length === 0) {
        logger.info("No Urban Dictionary definitions found for query.", {
          userId: interaction.user.id,
          query: query
        });
      
        return await interaction.editReply({ 
          content: '⚠️ No definitions found for your query. Try refining it.'
        });
      }
      
      // Send the first definition with navigation buttons if there are multiple
      await this.sendDefinitionEmbed(interaction, definitions, 0);
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Checks if the channel is marked as NSFW.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {boolean} True if the channel is NSFW or a DM, false otherwise.
   */
  isNsfwChannel(interaction) {
    // DMs are considered "safe" for this purpose
    if (!interaction.guild) return true;
    
    // For guild channels, check the nsfw flag
    return interaction.channel?.nsfw === true;
  },
  
  /**
   * Fetches definitions from the Urban Dictionary API.
   * 
   * @param {string} query - The term to search for.
   * @returns {Promise<Array>} Array of definition objects.
   */
  async fetchDefinitions(query) {
    // Construct the Urban Dictionary API URL with query parameters.
    const params = new URLSearchParams({ term: query });
    const requestUrl = `${URBAN_DICTIONARY_API_URL}?${params.toString()}`;
    
    logger.debug("Fetching data from Urban Dictionary API.", {
      query: query,
      requestUrl: requestUrl
    });
    
    try {
      // Fetch the definition data using axios.
      const response = await axios.get(requestUrl, { 
        timeout: 5000 // Add timeout for safety
      });
      
      // Process successful API response.
      if (response.status === 200 && response.data.list && response.data.list.length > 0) {
        return response.data.list;
      }
      
      return [];
    } catch (error) {
      logger.error("Error fetching from Urban Dictionary API.", {
        error: error.message,
        query: query
      });
      
      throw new Error("API_ERROR");
    }
  },
  
  /**
   * Sends an embed with the definition and navigation buttons.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Array} definitions - Array of definition objects.
   * @param {number} index - Index of the current definition to display.
   * @returns {Promise<void>}
   */
  async sendDefinitionEmbed(interaction, definitions, index) {
    const definition = definitions[index];
    const word = definition.word || 'No Word';
    const definitionText = this.sanitizeText(definition.definition || 'No Definition Available.');
    const example = this.sanitizeText(definition.example || 'No example available.');
    const thumbsUp = definition.thumbs_up || 0;
    const thumbsDown = definition.thumbs_down || 0;
    
    logger.debug("Preparing definition embed.", {
      word: word,
      index: index,
      totalDefinitions: definitions.length,
      thumbsUp: thumbsUp,
      thumbsDown: thumbsDown
    });
    
    // Create the Urban Dictionary URL for this term
    const urbanUrl = new URL(URBAN_DICTIONARY_WEB_URL);
    urbanUrl.searchParams.append('term', word);
    
    // Build an embed with the retrieved definition.
    const embed = new EmbedBuilder()
      .setTitle(`📖 Definition: ${word}`)
      .setDescription(definitionText)
      .setColor(URBAN_EMBED_COLOR)
      .addFields(
        { name: '📝 Example', value: example || 'No example available.', inline: false },
        { name: '👍 Thumbs Up', value: `${thumbsUp}`, inline: true },
        { name: '👎 Thumbs Down', value: `${thumbsDown}`, inline: true },
        { name: '🔢 Definition', value: `${index + 1} of ${definitions.length}`, inline: true }
      )
      .setURL(urbanUrl.toString())
      .setFooter({ text: '🔍 Powered by Urban Dictionary' });
    
    // Only add navigation buttons if there are multiple definitions
    const components = [];
    
    if (definitions.length > 1) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`urban_prev_${index}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId(`urban_next_${index}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === definitions.length - 1)
      );
      
      components.push(row);
    }
    
    // Edit the deferred reply with the embed and buttons.
    await interaction.editReply({ 
      embeds: [embed],
      components: components
    });
    
    // Set up a collector for button interactions if there are multiple definitions
    if (definitions.length > 1) {
      const filter = i => i.user.id === interaction.user.id && 
                         (i.customId.startsWith('urban_prev_') || i.customId.startsWith('urban_next_'));
      
      const collector = interaction.channel.createMessageComponentCollector({ 
        filter, 
        time: 60000 // 1 minute timeout
      });
      
      collector.on('collect', async i => {
        // Calculate the new index based on which button was clicked
        let newIndex = index;
        
        if (i.customId.startsWith('urban_next_') && index < definitions.length - 1) {
          newIndex = index + 1;
        } else if (i.customId.startsWith('urban_prev_') && index > 0) {
          newIndex = index - 1;
        }
        
        // Update the message with the new definition
        await i.deferUpdate();
        await this.sendDefinitionEmbed(interaction, definitions, newIndex);
        
        // Stop the old collector
        collector.stop();
      });
      
      collector.on('end', collected => {
        // If the collector ends due to timeout, remove the buttons
        if (collected.size === 0) {
          interaction.editReply({ 
            embeds: [embed],
            components: [] 
          }).catch(err => {
            logger.error("Failed to remove buttons after timeout", {
              error: err.message
            });
          });
        }
      });
    }
    
    logger.info("Urban Dictionary definition sent successfully.", {
      userId: interaction.user.id,
      word: word,
      index: index,
      totalDefinitions: definitions.length
    });
  },
  
  /**
   * Sanitizes text from the Urban Dictionary API for safe rendering.
   * 
   * @param {string} text - The text to sanitize.
   * @returns {string} - Sanitized text.
   */
  sanitizeText(text) {
    if (!text) return '';
    
    // Replace newlines and carriage returns for proper formatting
    return text.replace(/\r\n/g, '\n')
      // Truncate if extremely long (Discord has 1024 char limit for embed fields)
      .substring(0, 1000) 
      // Add ellipsis if truncated
      + (text.length > 1000 ? '...' : '');
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error executing Urban Dictionary command.", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user.id,
      query: interaction.options.getString('query')
    });
    
    let errorMessage = '⚠️ An unexpected error occurred. Please try again later.';
    
    if (error.message === "API_ERROR") {
      errorMessage = '⚠️ Failed to fetch data from Urban Dictionary. Please try again later.';
    }
    
    // Determine if interaction has already been deferred.
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage });
      }
    } catch (replyError) {
      logger.error("Failed to send error response for urban command.", {
        error: replyError.message,
        originalError: error.message,
        userId: interaction.user.id
      });
    }
  }
};
