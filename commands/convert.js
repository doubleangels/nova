const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for converting between units of measurement and currencies.
 * Supports currency (via exchangerate.host), length, mass, and temperature conversions.
 * @type {Object}
 */

// Supported units for basic conversion
const LENGTH_UNITS = {
  m: 1,
  meter: 1,
  meters: 1,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  km: 1000,
  kilometer: 1000,
  kilometers: 1000,
  mi: 1609.34,
  mile: 1609.34,
  miles: 1609.34,
  cm: 0.01,
  centimeter: 0.01,
  centimeters: 0.01,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254
};
const MASS_UNITS = {
  kg: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  gram: 0.001,
  grams: 0.001,
  lb: 0.453592,
  pound: 0.453592,
  pounds: 0.453592,
  oz: 0.0283495,
  ounce: 0.0283495,
  ounces: 0.0283495
};
const TEMP_UNITS = ['c', 'celsius', 'f', 'fahrenheit', 'k', 'kelvin'];

function convertLength(value, from, to) {
  const fromFactor = LENGTH_UNITS[from.toLowerCase()];
  const toFactor = LENGTH_UNITS[to.toLowerCase()];
  if (!fromFactor || !toFactor) return null;
  return value * (fromFactor / toFactor);
}
function convertMass(value, from, to) {
  const fromFactor = MASS_UNITS[from.toLowerCase()];
  const toFactor = MASS_UNITS[to.toLowerCase()];
  if (!fromFactor || !toFactor) return null;
  return value * (fromFactor / toFactor);
}
function convertTemp(value, from, to) {
  from = from.toLowerCase();
  to = to.toLowerCase();
  if (from === to) return value;
  // Convert from -> C
  let celsius;
  if (from === 'c' || from === 'celsius') celsius = value;
  else if (from === 'f' || from === 'fahrenheit') celsius = (value - 32) * 5/9;
  else if (from === 'k' || from === 'kelvin') celsius = value - 273.15;
  else return null;
  // Convert C -> to
  if (to === 'c' || to === 'celsius') return celsius;
  if (to === 'f' || to === 'fahrenheit') return celsius * 9/5 + 32;
  if (to === 'k' || to === 'kelvin') return celsius + 273.15;
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('convert')
    .setDescription('Convert between units of measurement or currencies.')
    .addNumberOption(option =>
      option.setName('amount')
        .setDescription('What is the amount or quantity you want to convert?')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('from')
        .setDescription('What is the unit or currency you want to convert from? (e.g., USD, m, kg, C)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('to')
        .setDescription('What is the unit or currency you want to convert to? (e.g., EUR, ft, lb, F)')
        .setRequired(true)),

  /**
   * Executes the convert command.
   * This function:
   * 1. Determines conversion type (currency, length, mass, temperature)
   * 2. Performs the conversion
   * 3. Creates and sends an embed with the result
   * 4. Handles errors and unsupported conversions
   *
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const amount = interaction.options.getNumber('amount');
      const from = interaction.options.getString('from');
      const to = interaction.options.getString('to');
      logger.info('/convert command initiated:', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        amount, from, to
      });

      // Try currency conversion first (ISO 4217 codes are 3 letters)
      if (from.length === 3 && to.length === 3) {
        const url = `https://api.exchangerate.host/convert?from=${from.toUpperCase()}&to=${to.toUpperCase()}&amount=${amount}`;
        const response = await axios.get(url, { timeout: 10000 });
        if (response.data && response.data.result != null) {
          const embed = this.createCurrencyEmbed(amount, from, to, response.data.result);
          await interaction.editReply({ embeds: [embed] });
          logger.info('/convert currency completed:', { amount, from, to, result: response.data.result });
          return;
        } else {
          throw new Error('Currency conversion failed.');
        }
      }

      // Try length
      if (LENGTH_UNITS[from.toLowerCase()] && LENGTH_UNITS[to.toLowerCase()]) {
        const result = convertLength(amount, from, to);
        if (result == null) throw new Error('Unit conversion failed.');
        const embed = this.createLengthEmbed(amount, from, to, result);
        await interaction.editReply({ embeds: [embed] });
        logger.info('/convert length completed:', { amount, from, to, result });
        return;
      }
      // Try mass
      if (MASS_UNITS[from.toLowerCase()] && MASS_UNITS[to.toLowerCase()]) {
        const result = convertMass(amount, from, to);
        if (result == null) throw new Error('Unit conversion failed.');
        const embed = this.createMassEmbed(amount, from, to, result);
        await interaction.editReply({ embeds: [embed] });
        logger.info('/convert mass completed:', { amount, from, to, result });
        return;
      }
      // Try temperature
      if (TEMP_UNITS.includes(from.toLowerCase()) && TEMP_UNITS.includes(to.toLowerCase())) {
        const result = convertTemp(amount, from, to);
        if (result == null) throw new Error('Temperature conversion failed.');
        const embed = this.createTempEmbed(amount, from, to, result);
        await interaction.editReply({ embeds: [embed] });
        logger.info('/convert temperature completed:', { amount, from, to, result });
        return;
      }

      // If none matched
      logger.warn('/convert unsupported:', { amount, from, to });
      await interaction.editReply({
        content: '⚠️ Unsupported conversion. Please use valid units or currency codes.',
        ephemeral: true
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Creates an embed for currency conversion results.
   */
  createCurrencyEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0x4CAF50)
      .setTitle('💱 Currency Conversion')
      .setDescription(`**${amount} ${from.toUpperCase()} = ${result} ${to.toUpperCase()}**`)
      .setFooter({ text: 'Powered by exchangerate.host' });
  },

  /**
   * Creates an embed for length conversion results.
   */
  createLengthEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0x2196F3)
      .setTitle('📏 Length Conversion')
      .setDescription(`**${amount} ${from} = ${result} ${to}**`)
      .setFooter({ text: 'Basic unit conversion (in-code)' });
  },

  /**
   * Creates an embed for mass conversion results.
   */
  createMassEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0xFF9800)
      .setTitle('⚖️ Mass Conversion')
      .setDescription(`**${amount} ${from} = ${result} ${to}**`)
      .setFooter({ text: 'Basic unit conversion (in-code)' });
  },

  /**
   * Creates an embed for temperature conversion results.
   */
  createTempEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle('🌡️ Temperature Conversion')
      .setDescription(`**${amount}°${from[0].toUpperCase()} = ${result}°${to[0].toUpperCase()}**`)
      .setFooter({ text: 'Basic unit conversion (in-code)' });
  },

  /**
   * Handles errors that occur during command execution.
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error('Error in convert command:', {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    let errorMessage = '⚠️ An unexpected error occurred while converting.';
    if (error.response && error.response.status === 400) {
      errorMessage = '⚠️ Invalid conversion request.';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = '⚠️ Request timed out. Please try again later.';
    } else if (error.message && error.message.includes('Network')) {
      errorMessage = '⚠️ Network error occurred. Please check your internet connection.';
    }
    try {
      await interaction.editReply({
        content: errorMessage,
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error('Failed to send error response for convert command:', {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      await interaction.reply({
        content: errorMessage,
        ephemeral: true
      }).catch(() => {});
    }
  }
}; 