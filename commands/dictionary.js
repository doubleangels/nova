const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for searching word definitions using Free Dictionary API.
 * Fetches and displays definitions, phonetics, and examples.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dictionary')
    .setDescription('Fetch and display definitions from a free dictionary.')
    .addStringOption(option =>
      option.setName('word')
        .setDescription('What word do you want to look up?')
        .setRequired(true)),

  /**
   * Executes the dictionary search command.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const word = interaction.options.getString('word');
      logger.info('/dictionary command initiated:', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        word
      });

      const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
        timeout: 10000
      });
      const data = response.data[0];

      if (!data) {
        await interaction.editReply({
          content: '⚠️ No definitions found for that word.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const meanings = data.meanings && data.meanings.length > 0 ? data.meanings[0] : null;
      const definition = meanings && meanings.definitions && meanings.definitions.length > 0 ? meanings.definitions[0] : null;
      const phonetic = data.phonetic || (data.phonetics && data.phonetics[0] && data.phonetics[0].text) || '';
      const partOfSpeech = meanings ? meanings.partOfSpeech : 'Unknown';

      const embed = new EmbedBuilder()
        .setColor(0x820627)
        .setTitle(`📚 Dictionary: ${data.word}`)
        .setDescription(definition ? definition.definition : 'No definition found.')
        .addFields(
          { name: 'Phonetic', value: phonetic || 'N/A', inline: true },
          { name: 'Part of Speech', value: partOfSpeech, inline: true }
        )
        .setFooter({ text: 'Powered by Free Dictionary API' });

      await interaction.editReply({ embeds: [embed] });
      logger.info('/dictionary command completed successfully:', {
        userId: interaction.user.id,
        word
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error('Error in dictionary command', {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });

    let errorMessage = '⚠️ An unexpected error occurred while searching the dictionary.';
    if (error.response && error.response.status === 404) {
      errorMessage = '⚠️ No definitions found for your search word.';
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
      logger.error('Failed to send error response for dictionary command', {
        err: followUpError,
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