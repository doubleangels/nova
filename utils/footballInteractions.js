const path = require('path');
const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { isApiConfigured, getFixtureById } = require('./footballClient');
const { BUTTON_PREFIX } = require('./footballScheduler');
const {
  isUserRegistered,
  getPrediction,
  savePrediction,
  isFixtureOpenForPrediction,
  truncateModalLabel,
  formatFixtureTeam,
  formatResultPickDisplay,
  savePendingPrediction,
  getPendingPrediction,
  clearPendingPrediction,
  isPendingPredictionComplete,
  scoreFinishedFixtures,
  areAllMockPlayableFixturesPredicted
} = require('./footballUtils');
const msgs = require('./predictionMessages');

const PICK_PREFIX = 'football:pick:';

/**
 * @param {string} customId
 * @returns {boolean}
 */
function isFootballPickSelect(customId) {
  return Boolean(customId?.startsWith(PICK_PREFIX));
}

/**
 * @param {string} customId
 * @returns {{ side: 'home'|'away'|'winner', fixtureId: number }|null}
 */
function parsePickCustomId(customId) {
  const rest = customId.slice(PICK_PREFIX.length);
  const [side, fixtureIdStr] = rest.split(':');
  const fixtureId = parseInt(fixtureIdStr, 10);
  if (!Number.isFinite(fixtureId)) return null;
  if (side === 'home' || side === 'away' || side === 'winner') {
    return { side, fixtureId };
  }
  return null;
}

/**
 * @returns {import('discord.js').APISelectMenuOption[]}
 */
function buildGoalSelectOptions() {
  return Array.from({ length: 16 }, (_, goals) => ({
    label: String(goals),
    value: String(goals)
  }));
}

/**
 * @param {import('./footballUtils').NormalizedFixture} fixture
 * @param {number} fixtureId
 * @param {import('./footballUtils').PendingPrediction|null} [pending]
 * @returns {ActionRowBuilder[]}
 */
