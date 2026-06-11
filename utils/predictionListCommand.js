const { EmbedBuilder, MessageFlags, ButtonStyle } = require('discord.js');
const msgs = require('./predictionMessages');
const { createPaginatedResults } = require('./searchUtils');

const DEFAULT_PAGE_LENGTH = 3800;

/**
 * @param {Array<{ fixtureId: number, prediction: import('./predictionGameStore').GamePrediction|null }>} predictionEntries
 * @param {Map<number, object>} fixtureMap
 * @param {(fixture: object) => string} formatFixtureLine
 * @param {(fixture: object, resultPick: string) => string} formatResultPickDisplay
 * @returns {string[]}
 */
function buildUserPredictionLines(
  predictionEntries,
  fixtureMap,
  formatFixtureLine,
  formatResultPickDisplay
) {
  const lines = [];
  for (const { fixtureId, prediction } of predictionEntries) {
    if (!prediction) {
      lines.push(`• Match \`${fixtureId}\`: ${msgs.MSG_MISSING_PREDICTION}`);
      continue;
    }
    const fixture = fixtureMap.get(fixtureId);
    const label = fixture
      ? formatFixtureLine(fixture)
      : `Match \`${fixtureId}\``;
    const resultLabel = fixture
      ? formatResultPickDisplay(fixture, prediction.resultPick)
      : prediction.resultPick;
    const pick = msgs.formatMyPickLine(
      prediction.homeScore,
      prediction.awayScore,
      resultLabel,
      prediction.scored,
      prediction.pointsAwarded
    );
    lines.push(`• ${label}: ${pick}`);
  }
  return lines;
}

/**
 * @param {'worldcup'|'club'} gameId
 * @param {string} title
 * @param {string} description
 * @param {string} [footerText]
 * @returns {EmbedBuilder}
 */
function buildPredictionsEmbed(gameId, title, description, footerText) {
  const embed = new EmbedBuilder()
    .setColor(msgs.GAME[gameId].embedColor)
    .setTitle(title)
    .setDescription(description.slice(0, 4000));
  if (footerText) {
    embed.setFooter({ text: footerText });
  }
  return embed;
}

/**
 * @param {string[]} lines
 * @param {number} [maxPageLength]
 * @returns {string[]}
 */
function splitContentIntoPages(lines, maxPageLength = DEFAULT_PAGE_LENGTH) {
  const pages = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    const lineLen = line.length + 1;
    if (current.length > 0 && currentLen + lineLen > maxPageLength) {
      pages.push(current.join('\n'));
      current = [line];
      currentLen = lineLen;
    } else {
      current.push(line);
      currentLen += lineLen;
    }
  }

  if (current.length > 0) {
    pages.push(current.join('\n'));
  }

  return pages.length > 0 ? pages : [''];
}

/**
 * @param {Array<{ userId: string, points: number, lines: string[] }>} usersData
 * @param {number} [maxPageLength]
 * @returns {string[]}
 */
function buildAllPredictionsPages(usersData, maxPageLength = DEFAULT_PAGE_LENGTH) {
  const pages = [];
  let current = '';

  for (const { userId, points, lines } of usersData) {
    const section = [`**<@${userId}>** — **${points}** pts`, ...lines].join('\n');
    const separator = current ? '\n\n' : '';
    const addition = `${separator}${section}`;

    if (current && current.length + addition.length > maxPageLength) {
      pages.push(current);
      current = section;
    } else {
      current += addition;
    }
  }

  if (current) {
    pages.push(current);
  }

  return pages;
}

/**
 * @param {'worldcup'|'club'} gameId
 * @param {string} pageContent
 * @param {number} pageIndex
 * @param {number} pageCount
 * @returns {EmbedBuilder}
 */
function buildAllPredictionsPageEmbed(gameId, pageContent, pageIndex, pageCount) {
  const embed = buildPredictionsEmbed(
    gameId,
    msgs.GAME[gameId].predictionsTitleAll,
    pageContent
  );
  if (pageCount > 1) {
    embed.setFooter({ text: `Page ${pageIndex + 1}/${pageCount}` });
  }
  return embed;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string[]} pages
 * @param {(index: number) => EmbedBuilder} generateEmbed
 * @param {string} paginationPrefix
 * @param {import('../logger')} logger
 * @returns {Promise<void>}
 */
