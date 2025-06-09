/**
/**
 * Promote command module for Reddit post promotion.
 * Handles posting server advertisements to r/findaserver using the Reddit API.
 * @module commands/promote
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const snoowrap = require('snoowrap');
const config = require('../config');
const { logError } = require('../errors');
const { Pool } = require('pg');
const dayjs = require('dayjs');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

const REDDIT_EMBED_COLOR = 0xFF4500;
const TARGET_SUBREDDIT = 'DiscordAdvertising';
const COOLDOWN_HOURS = 24;
const REMINDER_TYPE = 'promote';

const SERVER_TITLE = '🎉 [21+] Welcome to Da Frens – Real Talk, Sweaty Games, Spicy Banter, and Endless Laughs 🔥';
const SERVER_INVITE = 'https://discord.gg/dafrens';

/**
 * Error messages specific to the Promote command.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    CONFIG_MISSING: "⚠️ This command is not properly configured. Please contact an administrator.",
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while promoting the server.",
    API_ERROR: "⚠️ Failed to post to Reddit. Please try again later.",
    API_RATE_LIMIT: "⚠️ Reddit API rate limit reached. Please try again in a few moments.",
    API_NETWORK_ERROR: "⚠️ Network error occurred. Please check your internet connection.",
    API_ACCESS_DENIED: "⚠️ Reddit API access denied. Please check API configuration.",
    FLAIR_NOT_FOUND: "⚠️ Could not find the required flair. Please try again later or contact support.",
    POST_FAILED: "⚠️ Failed to submit post to Reddit.",
    COOLDOWN_ACTIVE: "⚠️ Please wait before promoting again.",
    DATABASE_ERROR: "⚠️ Failed to record promotion time. Please try again later."
};

const reddit = new snoowrap({
  userAgent: 'Discord Bot Server Promoter',
  clientId: config.redditClientId,
  clientSecret: config.redditClientSecret,
  username: config.redditUsername,
  password: config.redditPassword
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Post your server advertisement to r/findaserver.'),

  /**
   * Executes the promote command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the Reddit API request fails
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }

      await interaction.deferReply();
      logger.info("/promote command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // Check for cooldown
      const lastPromotion = await this.getLastPromotion();
      if (lastPromotion) {
        const timeSinceLastPromotion = dayjs().diff(dayjs(lastPromotion), 'hour');
        if (timeSinceLastPromotion < COOLDOWN_HOURS) {
          const hoursRemaining = COOLDOWN_HOURS - timeSinceLastPromotion;
          return await interaction.editReply({
            content: `⏰ Please wait ${hoursRemaining.toFixed(1)} hours before promoting again.`,
            ephemeral: true
          });
        }
      }

      const postData = {
        subreddit: TARGET_SUBREDDIT,
        title: SERVER_TITLE,
        content: SERVER_INVITE
      };

      const redditResponse = await this.postToReddit(postData);
      
      if (redditResponse.error) {
        return await interaction.editReply({
          content: redditResponse.message,
          ephemeral: true
        });
      }

      // Record the promotion time
      await this.recordPromotion();

      const embed = this.createSuccessEmbed(redditResponse);
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Validates the Reddit API configuration.
   * @returns {boolean} True if configuration is valid
   */
  validateConfiguration() {
    return !!(config.redditClientId && config.redditClientSecret && config.redditUsername && config.redditPassword);
  },

  /**
   * Posts content to Reddit using snoowrap.
   * @param {Object} postData - The post data to submit
   * @returns {Promise<Object>} The Reddit API response
   */
  async postToReddit(postData) {
    try {
      const subreddit = await reddit.getSubreddit(postData.subreddit);
      
      const flairs = await reddit.oauthRequest({
        uri: `/r/${postData.subreddit}/api/link_flair`,
        method: 'GET'
      });

      logger.info('Available flairs:', flairs);

      const serverFlair = flairs.find(flair => 
        flair.id === '6c962c88-1c3c-11e9-82ef-0e886aa2f7fc'
      );

      if (!serverFlair) {
        logger.error('Could not find specified flair. Available flairs:', flairs);
        return {
          error: true,
          message: 'Could not find the required flair. Please try again later or contact support.'
        };
      }

      logger.info("Using flair:", serverFlair);

      const submission = await reddit.oauthRequest({
        uri: '/api/submit',
        method: 'POST',
        form: {
          kind: 'link',
          sr: postData.subreddit,
          title: postData.title,
          url: postData.content,
          api_type: 'json',
          flair_id: serverFlair.id,
          flair_text: serverFlair.text
        }
      });

      if (!submission || !submission.json || !submission.json.data) {
        throw new Error('Failed to submit post to Reddit');
      }

      const postId = submission.json.data.id;
      const permalink = submission.json.data.permalink;

      return {
        id: postId,
        permalink: permalink
      };

    } catch (error) {
      logger.error('Error posting to Reddit:', error);
      return {
        error: true,
        message: 'Failed to post to Reddit. Please check your credentials and try again.'
      };
    }
  },

  /**
   * Creates a success embed for the Reddit post.
   * @param {Object} response - The Reddit API response
   * @returns {EmbedBuilder} The formatted embed
   */
  createSuccessEmbed(response) {
    const embed = new EmbedBuilder()
      .setColor(REDDIT_EMBED_COLOR)
      .setTitle('✅ Server Advertisement Posted')
      .setDescription('Your server advertisement has been posted to r/findaserver.');

    if (response && response.id) {
      embed.addFields({ 
        name: 'Post ID', 
        value: response.id.toString() 
      });
    }

    embed.addFields({ 
      name: 'Status', 
      value: 'Success' 
    });

    if (response && response.permalink) {
      embed.addFields({ 
        name: 'View Post', 
        value: `[Click here](https://reddit.com${response.permalink})` 
      });
    }

    return embed.setTimestamp();
  },

  /**
   * Handles errors during command execution.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logger.error('Error in promote command:', error);
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    } else if (error.message === "API_ACCESS_DENIED") {
      errorMessage = ERROR_MESSAGES.API_ACCESS_DENIED;
    } else if (error.message === "FLAIR_NOT_FOUND") {
      errorMessage = ERROR_MESSAGES.FLAIR_NOT_FOUND;
    } else if (error.message === "POST_FAILED") {
      errorMessage = ERROR_MESSAGES.POST_FAILED;
    } else if (error.message === "DATABASE_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_ERROR;
    }
    
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: errorMessage,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: errorMessage,
        ephemeral: true
      });
    }
  },

  /**
   * Gets the timestamp of the last promotion.
   * @async
   * @function getLastPromotion
   * @returns {Promise<string|null>} The ISO timestamp of the last promotion or null if none found
   */
  async getLastPromotion() {
    try {
      const result = await pool.query(
        `SELECT remind_at FROM main.reminder_recovery 
         WHERE type = $1
         ORDER BY remind_at DESC 
         LIMIT 1`,
        [REMINDER_TYPE]
      );
      return result.rows.length > 0 ? result.rows[0].remind_at : null;
    } catch (error) {
      logger.error('Error getting last promotion time:', error);
      return null;
    }
  },

  /**
   * Records the current promotion time.
   * @async
   * @function recordPromotion
   */
  async recordPromotion() {
    try {
      const reminderId = require('crypto').randomUUID();
      const nextPromotionTime = dayjs().add(COOLDOWN_HOURS, 'hour').toISOString();
      
      await pool.query(
        `INSERT INTO main.reminder_recovery (reminder_id, remind_at, type) 
         VALUES ($1, $2, $3)`,
        [reminderId, nextPromotionTime, REMINDER_TYPE]
      );
      logger.debug('Recorded next promotion time:', { 
        reminderId,
        nextPromotionTime 
      });
    } catch (error) {
      logger.error('Error recording promotion time:', error);
    }
  }
}; 