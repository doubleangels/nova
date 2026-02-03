const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const dayjs = require('dayjs');
const { handleReminder, getLatestReminderData } = require('../utils/reminderUtils');
const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Keyv for reminder storage using SQLite (same database as main)
const sqlitePath = path.join(dataDir, 'database.sqlite');
const reminderKeyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
  }),
  namespace: 'nova_reminders'
});

const PROMOTION_LINK = 'https://discord.gg/j5sfQtCVSU';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_OAUTH_BASE = 'https://www.reddit.com/api/v1';

/** Subreddits to post promotions to (display name for sr param; Reddit API accepts case-insensitive) */
const PROMOTION_SUBREDDITS = ['discordservers_', 'Discord_Servers_List'];

// Cache for OAuth token
let accessToken = null;
let tokenExpiry = null;

/**
 * Gets an OAuth access token from Reddit
 * Uses username/password authentication (script type)
 * @returns {Promise<string>} The access token
 */
async function getRedditAccessToken() {
  // Return cached token if still valid (with 5 minute buffer)
  if (accessToken && tokenExpiry && dayjs().valueOf() < tokenExpiry - 300000) {
    return accessToken;
  }

  try {
    const auth = Buffer.from(`${config.redditClientId}:${config.redditClientSecret}`).toString('base64');

    const response = await axios.post(
      `${REDDIT_OAUTH_BASE}/access_token`,
      new URLSearchParams({
        grant_type: 'password',
        username: config.redditUsername,
        password: config.redditPassword
      }),
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Discord Bot Server Promoter (Node.js)'
        }
      }
    );

    if (response.data && response.data.access_token) {
      accessToken = response.data.access_token;
      // Reddit tokens typically last 1 hour, cache for 55 minutes
      tokenExpiry = dayjs().valueOf() + (response.data.expires_in * 1000 || 3600000);
      logger.debug('Successfully obtained Reddit OAuth token');
      return accessToken;
    } else {
      throw new Error('No access token in Reddit OAuth response');
    }
  } catch (error) {
    logger.error('Failed to get Reddit OAuth token', {
      err: error,
      status: error.response?.status,
      data: error.response?.data
    });
    throw new Error('Failed to authenticate with Reddit API');
  }
}

/**
 * Makes an authenticated request to Reddit API
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} endpoint - API endpoint (e.g., '/r/findaserver/api/link_flair')
 * @param {object} data - Request body data (for POST requests) - will be form-encoded
 * @returns {Promise<object>} API response
 */