function buildPredictionSelectRows(fixture, fixtureId, pending = null) {
  const homeGoals = pending?.homeScore;
  const awayGoals = pending?.awayScore;

  const homeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PICK_PREFIX}home:${fixtureId}`)
      .setPlaceholder(
        homeGoals != null
          ? `${truncateModalLabel(formatFixtureTeam(fixture, 'home'), 80)} goals: ${homeGoals}`
          : `${truncateModalLabel(formatFixtureTeam(fixture, 'home'), 80)} goals`
      )
      .addOptions(buildGoalSelectOptions())
  );

  const awayRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PICK_PREFIX}away:${fixtureId}`)
      .setPlaceholder(
        awayGoals != null
          ? `${truncateModalLabel(formatFixtureTeam(fixture, 'away'), 80)} goals: ${awayGoals}`
          : `${truncateModalLabel(formatFixtureTeam(fixture, 'away'), 80)} goals`
      )
      .addOptions(buildGoalSelectOptions())
  );

  const winnerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PICK_PREFIX}winner:${fixtureId}`)
      .setPlaceholder(
        pending?.resultPick
          ? msgs.winnerPlaceholderSelected(
            formatResultPickDisplay(fixture, pending.resultPick)
          )
          : msgs.WINNER_PLACEHOLDER
      )
      .addOptions(
        {
          label: truncateModalLabel(formatFixtureTeam(fixture, 'home'), 100),
          value: 'home'
        },
        {
          label: 'Draw',
          value: 'draw'
        },
        {
          label: truncateModalLabel(formatFixtureTeam(fixture, 'away'), 100),
          value: 'away'
        }
      )
  );

  return [homeRow, awayRow, winnerRow];
}

/**
 * @param {import('./footballUtils').NormalizedFixture} fixture
 * @param {import('./footballUtils').PendingPrediction|null} pending
 * @returns {string}
 */
function buildPredictionFormContent(fixture, pending = null) {
  return msgs.buildPredictionFormContentWithPick(
    fixture,
    formatFixtureTeam,
    formatResultPickDisplay,
    pending
  );
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<void>}
 */
async function handleFootballPredictButton(interaction) {
  if (!isApiConfigured()) {
    await interaction.reply({
      content: msgs.errNotConfigured('club'),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixtureId = parseInt(interaction.customId.slice(BUTTON_PREFIX.length), 10);
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

  const registered = await isUserRegistered(interaction.user.id);
  const roleId = config.predictionParticipantRoleId;
  const hasRole = roleId && interaction.member.roles?.cache?.has(roleId);
  if (!registered && !hasRole) {
    await interaction.reply({
      content: msgs.ERR_REGISTER_FIRST,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixture = await getFixtureById(fixtureId);
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

  const existing = await getPrediction(interaction.user.id, fixtureId);
  if (existing) {
    await interaction.reply({
      content: msgs.ERR_ALREADY_PREDICTED,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await clearPendingPrediction(interaction.user.id, fixtureId);

  await interaction.reply({
    content: buildPredictionFormContent(fixture, null),
    components: buildPredictionSelectRows(fixture, fixtureId, null),
    flags: MessageFlags.Ephemeral
  });
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @returns {Promise<void>}
 */
async function handleFootballPickSelect(interaction) {
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

  const fixture = await getFixtureById(fixtureId);
  if (!fixture || !isFixtureOpenForPrediction(fixture)) {
    await clearPendingPrediction(interaction.user.id, fixtureId);
    await interaction.update({
      content: msgs.ERR_PREDICTIONS_CLOSED_SHORT,
      components: []
    });
    return;
  }

  const existing = await getPrediction(interaction.user.id, fixtureId);
  if (existing) {
    await clearPendingPrediction(interaction.user.id, fixtureId);
    await interaction.update({
      content: msgs.ERR_ALREADY_PREDICTED,
      components: []
    });
    return;
  }

  /** @type {Partial<import('./footballUtils').PendingPrediction>} */
  let partial = {};

  if (side === 'home' || side === 'away') {
    const goals = parseInt(value, 10);
    if (!Number.isInteger(goals) || goals < 0 || goals > 15) {
      await interaction.reply({
        content: msgs.ERR_GOALS_RANGE,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    partial = side === 'home' ? { homeScore: goals } : { awayScore: goals };
  } else if (side === 'winner') {
    if (!['home', 'draw', 'away'].includes(value)) {
      await interaction.reply({
        content: msgs.ERR_INVALID_WINNER,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    partial = { resultPick: value };
  }

  const pending = await savePendingPrediction(
    interaction.user.id,
    fixtureId,
    partial
  );

  if (!isPendingPredictionComplete(pending)) {
    await interaction.update({
      content: buildPredictionFormContent(fixture, pending),
      components: buildPredictionSelectRows(fixture, fixtureId, pending)
    });
    return;
  }

  await savePrediction(interaction.user.id, fixtureId, {
    homeScore: pending.homeScore,
    awayScore: pending.awayScore,
    resultPick: pending.resultPick,
    submittedAt: new Date().toISOString(),
    scored: false
  });
  await clearPendingPrediction(interaction.user.id, fixtureId);

  const embed = new EmbedBuilder()
    .setColor(config.baseEmbedColor)
    .setTitle(msgs.SAVED_PREDICTION_TITLE)
    .setDescription(
      `**${formatFixtureTeam(fixture, 'home')}** vs **${formatFixtureTeam(fixture, 'away')}**\n` +
      `Score: **${pending.homeScore}-${pending.awayScore}**\n` +
      `Winner: **${formatResultPickDisplay(fixture, pending.resultPick)}**`
    );

  await interaction.update({ embeds: [embed], content: null, components: [] });

  if (
    config.predictionMockApi &&
    interaction.client &&
    (await areAllMockPlayableFixturesPredicted())
  ) {
    await scoreFinishedFixtures(interaction.client);
  }

  logger.info('Football prediction saved.', {
    userId: interaction.user.id,
    fixtureId,
    homeScore: pending.homeScore,
    awayScore: pending.awayScore,
    resultPick: pending.resultPick
  });
}

module.exports = {
  PICK_PREFIX,
  BUTTON_PREFIX,
  isFootballPickSelect,
  parsePickCustomId,
  buildPredictionSelectRows,
  buildPredictionFormContent,
  handleFootballPredictButton,
  handleFootballPickSelect
};
