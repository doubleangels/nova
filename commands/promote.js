const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { handleReminder, getNextReminderTimeAfterCleanup } = require('../utils/reminderUtils');
const { redditApiRequest, isRedditConfigured } = require('../utils/redditClient');

const PROMOTION_LINK = 'https://discord.gg/j5sfQtCVSU';

/** Markdown body text for Reddit link posts (below the invite URL). */
const PROMOTION_BODY = `**🐸 Welcome to Da Frens!**

*Where the banter is sharp, the games are sweaty, and the vibes are unmatched.*

## 🛸 The Vibe

We're all about unfiltered honesty and authentic talk. Expect directness, sharp wit, and the occasional 3 AM deep dive into whatever is on our minds. We keep it real, but we keep it focused.

## 🎮 The Gameplay

High-energy banter meets serious gaming. Whether we're grinding ranks or just causing digital chaos, we play hard - but we're here for a good time, not a toxic one. Rowdy? Yes. Reckless? Never.

## 🎪 The Circus Tent

Think of us as the high-end circus: fewer clowns, way better acts. We're here for the laughs and the big personalities. If you've got a sense of humor and can hold your own in a conversation, you'll fit right in.

## 🔞 The Grown-Up Stuff

21+ Only. No exceptions. We're an adult community, and we keep it that way. Age is verified upon entry to ensure the atmosphere stays mature (mostly).

## 💬 Jump Into the Action

Don't just sit on the sidelines! Introduce yourself, join the chat, and actually participate. This is a community, not a spectator sport. We're looking for people who bring personality and energy to the group.

## 🔥 Why You're Here

We're selective because we value the culture we've built. If you love fast-paced banter, can handle a joke, and want a crew that actually talks to each other, you've found the right spot.`;

/** Subreddits to post promotions to (display name for sr param; Reddit API accepts case-insensitive) */
const PROMOTION_SUBREDDITS = ['discordservers_', 'DiscordPromote', 'DiscordServerPromos'];

/** Preferred flair text per subreddit (case-insensitive substring match). Falls back to first available flair if not found. */
const SUBREDDIT_FLAIR_PREFERENCES = {
  'discordservers_': 'gaming',
  'DiscordPromote': 'gaming server',
  'DiscordServerPromos': 'multiple categories [please list in post description]'
};

/**
 * Gets the promotion title
 * @returns {Promise<string>} The promotion title
 */
async function getPromotionTitle() {
  return "🐸 Da Frens (21+) | High-energy gaming, top-tier banter, and a strict \"no lurkers\" policy.";
}

/**
 * Parse Reddit submit API response to extract post id and permalink
 * @param {object} submissionResponse - Response from /api/submit
 * @returns {{ postId: string, permalink: string } | null}
 */
function parseSubmissionResponse(submissionResponse) {
  if (!submissionResponse?.json) return null;
  const jsonData = submissionResponse.json;
  if (jsonData.errors?.length) return null;
  let postId = null;
  let permalink = null;
  const data = jsonData.data;
  if (data) {
    postId = data.id || (data.name ? data.name.replace('t3_', '') : null);
    permalink = data.permalink || null;
    if (!permalink && data.url) {
      const urlMatch = data.url.match(/https?:\/\/[^/]+(\/.*)/);
      permalink = urlMatch ? urlMatch[1] : data.url;
    }
  }
  if (typeof jsonData.data === 'string') {
    try {
      const parsed = JSON.parse(jsonData.data);
      postId = parsed.id || (parsed.name ? parsed.name.replace('t3_', '') : null);
      permalink = parsed.permalink || (parsed.url ? (parsed.url.match(/https?:\/\/[^/]+(\/.*)/)?.[1] || parsed.url) : null);
    } catch (_) { /* ignore */ }
  }
  if (!postId || !permalink) return null;
  return { postId, permalink };
}

/**
 * Get a user-friendly error message from Reddit API error response or thrown error
 * @param {object} err - Error or response
 * @param {string} subreddit - Subreddit display name (e.g. 'findaserver')
 * @returns {string}
 */
