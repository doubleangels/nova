const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { getSeasonFixtures, isApiConfigured } = require('./worldCupClient');
const {
  isWorldCupGameConfigured,
  getRegisteredUserIds,
  getPromptedFixtures,
  markFixturePrompted,
  buildPromptEmbed,
  isInReminderWindow,
  scoreFinishedFixtures
} = require('./worldCupUtils');

/** @type {NodeJS.Timeout | null} */
let pollInterval = null;

const BUTTON_PREFIX = 'worldcup:predict:';

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @returns {ActionRowBuilder}
 */
function buildPredictButtonRow(fixture) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${fixture.id}`)
      .setLabel('Submit prediction')
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @returns {Promise<void>}
 */
async function sendPredictionPrompts(client, fixture) {
  const channelId = config.worldCupChannelId;
  const embed = buildPromptEmbed(fixture);
  const components = [buildPredictButtonRow(fixture)];

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [embed], components });
    }
  } catch (err) {
    logger.error('Failed to post World Cup channel prompt.', {
      err,
      fixtureId: fixture.id,
      channelId
    });
  }

  const registered = await getRegisteredUserIds();
  for (const userId of registered) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed], components });
    } catch (err) {
      logger.debug('Could not DM user for World Cup prompt.', {
        err: err.message,
        userId,
        fixtureId: fixture.id
      });
    }
  }

  await markFixturePrompted(fixture.id);
}

/**
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function runWorldCupPoll(client) {
  if (!isApiConfigured() || !isWorldCupGameConfigured()) return;

  try {
    await scoreFinishedFixtures(client);

    const fixtures = await getSeasonFixtures({ forceRefresh: true });
    const prompted = await getPromptedFixtures();
    const now = new Date();

    for (const fixture of fixtures) {
      if (prompted.includes(fixture.id)) continue;
      if (!isInReminderWindow(fixture, now)) continue;
      await sendPredictionPrompts(client, fixture);
    }
  } catch (err) {
    logger.error('World Cup scheduler poll failed.', { err });
  }
}

/**
 * @param {import('discord.js').Client} client
 * @returns {void}
 */
function startWorldCupScheduler(client) {
  if (!isApiConfigured() || !isWorldCupGameConfigured()) {
    logger.info('World Cup scheduler not started (missing API key or channel).');
    return;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
  }

  const intervalMs = config.worldCupPollIntervalMs;

  void runWorldCupPoll(client);

  pollInterval = setInterval(() => {
    void runWorldCupPoll(client);
  }, intervalMs);

  logger.info('World Cup scheduler started.', { intervalMs });
}

/**
 * Stops the scheduler (for tests).
 */
function stopWorldCupScheduler() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = {
  BUTTON_PREFIX,
  buildPredictButtonRow,
  sendPredictionPrompts,
  runWorldCupPoll,
  startWorldCupScheduler,
  stopWorldCupScheduler
};
