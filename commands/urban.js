const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// These are the configuration constants for the Urban Dictionary integration.
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
      // We check if the channel is NSFW before proceeding due to potential adult content.
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
      
      // We get the query term from the interaction options provided by the user.
      const query = interaction.options.getString('query');
      
      logger.info("Urban Dictionary search initiated.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query: query,
        channelId: interaction.channelId,
        guildId: interaction.guildId
      });
        
      // We defer the reply to allow time for the API call to complete.
      await interaction.deferReply();
      
      // We fetch definitions from Urban Dictionary API based on the query.
      const definitions = await this.fetchDefinitions(query);
      
      if (definitions.length === 0) {
        logger.info("No Urban Dictionary definitions found for query.", {
          userId: interaction.user.id,
          query: query
        });
      
        return await interaction.editReply({ 
          content: '⚠️ No definitions found for your query. Try refining it.',
          ephemeral: true
        });
      }
      
      // We send the first definition with navigation buttons if there are multiple definitions.
      await this.sendDefinitionEmbed(interaction, definitions, 0);
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Checks if the channel is marked as NSFW for content safety.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {boolean} True if the channel is NSFW or a DM, false otherwise.
   */
  isNsfwChannel(interaction) {
    // We consider DMs as "safe" for this purpose since they're private.
    if (!interaction.guild) return true;
    
    // For guild channels, we check the nsfw flag to ensure appropriate content sharing.
    return interaction.channel?.nsfw === true;
  },
  
  /**
   * Fetches definitions from the Urban Dictionary API.
   * 
   * @param {string} query - The term to search for.
   * @returns {Promise<Array>} Array of definition objects.
   */
  async fetchDefinitions(query) {
    // We construct the Urban Dictionary API URL with query parameters.
    const params = new URLSearchParams({ term: query });
    const requestUrl = `${URBAN_DICTIONARY_API_URL}?${params.toString()}`;
    
    logger.debug("Fetching data from Urban Dictionary API.", {
      query: query,
      requestUrl: requestUrl
    });
    
    try {
      // We fetch the definition data using axios with a timeout for safety.
      const response = await axios.get(requestUrl, { 
        timeout: 5000 // We add a timeout to prevent hanging requests.
      });
      
      // We process the successful API response and extract the definitions.
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
    
    // We create the Urban Dictionary URL for this term for direct linking.
    const urbanUrl = new URL(URBAN_DICTIONARY_WEB_URL);
    urbanUrl.searchParams.append('term', word);
    
    // We build an embed with the retrieved definition and formatting.
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
    
    // We only add navigation buttons if there are multiple definitions to browse.
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
    
    // We edit the deferred reply with the embed and buttons.
    await interaction.editReply({ 
      embeds: [embed],
      components: components
    });
    
    // We set up a collector for button interactions if there are multiple definitions.
    if (definitions.length > 1) {
      const filter = i => i.user.id === interaction.user.id && 
                         (i.customId.startsWith('urban_prev_') || i.customId.startsWith('urban_next_'));
      
      const collector = interaction.channel.createMessageComponentCollector({ 
        filter, 
        time: 60000 // We set a 1 minute timeout for button interactions.
      });
      
      collector.on('collect', async i => {
        // We calculate the new index based on which button was clicked.
        let newIndex = index;
        
        if (i.customId.startsWith('urban_next_') && index < definitions.length - 1) {
          newIndex = index + 1;
        } else if (i.customId.startsWith('urban_prev_') && index > 0) {
          newIndex = index - 1;
        }
        
        // We update the message with the new definition.
        await i.deferUpdate();
        await this.sendDefinitionEmbed(interaction, definitions, newIndex);
        
        // We stop the old collector to prevent overlapping collectors.
        collector.stop();
      });
      
      collector.on('end', collected => {
        // If the collector ends due to timeout, we remove the buttons for cleanliness.
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
    
    // We replace newlines and carriage returns for proper formatting in Discord embeds.
    return text.replace(/\r\n/g, '\n')
      // We truncate if extremely long to comply with Discord's 1024 character limit for embed fields.
      .substring(0, 1000) 
      // We add ellipsis if the text was truncated to indicate there's more content.
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
    
    // We determine if interaction has already been deferred for proper response.
    try {
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: errorMessage,
          ephemeral: true
        });
      } else {
        await interaction.reply({ 
          content: errorMessage,
          ephemeral: true
        });
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
