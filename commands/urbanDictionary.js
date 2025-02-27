const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;

/**
 * Module for the /urban command.
 * Searches Urban Dictionary for definitions of a provided query term.
 */
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
   * Executes the /urban command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Log the invocation and the query term.
      const query = interaction.options.getString('query');
      logger.debug("/urban command invoked", { user: interaction.user.tag, query });
      
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      // Construct the Urban Dictionary API URL with query parameters.
      const searchUrl = "https://api.urbandictionary.com/v0/define";
      const params = new URLSearchParams({ term: query });
      const url = `${searchUrl}?${params.toString()}`;
      logger.debug("Fetching Urban Dictionary data", { requestUrl: url });
      
      // Fetch the definition data.
      const response = await fetch(url);
      
      // Check if the API response is successful.
      if (response.ok) {
        const data = await response.json();
        // Check if any definitions were returned.
        if (data.list && data.list.length > 0) {
          const topResult = data.list[0];
          const word = topResult.word || "No Word";
          // Replace any carriage returns/newlines for proper formatting.
          const definition = (topResult.definition || "No Definition Available.").replace(/\r\n/g, "\n");
          const example = (topResult.example || "No example available.").replace(/\r\n/g, "\n");
          const thumbsUp = topResult.thumbs_up || 0;
          const thumbsDown = topResult.thumbs_down || 0;
          
          logger.debug("Definition found", { word, thumbsUp, thumbsDown });
          
          // Build an embed with the retrieved definition.
          const embed = new EmbedBuilder()
            .setTitle(`📖 Definition: ${word}`)
            .setDescription(definition)
            .setColor(0x1D2439)
            .addFields(
              { name: "📝 Example", value: example, inline: false },
              { name: "👍 Thumbs Up", value: `${thumbsUp}`, inline: true },
              { name: "👎 Thumbs Down", value: `${thumbsDown}`, inline: true }
            )
            .setFooter({ text: "🔍 Powered by Urban Dictionary" });
          
          // Edit the deferred reply with the embed.
          await interaction.editReply({ embeds: [embed] });
          logger.debug("Urban definition embed sent", { user: interaction.user.tag, word });
        } else {
          // No definitions found.
          logger.debug("No definitions found", { query });
          await interaction.editReply("⚠️ No definitions found for your query. Try refining it.");
        }
      } else {
        // Log if the API response was not successful.
        logger.warn("Urban Dictionary API error", { status: response.status });
        await interaction.editReply(`⚠️ Error: Urban Dictionary API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error("Error in /urban command", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