async function replyWithPagination(interaction, pages, generateEmbed, paginationPrefix, logger) {
  if (pages.length <= 1) {
    await interaction.editReply({ embeds: [generateEmbed(0)] });
    return;
  }

  await createPaginatedResults(
    interaction,
    pages,
    generateEmbed,
    paginationPrefix,
    120000,
    logger,
    {
      buttonStyle: ButtonStyle.Secondary,
      prevLabel: 'Previous',
      nextLabel: 'Next'
    }
  );
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} deps
 * @param {'worldcup'|'club'} deps.gameId
 * @param {string} deps.paginationPrefix
 * @param {import('../logger')} deps.logger
 * @param {() => boolean} deps.isApiConfigured
 * @param {() => Promise<object[]>} deps.getSeasonFixtures
 * @param {() => Promise<string[]>} deps.getAllPredictorUserIds
 * @param {(userId: string) => Promise<number[]>} deps.getUserPredictionFixtureIds
 * @param {(userId: string, fixtureIds: number[]) => Promise<Array<{ fixtureId: number, prediction: object|null }>>} deps.getPredictionsForUser
 * @param {(userId: string) => Promise<number>} deps.getUserPoints
 * @param {(fixture: object) => string} deps.formatFixtureLine
 * @param {(fixture: object, resultPick: string) => string} deps.formatResultPickDisplay
 * @returns {Promise<void>}
 */
async function handlePredictionsSubcommand(interaction, deps) {
  const {
    gameId,
    paginationPrefix,
    logger,
    isApiConfigured,
    getSeasonFixtures,
    getAllPredictorUserIds,
    getUserPredictionFixtureIds,
    getPredictionsForUser,
    getUserPoints,
    formatFixtureLine,
    formatResultPickDisplay
  } = deps;

  if (!isApiConfigured()) {
    await interaction.reply({
      content: msgs.errNotConfigured(gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply();

  const fixtures = await getSeasonFixtures();
  const fixtureMap = new Map(fixtures.map(f => [f.id, f]));
  const targetUser = interaction.options.getUser('user');

  if (targetUser) {
    const isSelf = targetUser.id === interaction.user.id;
    const fixtureIds = await getUserPredictionFixtureIds(targetUser.id);

    if (fixtureIds.length === 0) {
      await interaction.editReply({
        content: isSelf
          ? msgs.MSG_NO_PREDICTIONS
          : msgs.msgNoPredictionsForUser(targetUser.displayName)
      });
      return;
    }

    const predictionEntries = await getPredictionsForUser(targetUser.id, fixtureIds);
    const lines = buildUserPredictionLines(
      predictionEntries,
      fixtureMap,
      formatFixtureLine,
      formatResultPickDisplay
    );
    const total = await getUserPoints(targetUser.id);
    const title = isSelf
      ? msgs.GAME[gameId].predictionsTitleSelf
      : msgs.predictionsTitleOther(targetUser.displayName);
    const pages = splitContentIntoPages(lines);

    await replyWithPagination(
      interaction,
      pages,
      index => buildPredictionsEmbed(
        gameId,
        title,
        pages[index],
        `Total points: ${total}`
      ),
      paginationPrefix,
      logger
    );
    return;
  }

  const userIds = await getAllPredictorUserIds();
  if (userIds.length === 0) {
    await interaction.editReply({
      content: msgs.msgNoPredictionsAnywhere(gameId)
    });
    return;
  }

  const usersData = await Promise.all(
    userIds.map(async userId => {
      const fixtureIds = await getUserPredictionFixtureIds(userId);
      const predictionEntries = await getPredictionsForUser(userId, fixtureIds);
      const points = await getUserPoints(userId);
      const lines = buildUserPredictionLines(
        predictionEntries,
        fixtureMap,
        formatFixtureLine,
        formatResultPickDisplay
      );
      return { userId, points, lines };
    })
  );

  usersData.sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));

  const pages = buildAllPredictionsPages(usersData);
  const pageCount = pages.length;

  await replyWithPagination(
    interaction,
    pages,
    index => buildAllPredictionsPageEmbed(gameId, pages[index], index, pageCount),
    paginationPrefix,
    logger
  );
}

module.exports = {
  DEFAULT_PAGE_LENGTH,
  buildUserPredictionLines,
  buildPredictionsEmbed,
  buildAllPredictionsPageEmbed,
  splitContentIntoPages,
  buildAllPredictionsPages,
  replyWithPagination,
  handlePredictionsSubcommand
};
