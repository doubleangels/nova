const path = require('path');
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { isApiConfigured, getFixtureById } = require('./worldCupClient');
const { BUTTON_PREFIX } = require('./worldCupScheduler');
const {
  isUserRegistered,
  getPrediction,
  savePrediction,
  isFixtureOpenForPrediction,
  parseResultPick,
  parseScoreInputs
} = require('./worldCupUtils');

const MODAL_PREFIX = 'worldcup:predict:';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<void>}
 */
async function handleWorldCupPredictButton(interaction) {
  if (!isApiConfigured()) {
    await interaction.reply({
      content: '⚠️ World Cup predictions are not configured (missing API_FOOTBALL_KEY).',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixtureId = parseInt(interaction.customId.slice(BUTTON_PREFIX.length), 10);
  if (!Number.isFinite(fixtureId)) {
    await interaction.reply({
      content: '⚠️ Invalid match reference.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: '⚠️ Use this button in the server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const registered = await isUserRegistered(interaction.user.id);
  const roleId = config.worldCupParticipantRoleId;
  const hasRole = roleId && interaction.member.roles?.cache?.has(roleId);
  if (!registered && !hasRole) {
    await interaction.reply({
      content: '⚠️ Run `/worldcup register` first to join the prediction game.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixture = await getFixtureById(fixtureId);
  if (!fixture) {
    await interaction.reply({
      content: '⚠️ Could not load this match. Try again later.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!isFixtureOpenForPrediction(fixture)) {
    await interaction.reply({
      content: '⚠️ Predictions are closed for this match (already started or finished).',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const existing = await getPrediction(interaction.user.id, fixtureId);
  if (existing) {
    await interaction.reply({
      content: '⚠️ You already submitted a prediction for this match.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${fixtureId}`)
    .setTitle('World Cup prediction');

  const homeInput = new TextInputBuilder()
    .setCustomId('home_score')
    .setLabel('Home goals')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('0')
    .setRequired(true)
    .setMaxLength(2);

  const awayInput = new TextInputBuilder()
    .setCustomId('away_score')
    .setLabel('Away goals')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('0')
    .setRequired(true)
    .setMaxLength(2);

  const pickInput = new TextInputBuilder()
    .setCustomId('result_pick')
    .setLabel('Result (home, draw, or away)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('home / draw / away')
    .setRequired(true)
    .setMaxLength(5);

  modal.addComponents(
    new ActionRowBuilder().addComponents(homeInput),
    new ActionRowBuilder().addComponents(awayInput),
    new ActionRowBuilder().addComponents(pickInput)
  );

  await interaction.showModal(modal);
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @returns {Promise<void>}
 */
async function handleWorldCupPredictModal(interaction) {
  const fixtureId = parseInt(interaction.customId.slice(MODAL_PREFIX.length), 10);
  if (!Number.isFinite(fixtureId)) {
    await interaction.reply({
      content: '⚠️ Invalid match reference.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const scoreParsed = parseScoreInputs(
    interaction.fields.getTextInputValue('home_score'),
    interaction.fields.getTextInputValue('away_score')
  );
  if (scoreParsed.error) {
    await interaction.reply({
      content: `⚠️ ${scoreParsed.error}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const resultPick = parseResultPick(interaction.fields.getTextInputValue('result_pick'));
  if (!resultPick) {
    await interaction.reply({
      content: '⚠️ Result must be `home`, `draw`, or `away`.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixture = await getFixtureById(fixtureId);
  if (!fixture || !isFixtureOpenForPrediction(fixture)) {
    await interaction.reply({
      content: '⚠️ Predictions are closed for this match.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const existing = await getPrediction(interaction.user.id, fixtureId);
  if (existing) {
    await interaction.reply({
      content: '⚠️ You already submitted a prediction for this match.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await savePrediction(interaction.user.id, fixtureId, {
    homeScore: scoreParsed.homeScore,
    awayScore: scoreParsed.awayScore,
    resultPick,
    submittedAt: new Date().toISOString(),
    scored: false
  });

  const embed = new EmbedBuilder()
    .setColor(config.baseEmbedColor)
    .setTitle('Prediction saved')
    .setDescription(
      `**${fixture.home}** vs **${fixture.away}**\n` +
      `Score: **${scoreParsed.homeScore}–${scoreParsed.awayScore}**\n` +
      `Result pick: **${resultPick}**`
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

  logger.info('World Cup prediction saved.', {
    userId: interaction.user.id,
    fixtureId,
    homeScore: scoreParsed.homeScore,
    awayScore: scoreParsed.awayScore,
    resultPick
  });
}

module.exports = {
  MODAL_PREFIX,
  BUTTON_PREFIX,
  handleWorldCupPredictButton,
  handleWorldCupPredictModal
};
