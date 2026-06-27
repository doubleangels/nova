const path = require('path');
const { serializeError } = require('../utils/logSanitize.js');
const { captureError } = require('../instrument');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { MessageFlags, Events } = require('discord.js');
const { handleSpamWarningButton } = require('../utils/spamModeUtils');
const {
  handleWorldCupPredictButton,
  handleWorldCupPickSelect,
  isWorldCupPickSelect,
  BUTTON_PREFIX: WORLDCUP_BUTTON_PREFIX
} = require('../utils/worldCupInteractions');
const {
  handleFootballPredictButton,
  handleFootballPickSelect,
  isFootballPickSelect,
  BUTTON_PREFIX: FOOTBALL_BUTTON_PREFIX
} = require('../utils/footballInteractions');
const footballCommand = require('../commands/football');
const worldCupCommand = require('../commands/worldCup');

module.exports = {
  name: Events.InteractionCreate,

  /**
   * Handles the event when a new interaction is created.
   * This function:
   * 1. Processes chat input commands
   * 2. Handles command execution with error handling
   * 3. Manages cooldowns and permissions
   * 
   * @param {Interaction} interaction - The interaction that was created
   * @throws {Error} If there's an error processing the interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('spamWarn:')) {
      await handleSpamWarningButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(WORLDCUP_BUTTON_PREFIX)) {
      try {
        await handleWorldCupPredictButton(interaction);
      } catch (error) {
        captureError(error, { handler: 'worldcupButton' });
        logger.error('Error handling World Cup predict button.', { ...serializeError(error, { includeStack: true }) });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Something went wrong opening the prediction form.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(FOOTBALL_BUTTON_PREFIX)) {
      try {
        await handleFootballPredictButton(interaction);
      } catch (error) {
        captureError(error, { handler: 'footballButton' });
        logger.error('Error handling Football predict button.', { ...serializeError(error, { includeStack: true }) });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Something went wrong opening the prediction form.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (
      typeof interaction.isStringSelectMenu === 'function' &&
      interaction.isStringSelectMenu() &&
      isWorldCupPickSelect(interaction.customId)
    ) {
      try {
        await handleWorldCupPickSelect(interaction);
      } catch (error) {
        captureError(error, { handler: 'worldcupPickSelect' });
        logger.error('Error handling World Cup prediction select.', { ...serializeError(error, { includeStack: true }) });
        if (interaction.deferred) {
          await interaction.editReply({
            content: '⚠️ Something went wrong saving your prediction.',
            components: []
          }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({
            content: '⚠️ Something went wrong saving your prediction.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (
      typeof interaction.isStringSelectMenu === 'function' &&
      interaction.isStringSelectMenu() &&
      isFootballPickSelect(interaction.customId)
    ) {
      try {
        await handleFootballPickSelect(interaction);
      } catch (error) {
        captureError(error, { handler: 'footballPickSelect' });
        logger.error('Error handling Football prediction select.', { ...serializeError(error, { includeStack: true }) });
        if (interaction.deferred) {
          await interaction.editReply({
            content: '⚠️ Something went wrong saving your prediction.',
            components: []
          }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({
            content: '⚠️ Something went wrong saving your prediction.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (
      typeof interaction.isStringSelectMenu === 'function' &&
      interaction.isStringSelectMenu() &&
      interaction.customId === 'worldcup:prompt:select'
    ) {
      try {
        await worldCupCommand.handlePromptSelect(interaction);
      } catch (error) {
        captureError(error, { handler: 'worldcupPromptSelect' });
        logger.error('Error handling World Cup prompt select.', { ...serializeError(error, { includeStack: true }) });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Something went wrong posting the match prompt.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (
      typeof interaction.isStringSelectMenu === 'function' &&
      interaction.isStringSelectMenu() &&
      interaction.customId === 'football:prompt:select'
    ) {
      try {
        await footballCommand.handlePromptSelect(interaction);
      } catch (error) {
        captureError(error, { handler: 'footballPromptSelect' });
        logger.error('Error handling Football prompt select.', { ...serializeError(error, { includeStack: true }) });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Something went wrong posting the match prompt.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (
      typeof interaction.isStringSelectMenu === 'function' &&
      interaction.isStringSelectMenu() &&
      interaction.customId === 'worldcup:repostscore:select'
    ) {
      try {
        await worldCupCommand.handleRepostScoreSelect(interaction);
      } catch (error) {
        captureError(error, { handler: 'worldcupRepostScoreSelect' });
        logger.error('Error handling World Cup repost score select.', { ...serializeError(error, { includeStack: true }) });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Something went wrong posting the final score announcement.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    if (
      typeof interaction.isStringSelectMenu === 'function' &&
      interaction.isStringSelectMenu() &&
      interaction.customId === 'football:repostscore:select'
    ) {
      try {
        await footballCommand.handleRepostScoreSelect(interaction);
      } catch (error) {
        captureError(error, { handler: 'footballRepostScoreSelect' });
        logger.error('Error handling Football repost score select.', { ...serializeError(error, { includeStack: true }) });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Something went wrong posting the final score announcement.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      }
      return;
    }

    // Handle autocomplete interactions
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn('No command matching the requested command name was found for autocomplete.', {
          commandName: interaction.commandName
        });
        return;
      }

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        captureError(error, { handler: 'autocomplete', command: interaction.commandName });
        logger.error('Error occurred while handling autocomplete request.', { ...serializeError(error, { includeStack: true }),
          commandName: interaction.commandName
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand() && !interaction.isUserContextMenuCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      if (config.settings.disabledCommands.includes(interaction.commandName)) {
        await interaction.reply({
          content: '⚠️ This command is currently disabled.',
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }
      logger.warn('No command matching the requested command name was found.', {
        commandName: interaction.commandName
      });
      return;
    }

    const startedAt = Date.now();
    logger.debug('Executing command.', {
      command: interaction.commandName,
      user: interaction.user.tag,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      interactionId: interaction.id
    });

    try {
      await command.execute(interaction);
      logger.debug('Command executed successfully.', {
        command: interaction.commandName,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        interactionId: interaction.id,
        durationMs: Date.now() - startedAt,
        outcome: 'success'
      });
    } catch (error) {
      captureError(error, { handler: 'command', command: interaction.commandName });
      logger.error('Error occurred while executing command.', {
        command: interaction.commandName,
        user: interaction.user.tag,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        interactionId: interaction.id,
        durationMs: Date.now() - startedAt,
        outcome: 'error',
        ...serializeError(error, { includeStack: true })
      });

      // Only send generic error if the command hasn't already replied (e.g. with its own error message)
      if (interaction.replied) return;

      try {
        if (interaction.deferred) {
          await interaction.followUp({
            content: 'There was an error executing this command!',
            flags: MessageFlags.Ephemeral
          });
        } else {
          await interaction.reply({
            content: 'There was an error executing this command!',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        logger.error('Error occurred while sending error response.', {
          command: interaction.commandName,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          ...serializeError(replyError, { includeStack: true }),
          originalErrorMessage: error.message
        });
      }
    }
  }
};