function getRedditErrorMessage(err, subreddit) {
  const sr = subreddit ? `r/${subreddit}` : 'Reddit';
  if (err.response?.data?.json?.errors?.length) {
    const arr = err.response.data.json.errors[0];
    if (Array.isArray(arr) && arr.length >= 2) {
      const code = arr[0];
      const detail = arr[1];
      if (code === 'SUBREDDIT_NOTALLOWED') return `${sr}: ${detail}`;
      if (code === 'SUBREDDIT_NOEXIST') return `${sr}: Subreddit does not exist or is private.`;
      if (code === 'RATELIMIT') return `Rate limit: ${detail}`;
      if (code === 'SUBMIT_VALIDATION_REPOST') return `${sr}: Already posted recently.`;
      return `${sr}: ${code} - ${detail}`;
    }
  }
  const msg = err.message || '';
  if (msg.includes('SUBREDDIT_NOTALLOWED')) return `${sr}: Only trusted members can post.`;
  if (msg.includes('SUBREDDIT_NOEXIST')) return `${sr}: Subreddit does not exist or is private.`;
  if (msg.includes('RATELIMIT')) return 'Rate limit exceeded.';
  return msg ? `${sr}: ${msg}` : `${sr}: Unknown error.`;
}

/** Max length for optional link-post body text (Reddit allows large selftext; keep a safe cap). */
const PROMOTION_BODY_MAX_LEN = 10000;

/**
 * Post promotion to a single subreddit
 * @param {string} subredditName - Subreddit name (e.g. 'discordservers_')
 * @param {string} promotionTitle - Post title
 * @param {string} [promotionBody] - Markdown body for the link post
 * @returns {Promise<{ success: boolean, permalink?: string, error?: string }>}
 */
async function postToSubreddit(subredditName, promotionTitle, promotionBody = '') {
  let flairId = null;
  try {
    const flairData = await redditApiRequest('GET', `/r/${subredditName}/api/link_flair`);
    if (flairData && Array.isArray(flairData) && flairData.length > 0) {
      const availableFlairs = flairData.map((f, i) => {
        const id = f.id ?? f.flair_template_id ?? f.flair_identifier;
        return {
          index: i,
          id,
          flair_template_id: f.flair_template_id,
          text: f.text ?? f.flair_text
        };
      });
      logger.info(`Available flairs for r/${subredditName}:`, {
        flairs: availableFlairs,
        totalCount: availableFlairs.length
      });
      const preferredText = (SUBREDDIT_FLAIR_PREFERENCES[subredditName] || '').toLowerCase();
      const preferred = preferredText
        ? flairData.find(f => (f.text || f.flair_text || '').toLowerCase().includes(preferredText))
        : null;
      const first = flairData[0];
      const flair = preferred || first;
      flairId = flair.id ?? flair.flair_template_id ?? flair.flair_identifier;
      logger.debug(`Using flair for r/${subredditName}:`, { id: flairId, flair_template_id: flair.flair_template_id, text: flair.text || flair.flair_text, preferredText, matchedPreferred: !!preferred });
    }
  } catch (flairErr) {
    if (flairErr.response?.status === 404 && flairErr.response?.data?.reason === 'banned') {
      return { success: false, error: `r/${subredditName} is banned or restricted.` };
    }
    logger.warn(`Could not fetch flairs for r/${subredditName}`, { status: flairErr.response?.status });
  }

  const submissionData = {
    title: promotionTitle,
    url: PROMOTION_LINK,
    sr: subredditName,
    kind: 'link',
    api_type: 'json'
  };
  if (flairId) submissionData.flair_id = flairId;

  const body = (promotionBody || '').trim();
  if (body) {
    submissionData.text = body.length > PROMOTION_BODY_MAX_LEN ? body.slice(0, PROMOTION_BODY_MAX_LEN) : body;
  }

  try {
    const response = await redditApiRequest('POST', '/api/submit', submissionData);
    const parsed = parseSubmissionResponse(response);
    if (parsed) {
      logger.info(`Successfully posted to r/${subredditName}`, { postId: parsed.postId, permalink: parsed.permalink });
      return { success: true, permalink: parsed.permalink };
    }
    if (response?.json?.errors?.length) {
      const errMsg = response.json.errors.map(e => Array.isArray(e) ? e.join(': ') : String(e)).join(', ');
      return { success: false, error: getRedditErrorMessage({ message: errMsg }, subredditName) };
    }
    return { success: false, error: `r/${subredditName}: Could not parse response.` };
  } catch (err) {
    return { success: false, error: getRedditErrorMessage(err, subredditName) };
  }
}

