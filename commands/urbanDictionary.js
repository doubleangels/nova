const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;

/**
 * Module for the /urban command.
 * This command searches Urban Dictionary for definitions of a provided query term.
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
      logger.debug(`/urban command invoked by ${interaction.user.tag} for query: '${interaction.options.getString('query')}'`);
      
      // Defer the reply to allow time for API call.
      await interaction.deferReply();
      
      // Get the query term from the command options.
      const query = interaction.options.getString('query');
      // Construct the Urban Dictionary API URL with query parameters.
      const searchUrl = "https://api.urbandictionary.com/v0/define";
      const params = new URLSearchParams({ term: query });
      const url = `${searchUrl}?${params.toString()}`;
      
      // Fetch the definition data from Urban Dictionary.
      const response = await fetch(url);
      
      // Check if the API response is successful.
      if (response.ok) {
        const data = await response.json();
        // Check if any definitions were returned.
        if (data.list && data.list.length > 0) {
          const topResult = data.list[0];
          const word = topResult.word || "No Word";
          // Replace any carriage return/newline combinations with newlines for proper formatting.
          const definition = (topResult.definition || "No Definition Available.").replace(/\r\n/g, "\n");
          const example = (topResult.example || "").replace(/\r\n/g, "\n") || "No example available.";
          const thumbsUp = topResult.thumbs_up || 0;
          const thumbsDown = topResult.thumbs_down || 0;
          
          logger.debug(`Found definition for '${word}': ${definition} (${thumbsUp}/${thumbsDown})`);
          
          // Build an embed with the retrieved Urban Dictionary definition.
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
          
          // Send the embed as the reply.
          await interaction.editReply({ embeds: [embed] });
        } else {
          // No definitions found; inform the user.
          logger.debug(`No definitions found for '${query}'`);
          await interaction.editReply("⚠️ No definitions found for your query. Try refining it.");
        }
      } else {
        // API response was not OK; log and inform the user.
        logger.warn(`Urban Dictionary API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: Urban Dictionary API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log any unexpected errors and inform the user.
      logger.error(`Error in /urban command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
