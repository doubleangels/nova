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
    .setDescription(description);
  if (footerText) {
    embed.setFooter({ text: footerText });
  }
  return embed;
}

/**
 * @param {string} line
 * @param {number} maxPageLength
 * @returns {string[]}
 */
function chunkLongLine(line, maxPageLength) {
  if (line.length <= maxPageLength) {
    return [line];
  }

  const chunks = [];
  for (let i = 0; i < line.length; i += maxPageLength) {
    chunks.push(line.slice(i, i + maxPageLength));
  }
  return chunks;
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
    for (const segment of chunkLongLine(line, maxPageLength)) {
      const segmentLen = segment.length + (current.length > 0 ? 1 : 0);
      if (current.length > 0 && currentLen + segmentLen > maxPageLength) {
        pages.push(current.join('\n'));
        current = [segment];
        currentLen = segment.length;
      } else {
        if (current.length > 0) {
          currentLen += 1;
        }
        current.push(segment);
        currentLen += segment.length;
      }
    }
  }

  if (current.length > 0) {
    pages.push(current.join('\n'));
  }

  return pages.length > 0 ? pages : [''];
}

/**
 * @param {number} total
 * @param {number} pageIndex
 * @param {number} pageCount
 * @returns {string}
 */
function buildPredictionsFooter(total, pageIndex, pageCount) {
  if (pageCount > 1) {
    return `Total points: ${total} · Page ${pageIndex + 1}/${pageCount}`;
  }
  return `Total points: ${total}`;
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

  const targetUser = interaction.options.getUser('user');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fixtures = await getSeasonFixtures();
  const fixtureMap = new Map(fixtures.map(f => [f.id, f]));

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
  const pageCount = pages.length;

  await replyWithPagination(
    interaction,
    pages,
    index => buildPredictionsEmbed(
      gameId,
      title,
      pages[index],
      buildPredictionsFooter(total, index, pageCount)
    ),
    paginationPrefix,
    logger
  );
}

module.exports = {
  DEFAULT_PAGE_LENGTH,
  buildUserPredictionLines,
  buildPredictionsEmbed,
  splitContentIntoPages,
  buildPredictionsFooter,
  replyWithPagination,
  handlePredictionsSubcommand
};
