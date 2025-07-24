const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

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

// Currency codes for choices (major world currencies)
const CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD',
  'MXN', 'SGD', 'HKD', 'NOK', 'KRW', 'TRY', 'INR', 'RUB', 'BRL', 'ZAR'
];

// Unit choices for measurement
const LENGTH_CHOICES = [
  { name: 'Meter (m)', value: 'm' },
  { name: 'Foot (ft)', value: 'ft' },
  { name: 'Kilometer (km)', value: 'km' },
  { name: 'Mile (mi)', value: 'mi' },
  { name: 'Centimeter (cm)', value: 'cm' },
  { name: 'Inch (in)', value: 'in' }
];
const MASS_CHOICES = [
  { name: 'Kilogram (kg)', value: 'kg' },
  { name: 'Gram (g)', value: 'g' },
  { name: 'Pound (lb)', value: 'lb' },
  { name: 'Ounce (oz)', value: 'oz' }
];
const TEMP_CHOICES = [
  { name: 'Celsius (C)', value: 'c' },
  { name: 'Fahrenheit (F)', value: 'f' },
  { name: 'Kelvin (K)', value: 'k' }
];

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
    .setDescription('Convert between currencies or units.')
    .addSubcommand(sub =>
      sub.setName('currency')
        .setDescription('Convert between currencies.')
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('What is the amount you want to convert?')
            .setRequired(true))
        .addStringOption(option => {
          let opt = option.setName('from')
            .setDescription('What is the currency you want to convert from?')
            .setRequired(true);
          CURRENCY_CODES.forEach(code => opt = opt.addChoices({ name: code, value: code }));
          return opt;
        })
        .addStringOption(option => {
          let opt = option.setName('to')
            .setDescription('What is the currency you want to convert to?')
            .setRequired(true);
          CURRENCY_CODES.forEach(code => opt = opt.addChoices({ name: code, value: code }));
          return opt;
        })
    )
    .addSubcommand(sub =>
      sub.setName('length')
        .setDescription('Convert between length units.')
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('What is the length you want to convert?')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('from')
            .setDescription('What is the unit you want to convert from?')
            .setRequired(true)
            .addChoices(
              { name: 'Meter (m)', value: 'm' },
              { name: 'Foot (ft)', value: 'ft' },
              { name: 'Kilometer (km)', value: 'km' },
              { name: 'Mile (mi)', value: 'mi' },
              { name: 'Centimeter (cm)', value: 'cm' },
              { name: 'Inch (in)', value: 'in' }
            )
        )
        .addStringOption(option =>
          option.setName('to')
            .setDescription('What is the unit you want to convert to?')
            .setRequired(true)
            .addChoices(
              { name: 'Meter (m)', value: 'm' },
              { name: 'Foot (ft)', value: 'ft' },
              { name: 'Kilometer (km)', value: 'km' },
              { name: 'Mile (mi)', value: 'mi' },
              { name: 'Centimeter (cm)', value: 'cm' },
              { name: 'Inch (in)', value: 'in' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('mass')
        .setDescription('Convert between mass units.')
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('What is the mass you want to convert?')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('from')
            .setDescription('What is the unit you want to convert from?')
            .setRequired(true)
            .addChoices(
              { name: 'Kilogram (kg)', value: 'kg' },
              { name: 'Gram (g)', value: 'g' },
              { name: 'Pound (lb)', value: 'lb' },
              { name: 'Ounce (oz)', value: 'oz' }
            )
        )
        .addStringOption(option =>
          option.setName('to')
            .setDescription('What is the unit you want to convert to?')
            .setRequired(true)
            .addChoices(
              { name: 'Kilogram (kg)', value: 'kg' },
              { name: 'Gram (g)', value: 'g' },
              { name: 'Pound (lb)', value: 'lb' },
              { name: 'Ounce (oz)', value: 'oz' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('temperature')
        .setDescription('Convert between temperature units.')
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('What is the temperature you want to convert?')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('from')
            .setDescription('What is the unit you want to convert from?')
            .setRequired(true)
            .addChoices(
              { name: 'Celsius (C)', value: 'c' },
              { name: 'Fahrenheit (F)', value: 'f' },
              { name: 'Kelvin (K)', value: 'k' }
            )
        )
        .addStringOption(option =>
          option.setName('to')
            .setDescription('What is the unit you want to convert to?')
            .setRequired(true)
            .addChoices(
              { name: 'Celsius (C)', value: 'c' },
              { name: 'Fahrenheit (F)', value: 'f' },
              { name: 'Kelvin (K)', value: 'k' }
            )
        )
    ),

  /**
   * Executes the convert command.
   * Handles currency and measurement subcommands.
   * @param {CommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const subcommand = interaction.options.getSubcommand();
      logger.info('/convert command initiated:', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand
      });

      if (subcommand === 'currency') {
        const amount = interaction.options.getNumber('amount');
        const from = interaction.options.getString('from');
        const to = interaction.options.getString('to');
        let url = `https://api.exchangerate.host/convert?from=${from}&to=${to}&amount=${amount}`;
        if (config.exchangeRateApiKey) {
          url += `&access_key=${encodeURIComponent(config.exchangeRateApiKey)}`;
        }
        const response = await axios.get(url, { timeout: 10000 });
        if (response.data && response.data.result != null) {
          const embed = this.createCurrencyEmbed(amount, from, to, response.data.result);
          await interaction.editReply({ embeds: [embed] });
          logger.info('/convert currency completed:', { amount, from, to, result: response.data.result });
          return;
        } else {
          throw new Error('Currency conversion failed.');
        }
      } else if (subcommand === 'length') {
        const amount = interaction.options.getNumber('amount');
        const from = interaction.options.getString('from');
        const to = interaction.options.getString('to');
        if (!LENGTH_UNITS[from] || !LENGTH_UNITS[to]) {
          await interaction.editReply({
            content: '⚠️ Please select valid length units.',
            ephemeral: true
          });
          logger.warn('/convert length unsupported:', { amount, from, to });
          return;
        }
        const result = Number(convertLength(amount, from, to).toFixed(2));
        const embed = this.createLengthEmbed(amount, from, to, result);
        await interaction.editReply({ embeds: [embed] });
        logger.info('/convert length completed:', { amount, from, to, result });
        return;
      } else if (subcommand === 'mass') {
        const amount = interaction.options.getNumber('amount');
        const from = interaction.options.getString('from');
        const to = interaction.options.getString('to');
        if (!MASS_UNITS[from] || !MASS_UNITS[to]) {
          await interaction.editReply({
            content: '⚠️ Please select valid mass units.',
            ephemeral: true
          });
          logger.warn('/convert mass unsupported:', { amount, from, to });
          return;
        }
        const result = Number(convertMass(amount, from, to).toFixed(2));
        const embed = this.createMassEmbed(amount, from, to, result);
        await interaction.editReply({ embeds: [embed] });
        logger.info('/convert mass completed:', { amount, from, to, result });
        return;
      } else if (subcommand === 'temperature') {
        const amount = interaction.options.getNumber('amount');
        const from = interaction.options.getString('from');
        const to = interaction.options.getString('to');
        if (!TEMP_UNITS.includes(from) || !TEMP_UNITS.includes(to)) {
          await interaction.editReply({
            content: '⚠️ Please select valid temperature units.',
            ephemeral: true
          });
          logger.warn('/convert temperature unsupported:', { amount, from, to });
          return;
        }
        const result = Number(convertTemp(amount, from, to).toFixed(2));
        const embed = this.createTempEmbed(amount, from, to, result);
        await interaction.editReply({ embeds: [embed] });
        logger.info('/convert temperature completed:', { amount, from, to, result });
        return;
      }
      // If none matched
      logger.warn('/convert unsupported subcommand:', { subcommand });
      await interaction.editReply({
        content: '⚠️ Unsupported conversion. Please use valid units or currency codes.',
        ephemeral: true
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  createCurrencyEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0xFE813A)
      .setTitle('💱 Currency Conversion')
      .setDescription(`**${amount} ${from} = ${result} ${to}**`)
      .setFooter({ text: 'Powered by exchangerate.host' });
  },
  createLengthEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0xFE813A)
      .setTitle('📏 Length Conversion')
      .setDescription(`**${amount} ${from} = ${result} ${to}**`);
  },
  createMassEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0xFE813A)
      .setTitle('⚖️ Mass Conversion')
      .setDescription(`**${amount} ${from} = ${result} ${to}**`);
  },
  createTempEmbed(amount, from, to, result) {
    return new EmbedBuilder()
      .setColor(0xFE813A)
      .setTitle('🌡️ Temperature Conversion')
      .setDescription(`**${amount}°${from[0].toUpperCase()} = ${result}°${to[0].toUpperCase()}**`);
  },
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