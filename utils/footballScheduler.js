const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { getSeasonFixtures, isApiConfigured, isMockApiEnabled } = require('./footballClient');
const {
  isFootballGameConfigured,
  getPromptedFixtures,
  markFixturePrompted,
  buildPromptEmbed,
  isInReminderWindow,
  scoreFinishedFixtures,
  resetMockDemoState
} = require('./footballUtils');
const { MOCK_PLAYABLE_MATCH_IDS } = require('./footballMockData');
const { buildRolePing, SUBMIT_BUTTON_LABEL } = require('./predictionMessages');
const { fetchMatchAiPrediction } = require('./matchPredictionAi');

/** @type {NodeJS.Timeout | null} */
let pollInterval = null;

const BUTTON_PREFIX = 'football:predict:';

/**
 * @returns {string|undefined}
 */
function buildPromptChannelContent() {
  const roleId = config.predictionParticipantRoleId;
  if (!roleId || !String(roleId).trim()) return undefined;
  return buildRolePing(roleId);
}

/**
 * @param {import('./footballUtils').NormalizedFixture} fixture
 * @returns {ActionRowBuilder}
 */
function buildPredictButtonRow(fixture) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${fixture.id}`)
      .setLabel(SUBMIT_BUTTON_LABEL)
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('./footballUtils').NormalizedFixture} fixture
 * @returns {Promise<void>}
 */
async function sendPredictionPrompts(client, fixture) {
  const channelId = config.predictionChannelId;
  const aiPrediction = await fetchMatchAiPrediction({ game: 'club', fixture });
  const embed = buildPromptEmbed(fixture, { aiPrediction: aiPrediction || undefined });
  const components = [buildPredictButtonRow(fixture)];

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      const content = buildPromptChannelContent();
      await channel.send({
        ...(content ? { content } : {}),
        embeds: [embed],
        components
      });
    }
  } catch (err) {
    logger.error('Failed to post Football channel prompt.', {
      err,
      fixtureId: fixture.id,
      channelId
    });
  }

  await markFixturePrompted(fixture.id);
}

/**
 * @param {import('./footballUtils').NormalizedFixture} fixture
 * @param {Date} now
 * @returns {boolean}
 */
function shouldPromptFixture(fixture, now) {
  if (isMockApiEnabled() && MOCK_PLAYABLE_MATCH_IDS.includes(fixture.id)) {
    return true;
  }
  return isInReminderWindow(fixture, now);
}

/**
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function runFootballPoll(client) {
  if (!isApiConfigured() || !isFootballGameConfigured()) return;

  try {
    await scoreFinishedFixtures(client);

    const fixtures = await getSeasonFixtures({ forceRefresh: true });
    const prompted = await getPromptedFixtures();
    const now = new Date();

    for (const fixture of fixtures) {
      if (prompted.includes(fixture.id)) continue;
      if (!shouldPromptFixture(fixture, now)) continue;
      await sendPredictionPrompts(client, fixture);
    }
  } catch (err) {
    logger.error('Football scheduler poll failed.', { err });
  }
}

/**
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function runFootballStartup(client) {
  if (isMockApiEnabled()) {
    await resetMockDemoState();
    logger.info('Football mock demo reset (fresh test match).');
  }
  await runFootballPoll(client);
}

/**
 * @param {import('discord.js').Client} client
 * @returns {void}
 */
function startFootballScheduler(client) {
  if (!isApiConfigured() || !isFootballGameConfigured()) {
    logger.info('Football scheduler not started (missing API key or channel).');
    return;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
  }

  const intervalMs = config.predictionPollIntervalMs;

  void runFootballStartup(client);

  pollInterval = setInterval(() => {
    void runFootballPoll(client);
  }, intervalMs);

  logger.info('Football scheduler started.', { intervalMs });
}

/**
 * Stops the scheduler (for tests).
 */
function stopFootballScheduler() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = {
  BUTTON_PREFIX,
  buildPromptChannelContent,
  buildPredictButtonRow,
  sendPredictionPrompts,
  runFootballPoll,
  runFootballStartup,
  startFootballScheduler,
  stopFootballScheduler
};
