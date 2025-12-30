const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for fetching country information using the REST Countries API.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('country')
    .setDescription('Get information about a country.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Enter the country name (e.g., France, Japan, Brazil)')
        .setRequired(true)
    ),

  /**
   * Executes the country command.
   * @param {CommandInteraction} interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const name = interaction.options.getString('name');
      logger.info('/country command initiated:', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        name
      });
      const response = await axios.get(`https://restcountries.com/v3.1/name/${encodeURIComponent(name)}`, {
        params: { fullText: false },
        timeout: 10000
      });
      if (!Array.isArray(response.data) || response.data.length === 0) {
        await interaction.editReply({
          content: '⚠️ No country found with that name.',
          flags: MessageFlags.Ephemeral
        });
        logger.warn('/country no results:', { name });
        return;
      }
      const country = response.data[0];
      const flag = country.flags && (country.flags.png || country.flags.svg || country.flags[0]);
      const capital = Array.isArray(country.capital) ? country.capital.join(', ') : (country.capital || 'N/A');
      const population = country.population ? country.population.toLocaleString() : 'N/A';
      const region = country.region || 'N/A';
      const subregion = country.subregion || 'N/A';
      const area = country.area ? `${country.area.toLocaleString()} km²` : 'N/A';
      const currencies = country.currencies ? Object.values(country.currencies).map(c => `${c.name} (${c.symbol || ''})`).join(', ') : 'N/A';
      let mapsUrl = '';
      if (country.latlng && country.latlng.length === 2) {
        mapsUrl = `https://www.google.com/maps/search/?api=1&query=${country.latlng[0]},${country.latlng[1]}`;
      } else {
        mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(country.name.common)}`;
      }
      const embed = new EmbedBuilder()
        .setColor(0x24f2dc)
        .setTitle(`${country.name.common} ${country.flag || ''}`)
        .setDescription(country.name.official || country.name.common)
        .addFields(
          { name: '🌍 Region', value: `${region} (${subregion})`, inline: true },
          { name: '🏙️ Capital', value: capital, inline: true },
          { name: '👥 Population', value: population, inline: true },
          { name: '💵 Currencies', value: currencies, inline: true },
          { name: '🗺️ Area', value: area, inline: true },
          { name: '📍 Google Maps', value: `[View on Google Maps](${mapsUrl})`, inline: false }
        )
        .setFooter({ text: 'Powered by restcountries.com' });
      if (flag) {
        embed.setThumbnail(flag);
      }
      await interaction.editReply({ embeds: [embed] });
      logger.info('/country command completed:', { name: country.name.common, userId: interaction.user.id });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * @param {CommandInteraction} interaction
   * @param {Error} error
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error('Error in country command:', {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    let errorMessage = '⚠️ An unexpected error occurred while searching for the country.';
    if (error.response && error.response.status === 404) {
      errorMessage = '⚠️ No country found with that name.';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = '⚠️ Request timed out. Please try again later.';
    } else if (error.message && error.message.includes('Network')) {
      errorMessage = '⚠️ Network error occurred. Please check your internet connection.';
    }
    try {
      await interaction.editReply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral
      });
    } catch (followUpError) {
      logger.error('Failed to send error response for country command:', {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      await interaction.reply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}; 