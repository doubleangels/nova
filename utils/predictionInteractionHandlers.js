const path = require('path');
const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const msgs = require('./predictionMessages');
const { alignResultPickWithScore } = require('./predictionGameScoring');
const {
  isPendingPredictionComplete,
  isFixtureOpenForPrediction,
  truncateModalLabel,
  formatResultPickDisplay
} = require('./predictionGameUi');

/**
 * @param {{
 *   gameId: 'worldcup'|'club',
 *   pickPrefix: string,
 *   buttonPrefix: string,
 *   logLabel: string,
 *   isApiConfigured: () => boolean,
 *   getFixtureById: (id: number) => Promise<object|null>,
 *   store: import('./predictionGameStore').PredictionStore & { isPendingPredictionComplete: (p: object|null) => boolean },
 *   formatFixtureTeam: (fixture: object, side: 'home'|'away') => string,
 *   mockPlayableIds: number[],
 *   scoreFinishedFixtures: (client?: import('discord.js').Client) => Promise<number>
 * }} options
 */
function createPredictionInteractionHandlers(options) {
  const { store } = options;

  function isPickSelect(customId) {
    return Boolean(customId?.startsWith(options.pickPrefix));
  }

  function parsePickCustomId(customId) {
    const rest = customId.slice(options.pickPrefix.length);
    const [side, fixtureIdStr] = rest.split(':');
    const fixtureId = parseInt(fixtureIdStr, 10);
    if (!Number.isFinite(fixtureId)) return null;
    if (side === 'home' || side === 'away' || side === 'winner') {
      return { side, fixtureId };
    }
    return null;
  }

  function buildGoalSelectOptions() {
    return Array.from({ length: 16 }, (_, goals) => ({
      label: String(goals),
      value: String(goals)
    }));
  }

  function buildPredictionSelectRows(fixture, fixtureId, pending = null) {
    const homeGoals = pending?.homeScore;
    const awayGoals = pending?.awayScore;

    const homeRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${options.pickPrefix}home:${fixtureId}`)
        .setPlaceholder(
          homeGoals != null
            ? `${truncateModalLabel(options.formatFixtureTeam(fixture, 'home'), 80)} goals: ${homeGoals}`
            : `${truncateModalLabel(options.formatFixtureTeam(fixture, 'home'), 80)} goals`
        )
        .addOptions(buildGoalSelectOptions())
    );

    const awayRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${options.pickPrefix}away:${fixtureId}`)
        .setPlaceholder(
          awayGoals != null
            ? `${truncateModalLabel(options.formatFixtureTeam(fixture, 'away'), 80)} goals: ${awayGoals}`
            : `${truncateModalLabel(options.formatFixtureTeam(fixture, 'away'), 80)} goals`
        )
        .addOptions(buildGoalSelectOptions())
    );

    const winnerRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${options.pickPrefix}winner:${fixtureId}`)
        .setPlaceholder(
          pending?.resultPick
            ? msgs.winnerPlaceholderSelected(
              formatResultPickDisplay(fixture, options.formatFixtureTeam, pending.resultPick)
            )
            : msgs.WINNER_PLACEHOLDER
        )
        .addOptions(
          {
            label: truncateModalLabel(options.formatFixtureTeam(fixture, 'home'), 100),
            value: 'home'
          },
          { label: 'Draw', value: 'draw' },
          {
            label: truncateModalLabel(options.formatFixtureTeam(fixture, 'away'), 100),
            value: 'away'
          }
        )
    );

    return [homeRow, awayRow, winnerRow];
  }

  function buildPredictionFormContent(fixture, pending = null) {
    return msgs.buildPredictionFormContentWithPick(
      fixture,
      options.formatFixtureTeam,
      (f, pick) => formatResultPickDisplay(f, options.formatFixtureTeam, pick),
      pending
    );
  }

  async function handlePredictButton(interaction) {
    if (!options.isApiConfigured()) {
      await interaction.reply({
        content: msgs.errNotConfigured(options.gameId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const fixtureId = parseInt(
      interaction.customId.slice(options.buttonPrefix.length),
      10
    );
    if (!Number.isFinite(fixtureId)) {
      await interaction.reply({
        content: msgs.ERR_INVALID_MATCH,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: msgs.ERR_USE_IN_SERVER,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const registered = await store.isUserRegistered(interaction.user.id);
    const roleId = options.gameId === 'worldcup'
      ? config.worldCupParticipantRoleId
      : config.footballParticipantRoleId;
    const hasRole = roleId && interaction.member.roles?.cache?.has(roleId);
    if (!registered && !hasRole) {
      await interaction.reply({
        content: msgs.errRegisterFirst(options.gameId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const fixture = await options.getFixtureById(fixtureId);
    if (!fixture) {
      await interaction.reply({
        content: msgs.ERR_MATCH_LOAD,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!isFixtureOpenForPrediction(fixture)) {
      await interaction.reply({
        content: msgs.ERR_PREDICTIONS_CLOSED,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const existing = await store.getPrediction(interaction.user.id, fixtureId);
    if (existing) {
      await interaction.reply({
        content: msgs.ERR_ALREADY_PREDICTED,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await store.clearPendingPrediction(interaction.user.id, fixtureId);

    await interaction.reply({
      content: buildPredictionFormContent(fixture, null),
      components: buildPredictionSelectRows(fixture, fixtureId, null),
      flags: MessageFlags.Ephemeral
    });
  }

  async function handlePickSelect(interaction) {
    const parsed = parsePickCustomId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: msgs.ERR_INVALID_MATCH,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { side, fixtureId } = parsed;
    const value = interaction.values[0];

    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: msgs.ERR_USE_IN_SERVER,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Acknowledge within 3s; store/API calls may take longer.
    await interaction.deferUpdate();

    const registered = await store.isUserRegistered(interaction.user.id);
    const roleId = options.gameId === 'worldcup'
      ? config.worldCupParticipantRoleId
      : config.footballParticipantRoleId;
    const hasRole = roleId && interaction.member.roles?.cache?.has(roleId);
    if (!registered && !hasRole) {
      await interaction.editReply({
        content: msgs.errRegisterFirst(options.gameId),
        components: []
      });
      return;
    }

    const fixture = await options.getFixtureById(fixtureId);
    if (!fixture || !isFixtureOpenForPrediction(fixture)) {
      await store.clearPendingPrediction(interaction.user.id, fixtureId);
      await interaction.editReply({
        content: msgs.ERR_PREDICTIONS_CLOSED_SHORT,
        components: []
      });
      return;
    }

    const existing = await store.getPrediction(interaction.user.id, fixtureId);
    if (existing) {
      await store.clearPendingPrediction(interaction.user.id, fixtureId);
      await interaction.editReply({
        content: msgs.ERR_ALREADY_PREDICTED,
        components: []
      });
      return;
    }

    /** @type {Partial<import('./predictionGameStore').PendingPrediction>} */
    let partial = {};

    if (side === 'home' || side === 'away') {
      const goals = parseInt(value, 10);
      if (!Number.isInteger(goals) || goals < 0 || goals > 15) {
        await interaction.editReply({
          content: msgs.ERR_GOALS_RANGE,
          components: []
        });
        return;
      }
      partial = side === 'home' ? { homeScore: goals } : { awayScore: goals };
    } else { // side === 'winner'
      if (!['home', 'draw', 'away'].includes(value)) {
        await interaction.editReply({
          content: msgs.ERR_INVALID_WINNER,
          components: []
        });
        return;
      }
      partial = { resultPick: value };
    }

    const pending = await store.savePendingPrediction(
      interaction.user.id,
      fixtureId,
      partial
    );

    if (!isPendingPredictionComplete(pending)) {
      await interaction.editReply({
        content: buildPredictionFormContent(fixture, pending),
        components: buildPredictionSelectRows(fixture, fixtureId, pending)
      });
      return;
    }

    const rawResultPick = pending.resultPick;
    const resultPick = alignResultPickWithScore(
      pending.homeScore,
      pending.awayScore,
      pending.resultPick
    );

    await store.savePrediction(interaction.user.id, fixtureId, {
      homeScore: pending.homeScore,
      awayScore: pending.awayScore,
      resultPick,
      submittedAt: new Date().toISOString(),
      scored: false
    });
    await store.clearPendingPrediction(interaction.user.id, fixtureId);

    let winnerLine = `Winner: **${formatResultPickDisplay(fixture, options.formatFixtureTeam, resultPick)}**`;
    if (resultPick !== rawResultPick) {
      winnerLine += `\n${msgs.NOTE_WINNER_REALIGNED}`;
    }

    const embed = new EmbedBuilder()
      .setColor(msgs.GAME[options.gameId].embedColor)
      .setTitle(msgs.SAVED_PREDICTION_TITLE)
      .setDescription(
        `**${options.formatFixtureTeam(fixture, 'home')}** vs **${options.formatFixtureTeam(fixture, 'away')}**\n` +
        `Score: **${pending.homeScore}-${pending.awayScore}**\n` +
        winnerLine
      );

    await interaction.editReply({ embeds: [embed], content: null, components: [] });

    if (
      config.predictionMockApi &&
      interaction.client &&
      (await store.areAllMockPlayableFixturesPredicted(options.mockPlayableIds))
    ) {
      await options.scoreFinishedFixtures(interaction.client);
    }

    logger.info(`${options.logLabel} prediction saved.`, {
      userId: interaction.user.id,
      fixtureId,
      homeScore: pending.homeScore,
      awayScore: pending.awayScore,
      resultPick
    });
  }

  return {
    isPickSelect,
    parsePickCustomId,
    buildPredictionSelectRows,
    buildPredictionFormContent,
    handlePredictButton,
    handlePickSelect
  };
}

module.exports = {
  createPredictionInteractionHandlers
};
