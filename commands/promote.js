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
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
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
      tokenExpiry = Date.now() + (response.data.expires_in * 1000 || 3600000);
      logger.debug('Successfully obtained Reddit OAuth token');
      return accessToken;
    } else {
      throw new Error('No access token in Reddit OAuth response');
    }
  } catch (error) {
    logger.error('Failed to get Reddit OAuth token:', {
      error: error.message,
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
    logger.error('Reddit API request failed:', {
      method,
      endpoint,
      error: error.message,
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
      logger.info("Attempting to post to r/findaserver:", {
        subreddit: 'findaserver',
        title: promotionTitle,
        link: PROMOTION_LINK,
        userId: interaction.user.id
      });

      // Fetch and log all available flairs
      let availableFlairs = [];
      try {
        const flairData = await redditApiRequest('GET', '/r/findaserver/api/link_flair');
        
        if (flairData && Array.isArray(flairData)) {
          availableFlairs = flairData.map((flair, index) => {
            const flairInfo = {
              index: index,
              id: flair.id || flair.flair_template_id,
              text: flair.text || flair.flair_text,
              css_class: flair.css_class || flair.flair_css_class,
              text_editable: flair.text_editable || flair.flair_text_editable
            };
            return flairInfo;
          });
        }
        
        logger.info("Available flairs for r/findaserver:", {
          flairs: availableFlairs,
          totalCount: availableFlairs.length
        });
      } catch (flairError) {
        logger.warn("Could not fetch flairs for r/findaserver:", {
          error: flairError.message,
          status: flairError.response?.status
        });
      }

      // Try to find a valid flair or post without one
      const targetFlairId = '2566b69c-2a68-11ec-a4f1-7a9ed949ab8e'; // 21+ Gaming Server
      const validFlair = availableFlairs.find(flair => flair.id === targetFlairId);
      
      // Prepare submission data
      const submissionData = {
        title: promotionTitle,
        url: PROMOTION_LINK,
        sr: 'findaserver',
        kind: 'link',
        api_type: 'json'
      };

      if (validFlair) {
        submissionData.flair_id = targetFlairId;
        logger.info("Using flair:", { flair: validFlair });
      } else {
        logger.warn("Target flair not found, posting without flair.");
      }
      
      // Submit the post
      const submissionResponse = await redditApiRequest('POST', '/api/submit', submissionData);
      
      // Reddit API returns JSON with nested structure
      let postId = null;
      let permalink = null;
      
      if (submissionResponse && submissionResponse.json) {
        if (submissionResponse.json.errors && submissionResponse.json.errors.length > 0) {
          const errorMessages = submissionResponse.json.errors.map(e => e.join(': ')).join(', ');
          throw new Error(`Reddit API error: ${errorMessages}`);
        }
        
        if (submissionResponse.json.data && submissionResponse.json.data.id) {
          postId = submissionResponse.json.data.id;
          permalink = submissionResponse.json.data.permalink;
        }
      }
      
      if (!postId || !permalink) {
        throw new Error('Failed to get post ID or permalink from Reddit response');
      }

      logger.info("Successfully posted to r/findaserver:", {
        postUrl: `https://reddit.com${permalink}`,
        postId: postId,
        title: promotionTitle,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const embed = new EmbedBuilder()
        .setColor(0xFF4500)
        .setTitle('🎉 Server Promotion Successful!')
        .setDescription(`Your server has been promoted on r/findaserver.\n\n**View your post:** [View on Reddit](${`https://reddit.com${permalink}`})`);

      await interaction.editReply({ embeds: [embed] });

      const mockMessage = { client: interaction.client };
      await handleReminder(mockMessage, 86400000, 'promote');

    } catch (error) {
      logger.error("Error posting to r/findaserver:", error);
      let errorMessage = error.message || 'Unknown error';
      
      // Parse Reddit API error responses
      if (error.response?.data) {
        const redditError = error.response.data;
        if (redditError.json?.errors) {
          const errors = redditError.json.errors;
          for (const errorArray of errors) {
            if (errorArray.length >= 2) {
              const errorType = errorArray[0];
              const errorDetail = errorArray[1];
              
              if (errorType === 'BAD_FLAIR_TEMPLATE_ID') {
                errorMessage = 'Invalid flair ID. The subreddit may have updated their flairs. Check the logs for available flairs.';
              } else if (errorType === 'RATELIMIT') {
                errorMessage = `Rate limit exceeded: ${errorDetail}. Please try again later.`;
              } else if (errorType === 'SUBREDDIT_NOEXIST') {
                errorMessage = 'Subreddit does not exist or is private.';
              } else if (errorType === 'SUBREDDIT_NOTALLOWED') {
                errorMessage = 'You are not allowed to post to this subreddit.';
              } else if (errorType === 'SUBMIT_VALIDATION_REPOST') {
                // Extract time limit from error detail if available
                const timeMatch = errorDetail.match(/within the past (\d+) (day|days|hour|hours)/i);
                if (timeMatch) {
                  const timeValue = timeMatch[1];
                  const timeUnit = timeMatch[2].toLowerCase();
                  errorMessage = `This link was already posted to r/findaserver within the past ${timeValue} ${timeUnit}. Please wait before posting again.`;
                } else {
                  errorMessage = 'This link was already posted recently. Please wait before posting again.';
                }
              } else {
                errorMessage = `Reddit API error: ${errorType} - ${errorDetail}`;
              }
              break;
            }
          }
        }
      } else if (errorMessage.includes('SUBMIT_VALIDATION_REPOST')) {
        // Handle repost error from thrown error message
        const timeMatch = errorMessage.match(/within the past (\d+) (day|days|hour|hours)/i);
        if (timeMatch) {
          const timeValue = timeMatch[1];
          const timeUnit = timeMatch[2].toLowerCase();
          errorMessage = `This link was already posted to r/findaserver within the past ${timeValue} ${timeUnit}. Please wait before posting again.`;
        } else {
          errorMessage = 'This link was already posted recently. Please wait before posting again.';
        }
      } else if (errorMessage.includes('BAD_FLAIR_TEMPLATE_ID')) {
        errorMessage = 'Invalid flair ID. The subreddit may have updated their flairs. Check the logs for available flairs.';
      } else if (errorMessage.includes('RATELIMIT')) {
        errorMessage = 'Rate limit exceeded. Please try again later.';
      } else if (errorMessage.includes('SUBREDDIT_NOEXIST')) {
        errorMessage = 'Subreddit does not exist or is private.';
      } else if (errorMessage.includes('SUBREDDIT_NOTALLOWED')) {
        errorMessage = 'You are not allowed to post to this subreddit.';
      }
      
      await interaction.editReply({
        content: `⚠️ Failed to post to r/findaserver: ${errorMessage}`,
        flags: MessageFlags.Ephemeral
      });
    }
  },

  validateConfiguration() {
    return !!(config.redditClientId && config.redditClientSecret && config.redditUsername && config.redditPassword);
  },

  async handleError(error, interaction) {
    logger.error('Error in promote command:', {
      error: error.message,
      stack: error.stack,
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
      logger.error('Failed to send error message:', {
        error: replyError.message,
        stack: replyError.stack
      });
    }
  },

  async getLastPromotion() {
    try {
      // Clean up expired and invalid reminders
      const reminderIds = await reminderKeyv.get('reminders:promote:list') || [];
      const now = new Date();
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
        const remindAt = reminder.remind_at instanceof Date 
          ? reminder.remind_at 
          : new Date(reminder.remind_at);
        
        // Check if the date is valid
        if (isNaN(remindAt.getTime())) {
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
        logger.debug(`Cleaned up ${idsToRemove.length} expired/invalid promote reminder(s).`);
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
      logger.error("Error getting next promotion time:", { error: error.message });
      return null;
    }
  }
}; 