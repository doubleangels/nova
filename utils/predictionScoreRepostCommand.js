const {
  ActionRowBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require('discord.js');
const msgs = require('./predictionMessages');
const { buildFixtureSelectOptions, MAX_SELECT_FIXTURES } = require('./predictionPromptCommand');

/**
 * @param {(opts?: { forceRefresh?: boolean, competition?: string }) => Promise<object[]>} getSeasonFixtures
 * @param {() => Promise<number[]>} getScoredFixtures
 * @param {{ competition?: string }} [filter]
 * @returns {Promise<object[]>}
 */
async function getFinishedScoredFixtures(getSeasonFixtures, getScoredFixtures, filter = {}) {
  const fetchOpts = filter.competition ? { competition: filter.competition } : {};
  const scoredSet = new Set(await getScoredFixtures());
  let fixtures = await getSeasonFixtures(fetchOpts);

  fixtures = fixtures
    .filter(
      f =>
        f.status === 'FT' &&
        f.goals?.home != null &&
        f.goals?.away != null &&
        scoredSet.has(f.id)
    )
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, MAX_SELECT_FIXTURES);

  return fixtures;
}

/**
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {{
 *   gameId: 'worldcup'|'club',
 *   selectCustomId: string,
 *   isApiConfigured: () => boolean,
 *   isGameConfigured: () => boolean,
 *   getSeasonFixtures: (opts?: object) => Promise<object[]>,
 *   getScoredFixtures: () => Promise<number[]>,
 *   formatFixtureLine: (fixture: object) => string,
 *   competition?: string|null
 * }} deps
 */
async function handleRepostScoreSubcommand(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.errAdminRepostScoreOnly(deps.gameId),
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
  const fixtures = await getFinishedScoredFixtures(
    deps.getSeasonFixtures,
    deps.getScoredFixtures,
    filter
  );

  if (fixtures.length === 0) {
    await interaction.editReply({ content: msgs.MSG_REPOST_SCORE_NO_MATCHES });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(deps.selectCustomId)
    .setPlaceholder(msgs.MSG_REPOST_SCORE_SELECT_PLACEHOLDER)
    .addOptions(buildFixtureSelectOptions(fixtures, deps.formatFixtureLine));

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.editReply({
    content: 'Select a match to re-post its final score announcement:',
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
 *   getScoredFixtures: () => Promise<number[]>,
 *   formatFixtureLine: (fixture: object) => string,
 *   repostFinalScore: (client: import('discord.js').Client, fixture: object) => Promise<boolean>,
 *   logger: { info: Function, error: Function }
 * }} deps
 */
async function handleRepostScoreSelect(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.errAdminRepostScoreOnly(deps.gameId),
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

  if (fixture.status !== 'FT' || fixture.goals?.home == null || fixture.goals?.away == null) {
    await interaction.editReply({
      content: msgs.ERR_MATCH_NOT_FINISHED,
      components: []
    });
    return;
  }

  const scoredFixtures = await deps.getScoredFixtures();
  if (!scoredFixtures.includes(fixtureId)) {
    await interaction.editReply({
      content: msgs.ERR_MATCH_NOT_SCORED,
      components: []
    });
    return;
  }

  const posted = await deps.repostFinalScore(interaction.client, fixture);

  if (!posted) {
    await interaction.editReply({
      content: msgs.ERR_REPOST_SCORE_FAILED,
      components: []
    });
    return;
  }

  deps.logger.info('Final score announcement re-posted by administrator.', {
    gameId: deps.gameId,
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    fixtureId
  });

  await interaction.editReply({
    content: msgs.msgScoreReposted(deps.formatFixtureLine(fixture)),
    components: []
  });
}

module.exports = {
  getFinishedScoredFixtures,
  handleRepostScoreSubcommand,
  handleRepostScoreSelect
};