async function redditApiRequest(method, endpoint, data = null) {
  const token = await getRedditAccessToken();

  const config = {
    method,
    url: `${REDDIT_API_BASE}${endpoint}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Discord Bot Server Promoter (Node.js)'
    }
  };

  if (data && (method === 'POST' || method === 'PUT')) {
    // Reddit API expects form-encoded data, not JSON
    config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    config.data = new URLSearchParams(data).toString();
  }

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    logger.error('Reddit API request failed', {
      err: error,
      method,
      endpoint,
      status: error.response?.status,
      data: error.response?.data
    });

    // If token expired, clear cache and retry once
    if (error.response?.status === 401 && accessToken) {
      logger.debug('Token expired, clearing cache and retrying');
      accessToken = null;
      tokenExpiry = null;
      return redditApiRequest(method, endpoint, data);
    }

    throw error;
  }
}

/**
 * Gets the promotion title
 * @returns {Promise<string>} The promotion title
 */
async function getPromotionTitle() {
  return "A 21+ chaos-friendly Discord for banter, games, and late-night oversharing. Be active, match the vibe, or don't stay long.";
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

/**
 * Post promotion to a single subreddit
 * @param {string} subredditName - Subreddit name (e.g. 'discordservers_')
 * @param {string} promotionTitle - Post title
 * @returns {Promise<{ success: boolean, permalink?: string, error?: string }>}
 */
async function postToSubreddit(subredditName, promotionTitle) {
  let flairId = null;
  try {
    const flairData = await redditApiRequest('GET', `/r/${subredditName}/api/link_flair`);
    if (flairData && Array.isArray(flairData) && flairData.length > 0) {
      const preferred = flairData.find(f => (f.text || f.flair_text || '').toLowerCase().includes('gaming') || (f.text || f.flair_text || '').toLowerCase().includes('21'));
      const first = flairData[0];
      const flair = preferred || first;
      flairId = flair.id || flair.flair_template_id;
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
    await interaction.deferReply();
    const promotionTitle = await getPromotionTitle();
    logger.info("/promote command initiated:", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      promotionTitle: promotionTitle,
      promotionLink: PROMOTION_LINK
    });

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
        return await interaction.editReply({
          content: `⏰ Please wait ${hours} hours and ${minutes} minutes before promoting again.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    try {
      const promotionTitle = await getPromotionTitle();
      logger.info("Attempting to post to Reddit:", {
        subreddits: PROMOTION_SUBREDDITS,
        title: promotionTitle,
        link: PROMOTION_LINK,
        userId: interaction.user.id
      });

      const results = [];
      for (const subredditName of PROMOTION_SUBREDDITS) {
        const result = await postToSubreddit(subredditName, promotionTitle);
        results.push({ subreddit: subredditName, ...result });
      }

      const succeeded = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (succeeded.length > 0) {
        const linkLines = succeeded.map(r => `**r/${r.subreddit}:** [View post](https://reddit.com${r.permalink})`);
        let description = `Your server has been promoted on ${succeeded.map(r => `r/${r.subreddit}`).join(' and ')}.\n\n${linkLines.join('\n')}`;
        if (failed.length > 0) {
          description += `\n\n_Could not post to:_ ${failed.map(f => `r/${f.subreddit} (${f.error})`).join('; ')}`;
        }

        const embed = new EmbedBuilder()
          .setColor(0xFF4500)
          .setTitle('🎉 Server Promotion Successful!')
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
        content: `⚠️ An unexpected error occurred: ${error.message || 'Unknown error'}`,
        flags: MessageFlags.Ephemeral
      });
    }
  },

  validateConfiguration() {
    return !!(config.redditClientId && config.redditClientSecret && config.redditUsername && config.redditPassword);
  },

  async handleError(error, interaction) {
    logger.error('Error in promote command', {
      err: error,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    let errorMessage = "⚠️ An unexpected error occurred while promoting the post.";

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
      await interaction.editReply({ content: errorMessage });
    } catch (replyError) {
      logger.error('Failed to send error message.', { err: replyError });
    }
  },

  async getLastPromotion() {
    try {
      // Clean up expired and invalid reminders
      const reminderIds = await reminderKeyv.get('reminders:promote:list') || [];
      const now = dayjs();
      const idsToRemove = [];

      // Collect all expired and invalid reminder IDs first
      for (const id of reminderIds) {
        const reminder = await reminderKeyv.get(`reminder:${id}`);

        if (!reminder) {
          // Reminder data missing, mark for cleanup
          idsToRemove.push(id);
          continue;
        }

        if (!reminder.remind_at) {
          // Invalid reminder data (missing remind_at), mark for cleanup
          idsToRemove.push(id);
          continue;
        }

        // Handle both Date objects and ISO strings
        const remindAt = dayjs(reminder.remind_at);

        // Check if the date is valid
        if (!remindAt.isValid()) {
          // Invalid date, mark for cleanup
          idsToRemove.push(id);
          continue;
        }

        // Mark expired reminders for cleanup
        if (remindAt <= now) {
          idsToRemove.push(id);
        }
      }

      // Remove all expired/invalid reminders and update the list once
      if (idsToRemove.length > 0) {
        for (const id of idsToRemove) {
          await reminderKeyv.delete(`reminder:${id}`);
        }
        const remainingIds = reminderIds.filter(rid => !idsToRemove.includes(rid));
        await reminderKeyv.set('reminders:promote:list', remainingIds);
        logger.debug('Cleaned up expired/invalid promote reminders.', { count: idsToRemove.length });
      }

      // Get latest reminder
      const latestReminder = await getLatestReminderData('promote');

      if (latestReminder && latestReminder.remind_at) {
        logger.debug("Found next promotion time:", {
          remind_at: latestReminder.remind_at,
          now: dayjs().toISOString()
        });
        return latestReminder.remind_at;
      }

      return null;
    } catch (error) {
      logger.error("Error occurred while getting next promotion time.", { err: error });
      return null;
    }
  }
}; 