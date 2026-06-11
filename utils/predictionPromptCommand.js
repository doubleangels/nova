const {
  ActionRowBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require('discord.js');
const msgs = require('./predictionMessages');
const { isFixtureOpenForPrediction } = require('./predictionGameUi');

const UPCOMING_STATUSES = new Set(['NS', 'TBD', 'PST']);
const MAX_SELECT_FIXTURES = 25;
const SELECT_LABEL_MAX = 100;

/**
 * @param {(opts?: { forceRefresh?: boolean, competition?: string }) => Promise<object[]>} getSeasonFixtures
 * @param {{ competition?: string }} [filter]
 * @returns {Promise<object[]>}
 */
async function getUpcomingFixtures(getSeasonFixtures, filter = {}) {
  const fetchOpts = filter.competition ? { competition: filter.competition } : {};
  let fixtures = await getSeasonFixtures(fetchOpts);

  fixtures = fixtures
    .filter(
      f =>
        UPCOMING_STATUSES.has(f.status) && isFixtureOpenForPrediction(f)
    )
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .slice(0, MAX_SELECT_FIXTURES);

  return fixtures;
}

/**
 * @param {object[]} fixtures
 * @param {(fixture: object) => string} formatFixtureLine
 * @returns {{ label: string, value: string }[]}
 */
function buildFixtureSelectOptions(fixtures, formatFixtureLine) {
  return fixtures.map(fixture => {
    let label = formatFixtureLine(fixture);
    if (label.length > SELECT_LABEL_MAX) {
      label = `${label.slice(0, SELECT_LABEL_MAX - 1)}…`;
    }
    return {
      label,
      value: String(fixture.id)
    };
  });
}

/**
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {{
 *   gameId: 'worldcup'|'club',
 *   selectCustomId: string,
 *   isApiConfigured: () => boolean,
 *   isGameConfigured: () => boolean,
 *   getSeasonFixtures: (opts?: object) => Promise<object[]>,
 *   formatFixtureLine: (fixture: object) => string,
 *   competition?: string|null
 * }} deps
 */
async function handlePromptSubcommand(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.errAdminPromptOnly(deps.gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!deps.isApiConfigured()) {
    await interaction.reply({
      content: msgs.errNotConfigured(deps.gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!deps.isGameConfigured()) {
    await interaction.reply({
      content: msgs.ERR_REGISTER_NOT_CONFIGURED,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const filter = deps.competition ? { competition: deps.competition } : {};
  const fixtures = await getUpcomingFixtures(deps.getSeasonFixtures, filter);

  if (fixtures.length === 0) {
    await interaction.editReply({ content: msgs.MSG_PROMPT_NO_UPCOMING });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(deps.selectCustomId)
    .setPlaceholder(msgs.MSG_PROMPT_SELECT_PLACEHOLDER)
    .addOptions(buildFixtureSelectOptions(fixtures, deps.formatFixtureLine));

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.editReply({
    content: 'Select a match to re-post its prediction prompt:',
    components: [row]
  });
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {{
 *   gameId: 'worldcup'|'club',
 *   isApiConfigured: () => boolean,
 *   isGameConfigured: () => boolean,
 *   getFixtureById: (id: number) => Promise<object|null>,
 *   formatFixtureLine: (fixture: object) => string,
 *   repromptFixture: (client: import('discord.js').Client, fixture: object) => Promise<boolean>,
 *   logger: { info: Function, error: Function }
 * }} deps
 */
async function handlePromptSelect(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.errAdminPromptOnly(deps.gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!deps.isApiConfigured() || !deps.isGameConfigured()) {
    await interaction.reply({
      content: msgs.errNotConfigured(deps.gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferUpdate();

  const fixtureId = parseInt(interaction.values[0], 10);
  if (!Number.isFinite(fixtureId)) {
    await interaction.editReply({
      content: msgs.ERR_INVALID_MATCH,
      components: []
    });
    return;
  }

  const fixture = await deps.getFixtureById(fixtureId);
  if (!fixture) {
    await interaction.editReply({
      content: msgs.ERR_MATCH_LOAD,
      components: []
    });
    return;
  }

  if (!isFixtureOpenForPrediction(fixture)) {
    await interaction.editReply({
      content: msgs.ERR_PREDICTIONS_CLOSED,
      components: []
    });
    return;
  }

  const posted = await deps.repromptFixture(interaction.client, fixture);

  if (!posted) {
    await interaction.editReply({
      content: msgs.ERR_PROMPT_FAILED,
      components: []
    });
    return;
  }

  deps.logger.info('Match prompt re-posted by administrator.', {
    gameId: deps.gameId,
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    fixtureId
  });

  await interaction.editReply({
    content: msgs.msgPromptReposted(deps.formatFixtureLine(fixture)),
    components: []
  });
}

module.exports = {
  getUpcomingFixtures,
  buildFixtureSelectOptions,
  handlePromptSubcommand,
  handlePromptSelect,
  MAX_SELECT_FIXTURES
};