/**
 * Command module for promoting users to moderator status.
 * Manages moderator role assignment and permissions.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Post your server advertisement to Reddit.')
    .setDefaultMemberPermissions(null),

  /**
   * Executes the promote command.
   * This function:
   * 1. Validates user permissions
   * 2. Checks if target user is already a moderator
   * 3. Assigns moderator role
   * 4. Sends confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error promoting the user
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
          content: '⚠️ Only server administrators can run this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          flags: MessageFlags.Ephemeral
        });
      }

      await this.handlePost(interaction);

    } catch (error) {
      await this.handleError(error, interaction);
    }
  },

  async handlePost(interaction) {
    const promotionTitle = await getPromotionTitle();
    const promotionBody = PROMOTION_BODY;

    // Cooldown check must happen before deferReply — once deferred publicly
    // Discord.js won't honour MessageFlags.Ephemeral on the subsequent editReply.
    const nextPromotionTime = await this.getLastPromotion();
    if (nextPromotionTime) {
      const now = dayjs();
      const nextTime = dayjs(nextPromotionTime);

      logger.debug("Cooldown check:", {
        now: now.toISOString(),
        nextTime: nextTime.toISOString(),
        diffHours: nextTime.diff(now, 'hour', true)
      });

      if (now.isBefore(nextTime)) {
        const totalMinutes = nextTime.diff(now, 'minute');
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return interaction.reply({
          content: `⚠️ Please wait ${hours} hours and ${minutes} minutes before promoting again.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    await interaction.deferReply();
    logger.info("/promote command initiated:", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      promotionTitle: promotionTitle,
      promotionLink: PROMOTION_LINK,
      hasPromotionBody: !!promotionBody
    });

    try {
      logger.info("Attempting to post to Reddit:", {
        subreddits: PROMOTION_SUBREDDITS,
        title: promotionTitle,
        link: PROMOTION_LINK,
        hasBody: !!promotionBody,
        userId: interaction.user.id
      });

      const results = [];
      for (const subredditName of PROMOTION_SUBREDDITS) {
        const result = await postToSubreddit(subredditName, promotionTitle, promotionBody);
        results.push({ subreddit: subredditName, ...result });
      }

      const succeeded = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (succeeded.length > 0) {
        const subList = succeeded.map(r => `\`r/${r.subreddit}\``).join(' and ');
        const linkLines = succeeded.map(r => `• \`r/${r.subreddit}\`: [View post](https://reddit.com${r.permalink})`);
        let description = `Your server has been promoted on ${subList}.\n\n${linkLines.join('\n')}`;
        if (failed.length > 0) {
          description += `\n\n_Could not post to:_ ${failed.map(f => `\`r/${f.subreddit}\` (${f.error})`).join('; ')}`;
        }

        const embed = new EmbedBuilder()
          .setColor(0xFF4500)
          .setTitle('Server Promotion Successful')
          .setDescription(description);

        await interaction.editReply({ embeds: [embed] });

        const mockMessage = { client: interaction.client };
        await handleReminder(mockMessage, 86400000, 'promote');
      } else {
        const errorList = failed.map(f => `r/${f.subreddit}: ${f.error}`).join('\n');
        await interaction.editReply({
          content: `⚠️ Failed to post to any subreddit:\n${errorList}`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (error) {
      logger.error("Error occurred while posting to Reddit.", { err: error });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        flags: MessageFlags.Ephemeral
      });
    }
  },

  validateConfiguration() {
    return isRedditConfigured();
  },

  async handleError(error, interaction) {
    logger.error('Error in promote command', {
      err: error,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    let errorMessage = "⚠️ An unexpected error occurred while promoting the post. Please try again later.";

    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to communicate with Reddit API.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Reddit API rate limit reached. Please try again later.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error while connecting to Reddit API.";
    } else if (error.message === "API_ACCESS_ERROR") {
      errorMessage = "⚠️ Access denied to Reddit API. Please check API configuration.";
    } else if (error.message === "FLAIR_ERROR") {
      errorMessage = "⚠️ Failed to set post flair.";
    } else if (error.message === "POST_ERROR") {
      errorMessage = "⚠️ Failed to create or update post.";
    } else if (error.message === "DATABASE_ERROR") {
      errorMessage = "⚠️ Database error occurred while processing promotion.";
    }

    try {
      await interaction.editReply({ content: errorMessage, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      logger.error('Failed to send error message.', { err: replyError });
    }
  },

  async getLastPromotion() {
    try {
      const remindAt = await getNextReminderTimeAfterCleanup('promote');
      if (remindAt) {
        logger.debug('Found next promotion time:', {
          remind_at: remindAt,
          now: dayjs().toISOString()
        });
      }
      return remindAt;
    } catch (error) {
      logger.error('Error occurred while getting next promotion time.', { err: error });
      return null;
    }
  }
}; 