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

const PROMOTE_TARGET_SUBREDDIT = 'DiscordAdvertising';
const PROMOTE_COOLDOWN_HOURS = 24;
const PROMOTE_REMINDER_TYPE = 'promote';
const PROMOTE_SERVER_TITLE = '🎉 [21+] Welcome to Da Frens – Real Talk, Sweaty Games, Spicy Banter, and Endless Laughs 🔥';
const PROMOTE_SERVER_INVITE = 'https://discord.gg/dafrens';

const PROMOTE_EMBED_COLOR = 0xFF4500;

const PROMOTE_ERROR_CONFIG_MISSING = "⚠️ This command is not properly configured. Please contact an administrator.";
const PROMOTE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while promoting the server.";
const PROMOTE_ERROR_API = "⚠️ Failed to post to Reddit. Please try again later.";
const PROMOTE_ERROR_RATE_LIMIT = "⚠️ Reddit API rate limit reached. Please try again in a few moments.";
const PROMOTE_ERROR_NETWORK = "⚠️ Network error occurred. Please check your internet connection.";
const PROMOTE_ERROR_API_ACCESS = "⚠️ Reddit API access denied. Please check API configuration.";
const PROMOTE_ERROR_FLAIR = "⚠️ Could not find the required flair. Please try again later or contact support.";
const PROMOTE_ERROR_POST = "⚠️ Failed to submit post to Reddit.";
const PROMOTE_ERROR_COOLDOWN = "⚠️ Please wait before promoting again.";
const PROMOTE_ERROR_DATABASE = "⚠️ Failed to record promotion time. Please try again later.";

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
          content: PROMOTE_ERROR_CONFIG_MISSING,
          ephemeral: true
        });
      }

      await interaction.deferReply();
      logger.info("/promote command initiated:", { 
        userId: interaction.user.id, 
        guildId: interaction.guildId 
      });

      // Check for cooldown
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
            ephemeral: true
          });
        }
      }

      const postData = {
        subreddit: PROMOTE_TARGET_SUBREDDIT,
        title: PROMOTE_SERVER_TITLE,
        content: PROMOTE_SERVER_INVITE
      };

      const redditResponse = await this.postToReddit(postData);
      
      if (redditResponse.error) {
        return await interaction.editReply({
          content: redditResponse.message,
          ephemeral: true
        });
      }

      await this.recordPromotion();

      const embed = this.createSuccessEmbed(redditResponse);
      await interaction.editReply({ embeds: [embed] });

      logger.info("Promote command completed successfully:", {
        userId: interaction.user.id,
        postId: redditResponse.id
      });

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
          message: PROMOTE_ERROR_FLAIR
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
        throw new Error(PROMOTE_ERROR_POST);
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
        message: PROMOTE_ERROR_API
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
      .setColor(PROMOTE_EMBED_COLOR)
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
    
    let errorMessage = PROMOTE_ERROR_UNEXPECTED;
    
    if (error.message === PROMOTE_ERROR_API) {
      errorMessage = PROMOTE_ERROR_API;
    } else if (error.message === PROMOTE_ERROR_RATE_LIMIT) {
      errorMessage = PROMOTE_ERROR_RATE_LIMIT;
    } else if (error.message === PROMOTE_ERROR_NETWORK) {
      errorMessage = PROMOTE_ERROR_NETWORK;
    } else if (error.message === PROMOTE_ERROR_API_ACCESS) {
      errorMessage = PROMOTE_ERROR_API_ACCESS;
    } else if (error.message === PROMOTE_ERROR_FLAIR) {
      errorMessage = PROMOTE_ERROR_FLAIR;
    } else if (error.message === PROMOTE_ERROR_POST) {
      errorMessage = PROMOTE_ERROR_POST;
    } else if (error.message === PROMOTE_ERROR_DATABASE) {
      errorMessage = PROMOTE_ERROR_DATABASE;
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
   * Gets the timestamp of the next allowed promotion.
   * @async
   * @function getLastPromotion
   * @returns {Promise<string|null>} The ISO timestamp of the next allowed promotion or null if none found
   */
  async getLastPromotion() {
    try {
      await pool.query(
        `DELETE FROM main.reminder_recovery 
         WHERE type = $1 
         AND remind_at <= NOW()`,
        [PROMOTE_REMINDER_TYPE]
      );

      const result = await pool.query(
        `SELECT remind_at::timestamp AT TIME ZONE 'UTC' as remind_at 
         FROM main.reminder_recovery 
         WHERE type = $1 
         ORDER BY remind_at DESC 
         LIMIT 1`,
        [PROMOTE_REMINDER_TYPE]
      );

      if (result.rows.length > 0) {
        logger.debug("Found next promotion time:", {
          remind_at: result.rows[0].remind_at,
          now: dayjs().toISOString()
        });
      }

      return result.rows.length > 0 ? result.rows[0].remind_at : null;
    } catch (error) {
      logger.error("Error getting next promotion time:", { error: error.message });
      return null;
    }
  },

  /**
   * Records the next allowed promotion time (24 hours from now).
   * @async
   * @function recordPromotion
   */
  async recordPromotion() {
    try {
      await pool.query(
        `DELETE FROM main.reminder_recovery 
         WHERE type = $1`,
        [PROMOTE_REMINDER_TYPE]
      );

      const reminderId = require('crypto').randomUUID();
      const nextPromotionTime = dayjs().add(24, 'hour').toISOString();
      
      logger.debug("Recording next promotion time:", {
        reminderId,
        nextPromotionTime,
        now: dayjs().toISOString()
      });

      await pool.query(
        `INSERT INTO main.reminder_recovery (reminder_id, remind_at, type) 
         VALUES ($1, $2::timestamp AT TIME ZONE 'UTC', $3)`,
        [reminderId, nextPromotionTime, PROMOTE_REMINDER_TYPE]
      );
    } catch (error) {
      logger.error("Error recording next promotion time:", { error: error.message });
    }
  }
}; 