const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const msgs = require('./predictionMessages');
const {
  alignResultPickWithScore,
  resultPickFromScore,
  isFixtureFinishedForScoring,
  buildScoringUpdate
} = require('./predictionGameScoring');

/**
 * @param {{
 *   store: import('./predictionGameStore').PredictionStore,
 *   getFixtureById: (id: number) => Promise<object|null>,
 *   getScoredFixtures: () => Promise<number[]>,
 *   scoreFixtureIfFinished: (fixture: object) => Promise<{ scored: boolean }>,
 *   applyUserScoringUpdate: (
 *     fixtureId: number,
 *     userId: string,
 *     prediction: import('./predictionGameStore').GamePrediction,
 *     pointsDelta: number
 *   ) => Promise<void>,
 *   userId: string,
 *   fixtureId: number,
 *   homeScore: number,
 *   awayScore: number,
 *   resultPick?: 'home'|'draw'|'away'
 * }} params
 * @returns {Promise<{
 *   ok: true,
 *   userId: string,
 *   fixture: object,
 *   prediction: import('./predictionGameStore').GamePrediction,
 *   scoredNow: boolean,
 *   pointsDelta: number,
 *   matchPoints: number,
 *   totalPoints: number,
 *   overwritten: boolean
 * } | { ok: false, error: 'ERR_FIXTURE_NOT_FOUND' }>}
 */
async function addPredictionForUser(params) {
  const {
    store,
    getFixtureById,
    getScoredFixtures,
    scoreFixtureIfFinished,
    applyUserScoringUpdate,
    userId,
    fixtureId,
    homeScore,
    awayScore,
    resultPick: rawResultPick
  } = params;

  const fixture = await getFixtureById(fixtureId);
  if (!fixture) {
    return { ok: false, error: 'ERR_FIXTURE_NOT_FOUND' };
  }

  const resultPick = alignResultPickWithScore(
    homeScore,
    awayScore,
    rawResultPick || resultPickFromScore(homeScore, awayScore)
  );

  const existing = await store.getPrediction(userId, fixtureId);
  const oldAwarded = existing?.scored ? (existing.pointsAwarded || 0) : 0;
  const overwritten = Boolean(existing);

  /** @type {import('./predictionGameStore').GamePrediction} */
  const prediction = {
    homeScore,
    awayScore,
    resultPick,
    submittedAt: new Date().toISOString(),
    scored: false
  };

  await store.savePrediction(userId, fixtureId, prediction);

  if (!isFixtureFinishedForScoring(fixture)) {
    const totalPoints = await store.getUserPoints(userId);
    return {
      ok: true,
      userId,
      fixture,
      prediction,
      scoredNow: false,
      pointsDelta: 0,
      matchPoints: 0,
      totalPoints,
      overwritten
    };
  }

  const { scoredPrediction, pointsDelta: fullMatchPoints } = buildScoringUpdate(
    prediction,
    fixture.goals.home,
    fixture.goals.away
  );
  const scoredList = await getScoredFixtures();
  const normalizedFixtureId = Number(fixtureId);
  const fixtureAlreadyScored = scoredList.some(
    id => Number(id) === normalizedFixtureId
  );

  if (fixtureAlreadyScored) {
    const pointsDelta = fullMatchPoints - oldAwarded;
    await applyUserScoringUpdate(fixtureId, userId, scoredPrediction, pointsDelta);
    const totalPoints = await store.getUserPoints(userId);
    return {
      ok: true,
      userId,
      fixture,
      prediction: scoredPrediction,
      scoredNow: true,
      pointsDelta,
      matchPoints: fullMatchPoints,
      totalPoints,
      overwritten
    };
  }

  await scoreFixtureIfFinished(fixture);
  const updated = await store.getPrediction(userId, fixtureId);
  const matchPoints = updated?.pointsAwarded ?? fullMatchPoints;
  const totalPoints = await store.getUserPoints(userId);

  return {
    ok: true,
    userId,
    fixture,
    prediction: updated || scoredPrediction,
    scoredNow: true,
    pointsDelta: matchPoints - oldAwarded,
    matchPoints,
    totalPoints,
    overwritten
  };
}

