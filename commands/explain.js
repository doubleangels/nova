const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/**
 * Command module for explaining server topics (media, permissions, etc.).
 * Public command visible to all members.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('explain')
    .setDescription('Get explanations for server topics.')
    .setDefaultMemberPermissions(null)
    .addSubcommand(subcommand =>
      subcommand
        .setName('media')
        .setDescription('Explain why file uploads and GIFs are locked until you have a role and color.')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('What user do you want to explain this to?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('colors')
        .setDescription('Explain what colors are and how to pick one.')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('What user do you want to explain this to?')
            .setRequired(true)
        )
    ),

  /**
   * Executes the explain command.
   * Dispatches to the appropriate handler based on the selected subcommand.
   *
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();

      const subcommand = interaction.options.getSubcommand();

      logger.info('/explain command initiated.', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand
      });

      if (subcommand === 'media') {
        await this.handleMedia(interaction);
      } else if (subcommand === 'colors') {
        await this.handleColors(interaction);
      } else {
        await interaction.editReply({
          content: '⚠️ Unknown subcommand.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles the media subcommand (file uploads and GIFs locked until role).
   * @param {CommandInteraction} interaction - The interaction
   * @returns {Promise<void>}
   */
  async handleMedia(interaction) {
    const user = interaction.options.getUser('user');

    const embed = new EmbedBuilder()
      .setColor(config.baseEmbedColor)
      .setTitle('File uploads and GIFs')
      .setDescription(
        'Until you receive your role and official color, file uploads and GIFs are temporarily locked. This isn\'t a punishment — it\'s how we keep the server healthy and welcoming. We want an active community where people actually talk, introduce themselves, and participate, not a quiet space filled with casual posters. Requiring a role and color helps encourage real engagement and protects the server from spam, bots, and low-effort chaos.\n\n' +
        'Roles and colors are assigned by moderators when the time feels right. There isn\'t a timer, a message quota, or a shortcut to unlock it. Mods look for genuine participation — conversation, personality, presence. When you\'ve made yourself known, you\'ll be offered a color, assigned a custom role, and the restrictions will lift.\n\n' +
        'Please don\'t beg for permissions or ask for a color early — it won\'t speed things up. Just jump in, be yourself, and let it happen naturally. When the mods decide you\'re ready, the door opens.'
      );

    await interaction.editReply({
      content: `<@${user.id}>`,
      embeds: [embed]
    });

    logger.info('/explain media completed.', {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
  },

  /**
   * Handles the colors subcommand (picking a color).
   * @param {CommandInteraction} interaction - The interaction
   * @returns {Promise<void>}
   */
  async handleColors(interaction) {
    const user = interaction.options.getUser('user');

    const embed = new EmbedBuilder()
      .setColor(config.baseEmbedColor)
      .setTitle('Picking a color!')
      .setDescription(
        'You\'re seeing this because you\'ve been offered a color. That isn\'t random - it means you\'ve been accepted as one of us. A color here isn\'t just decoration; it\'s recognition. Along with it, you\'ll receive a custom role chosen by us. You don\'t pick the role - we do. The only thing you control is your color.\n\n' +
        'To choose one, go to https://htmlcolorcodes.com and find a shade that feels right. Copy the full hex code exactly as shown - it starts with # and has six letters or numbers (for example, #FF5733).\n\n' +
        'When you\'re ready, ping the moderator who offered you the color and include your hex code. Once it\'s applied, your role will be revealed and your place among us will be official. Choose wisely.'
      )
      .addFields(
        {
          name: 'Exemptions',
          value: '• Your color can’t be too similar to someone else’s\n• You can’t keep the default blue you currently have'
        },
        {
          name: 'Unlocked Channels',
          value: '#black-hole and #selfies-on-the-throne are now open to you.'
        }
      );

    await interaction.editReply({
      content: `<@${user.id}>`,
      embeds: [embed]
    });

    logger.info('/explain colors completed.', {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
  },

  /**
   * Handles errors during command execution.
   * @param {CommandInteraction} interaction - The interaction
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error('Error occurred in explain command.', {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });

    const errorMessage = '⚠️ An unexpected error occurred. Please try again later.';

    try {
      await interaction.editReply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral
      });
    } catch (followUpError) {
      logger.error('Failed to send error response for explain command.', {
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
