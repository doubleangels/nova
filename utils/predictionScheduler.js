const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { buildRolePing, SUBMIT_BUTTON_LABEL } = require('./predictionMessages');
const { fetchMatchAiPrediction } = require('./matchPredictionAi');
const { isInReminderWindow } = require('./predictionGameUi');
const { runWithConcurrency } = require('./asyncUtils');

/** Max concurrent Gemini calls when posting multiple match prompts in one poll. */
const AI_PROMPT_CONCURRENCY = 2;

/**
 * @param {{
 *   logLabel: string,
 *   buttonPrefix: string,
 *   aiGameId: 'worldcup'|'club',
 *   participantRoleId?: string,
 *   channelId?: string,
 *   isApiConfigured: () => boolean,
 *   isGameConfigured: () => boolean,
 *   isMockApiEnabled: () => boolean,
 *   mockPlayableIds: number[],
 *   getSeasonFixtures: (opts?: { forceRefresh?: boolean }) => Promise<object[]>,
 *   store: import('./predictionGameStore').PredictionStore,
 *   buildPromptEmbed: (fixture: object, options?: object) => import('discord.js').EmbedBuilder,
 *   scoreFinishedFixtures: (client?: import('discord.js').Client) => Promise<number>,
 *   resetMockDemoState: () => Promise<void>,
 *   isInReminderWindow?: (fixture: object, now: Date) => boolean
 * }} options
 */
function createPredictionScheduler(options) {
  const checkReminderWindow =
    options.isInReminderWindow || isInReminderWindow;
  /** @type {NodeJS.Timeout | null} */
  let pollInterval = null;
  let pollInFlight = false;

  function buildPromptChannelContent() {
    const roleId = options.participantRoleId;
    if (!roleId || !String(roleId).trim()) return undefined;
    return buildRolePing(roleId);
  }

  function buildPredictButtonRow(fixture) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${options.buttonPrefix}${fixture.id}`)
        .setLabel(SUBMIT_BUTTON_LABEL)
        .setStyle(ButtonStyle.Primary)
    );
  }

  /**
   * @param {import('discord.js').Client} client
   * @param {object} fixture
   */
  async function sendPredictionPrompts(client, fixture) {
    const fixtureId = Number(fixture.id);
    if (!Number.isFinite(fixtureId)) return;
    if (!(await options.store.tryClaimFixtureForPrompt(fixtureId))) return;

    const channelId = options.channelId;
    const aiPrediction = await fetchMatchAiPrediction({
      game: options.aiGameId,
      fixture
    });
    const embed = options.buildPromptEmbed(fixture, {
      aiPrediction: aiPrediction || undefined
    });
    const components = [buildPredictButtonRow(fixture)];

    let posted = false;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        const content = buildPromptChannelContent();
        await channel.send({
          ...(content ? { content } : {}),
          embeds: [embed],
          components
        });
        posted = true;
      }
    } catch (err) {
      logger.error(`Failed to post ${options.logLabel} channel prompt.`, {
        err,
        fixtureId,
        channelId
      });
    }

    if (!posted) {
      await options.store.releaseFixturePromptClaim(fixtureId);
    }
  }

  function shouldPromptFixture(fixture, now) {
    if (options.isMockApiEnabled() && options.mockPlayableIds.includes(fixture.id)) {
      return true;
    }
    return checkReminderWindow(fixture, now);
  }

  /**
   * @param {import('discord.js').Client} client
   * @param {{ forceRefresh?: boolean }} [options]
   */
  async function runPoll(client, { forceRefresh = false } = {}) {
    if (!options.isApiConfigured() || !options.isGameConfigured()) return;
    if (pollInFlight) return;

    pollInFlight = true;
    try {
      const fixtures = await options.getSeasonFixtures({ forceRefresh });
      await options.scoreFinishedFixtures(client, fixtures);

      if (await options.store.isPromptingPaused()) {
        return;
      }
      const prompted = await options.store.getPromptedFixtures();
      const promptedSet = new Set(
        prompted.map(id => Number(id)).filter(Number.isFinite)
      );
      const now = new Date();

      const fixturesToPrompt = fixtures.filter(fixture => {
        const fixtureId = Number(fixture.id);
        return (
          Number.isFinite(fixtureId) &&
          !promptedSet.has(fixtureId) &&
          shouldPromptFixture(fixture, now)
        );
      });

      if (fixturesToPrompt.length > 0) {
        await runWithConcurrency(
          fixturesToPrompt.map(fixture => () => sendPredictionPrompts(client, fixture)),
          AI_PROMPT_CONCURRENCY
        );
      }
    } catch (err) {
      logger.error(`${options.logLabel} scheduler poll failed.`, { err });
    } finally {
      pollInFlight = false;
    }
  }

  /**
   * @param {import('discord.js').Client} client
   */
  async function runStartup(client) {
    if (options.isMockApiEnabled()) {
      await options.resetMockDemoState();
      logger.info(`${options.logLabel} mock demo reset (fresh test match).`);
    }
    await runPoll(client, { forceRefresh: true });
  }

  /**
   * @param {import('discord.js').Client} client
   */
  function startScheduler(client) {
    if (!options.isApiConfigured() || !options.isGameConfigured()) {
      logger.info(`${options.logLabel} scheduler not started (missing API key or channel).`);
      return;
    }

    if (pollInterval) {
      clearInterval(pollInterval);
    }

    const intervalMs = config.predictionPollIntervalMs;

    void runStartup(client);

    pollInterval = setInterval(() => {
      void runPoll(client);
    }, intervalMs);

    logger.info(`${options.logLabel} scheduler started.`, { intervalMs });
  }

  function stopScheduler() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    pollInFlight = false;
  }

  return {
    buildPromptChannelContent,
    buildPredictButtonRow,
    sendPredictionPrompts,
    runPoll,
    runStartup,
    startScheduler,
    stopScheduler
  };
}

module.exports = {
  createPredictionScheduler
};