/**
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {{
 *   gameId: import('./predictionMessages').PredictionGameId,
 *   isApiConfigured: () => boolean,
 *   store: import('./predictionGameStore').PredictionStore,
 *   getFixtureById: (id: number) => Promise<object|null>,
 *   getScoredFixtures: () => Promise<number[]>,
 *   scoreFixtureIfFinished: (fixture: object) => Promise<{ scored: boolean }>,
 *   applyUserScoringUpdate: (
 *     fixtureId: number,
 *     userId: string,
 *     prediction: import('./predictionGameStore').GamePrediction,
 *     pointsDelta: number
 *   ) => Promise<void>,
 *   formatFixtureLine: (fixture: object) => string,
 *   formatResultPickDisplay: (fixture: object, resultPick: string) => string,
 *   parseScoreInputs: (homeRaw: unknown, awayRaw: unknown, fixture: object) => { homeScore?: number, awayScore?: number, error?: string },
 *   logger: { info: Function }
 * }} deps
 */
async function handleAddPredictionSubcommand(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.errAdminAddPredictionOnly(deps.gameId),
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

  const targetUser = interaction.options.getUser('user', true);
  if (targetUser.bot) {
    await interaction.reply({
      content: '⚠️ Bots cannot receive prediction entries.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixtureId = interaction.options.getInteger('fixture', true);
  const homeRaw = interaction.options.getInteger('home', true);
  const awayRaw = interaction.options.getInteger('away', true);
  const rawResult = interaction.options.getString('result');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fixture = await deps.getFixtureById(fixtureId);
  if (!fixture) {
    await interaction.editReply({ content: msgs.ERR_FIXTURE_NOT_FOUND });
    return;
  }

  const parsedScores = deps.parseScoreInputs(homeRaw, awayRaw, fixture);
  if (parsedScores.error) {
    await interaction.editReply({ content: `⚠️ ${parsedScores.error}` });
    return;
  }

  /** @type {'home'|'draw'|'away'|undefined} */
  let resultPick;
  if (rawResult) {
    if (!['home', 'draw', 'away'].includes(rawResult)) {
      await interaction.editReply({ content: msgs.ERR_INVALID_WINNER });
      return;
    }
    resultPick = rawResult;
  }

  const result = await addPredictionForUser({
    store: deps.store,
    getFixtureById: deps.getFixtureById,
    getScoredFixtures: deps.getScoredFixtures,
    scoreFixtureIfFinished: deps.scoreFixtureIfFinished,
    applyUserScoringUpdate: deps.applyUserScoringUpdate,
    userId: targetUser.id,
    fixtureId,
    homeScore: parsedScores.homeScore,
    awayScore: parsedScores.awayScore,
    resultPick
  });

  if (!result.ok) {
    await interaction.editReply({ content: msgs.ERR_FIXTURE_NOT_FOUND });
    return;
  }

  const pickLine = `**Pick:** ${result.prediction.homeScore}-${result.prediction.awayScore} (${deps.formatResultPickDisplay(fixture, result.prediction.resultPick)})`;
  const embed = new EmbedBuilder()
    .setColor(msgs.GAME[deps.gameId].embedColor)
    .setTitle('Prediction Added')
    .setDescription(
      msgs.buildAddPredictionSuccessDescription({
        userId: result.userId,
        fixtureLine: deps.formatFixtureLine(fixture),
        pickLine,
        scoredNow: result.scoredNow,
        pointsDelta: result.pointsDelta,
        matchPoints: result.matchPoints,
        totalPoints: result.totalPoints,
        overwritten: result.overwritten
      })
    );

  deps.logger.info('Administrator added prediction for user.', {
    adminUserId: interaction.user.id,
    guildId: interaction.guild.id,
    targetUserId: result.userId,
    fixtureId,
    scoredNow: result.scoredNow,
    pointsDelta: result.pointsDelta,
    overwritten: result.overwritten,
    gameId: deps.gameId
  });

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  addPredictionForUser,
  handleAddPredictionSubcommand
};
