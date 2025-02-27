const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const logger = require('../logger');

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
  async execute(interaction) {
    try {
      logger.debug(`/urban command invoked by ${interaction.user.tag} for query: '${interaction.options.getString('query')}'`);
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      const searchUrl = "https://api.urbandictionary.com/v0/define";
      const params = new URLSearchParams({ term: query });
      
      const url = `${searchUrl}?${params.toString()}`;
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        if (data.list && data.list.length > 0) {
          const topResult = data.list[0];
          const word = topResult.word || "No Word";
          const definition = (topResult.definition || "No Definition Available.").replace(/\r\n/g, "\n");
          const example = (topResult.example || "").replace(/\r\n/g, "\n") || "No example available.";
          const thumbsUp = topResult.thumbs_up || 0;
          const thumbsDown = topResult.thumbs_down || 0;
          
          logger.debug(`Found definition for '${word}': ${definition} (${thumbsUp}/${thumbsDown})`);
          
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
          
          await interaction.editReply({ embeds: [embed] });
        } else {
          logger.debug(`No definitions found for '${query}'`);
          await interaction.editReply("⚠️ No definitions found for your query. Try refining it.");
        }
      } else {
        logger.warn(`Urban Dictionary API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: Urban Dictionary API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error(`Error in /urban command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
