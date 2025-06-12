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
const { Pool } = require('pg');
const dayjs = require('dayjs');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

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
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
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
        subreddits: [
          {
            name: 'DiscordAdvertising',
            flairId: '6c962c88-1c3c-11e9-82ef-0e886aa2f7fc'
          },
          {
            name: 'Discord_Servers_List',
            flairId: '66184c9c-3e87-11ef-95bd-3e9ca3e6dbc4'
          },
          {
            name: 'discordservers',
            flairId: '3f59062c-abd2-11ec-aab6-e262df74cc9d'
          }
        ],
        title: '🎉 [21+] Welcome to Da Frens – Real Talk, Sweaty Games, Spicy Banter, and Endless Laughs 🔥',
        content: 'https://discord.gg/dEjjqec9RM'
      };

      const redditResponses = await this.postToMultipleSubreddits(postData);
      
      if (redditResponses.error) {
        return await interaction.editReply({
          content: redditResponses.message,
          ephemeral: true
        });
      }

      await this.recordPromotion();

      const embed = this.createSuccessEmbed(redditResponses, interaction);
      await interaction.editReply({ embeds: [embed] });

      logger.info("/promote command completed successfully:", {
        userId: interaction.user.id,
        responses: redditResponses
      });

    } catch (error) {
      await this.handleError(error, interaction);
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
   * Posts content to multiple Reddit subreddits using snoowrap.
   * @param {Object} postData - The post data to submit
   * @returns {Promise<Object>} The Reddit API responses
   */
  async postToMultipleSubreddits(postData) {
    const responses = [];
    const errors = [];

    for (const subreddit of postData.subreddits) {
      try {
        const subredditInstance = await reddit.getSubreddit(subreddit.name);
        
        const flairs = await reddit.oauthRequest({
          uri: `/r/${subreddit.name}/api/link_flair`,
          method: 'GET'
        });

        logger.info(`Available flairs for ${subreddit.name}:`, flairs);

        const serverFlair = flairs.find(flair => flair.id === subreddit.flairId);

        if (!serverFlair) {
          logger.error(`Could not find specified flair for ${subreddit.name}. Available flairs:`, flairs);
          errors.push(`⚠️ Could not find the required flair for r/${subreddit.name}.`);
          continue;
        }

        logger.info(`Using flair for ${subreddit.name}:`, serverFlair);

        const submission = await reddit.oauthRequest({
          uri: '/api/submit',
          method: 'POST',
          form: {
            kind: 'link',
            sr: subreddit.name,
            title: postData.title,
            url: postData.content,
            api_type: 'json',
            flair_id: serverFlair.id,
            flair_text: serverFlair.text
          }
        });

        if (!submission || !submission.json || !submission.json.data) {
          throw new Error(`⚠️ Failed to submit post to r/${subreddit.name}.`);
        }

        const postId = submission.json.data.id;
        const permalink = `/r/${subreddit.name}/comments/${postId}`;

        responses.push({
          subreddit: subreddit.name,
          id: postId,
          permalink: permalink
        });

      } catch (error) {
        logger.error(`Error posting to r/${subreddit.name}:`, error);
        errors.push(`⚠️ Failed to post to r/${subreddit.name}.`);
      }
    }

    if (responses.length === 0) {
      return {
        error: true,
        message: "⚠️ Failed to post to any subreddits. " + errors.join(' ')
      };
    }

    return {
      error: false,
      responses: responses,
      errors: errors
    };
  },

  /**
   * Creates a success embed for the Reddit posts.
   * @param {Object} response - The Reddit API responses
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {EmbedBuilder} The formatted embed
   */
  createSuccessEmbed(response, interaction) {
    let description = 'Your server advertisement has been posted to the following subreddits:\n\n';
    
    response.responses.forEach(resp => {
      description += `• r/${resp.subreddit}: https://reddit.com${resp.permalink}\n\n`;
    });

    if (response.errors && response.errors.length > 0) {
      description += '\n⚠️ Some posts failed:\n';
      response.errors.forEach(error => {
        description += `• ${error}\n`;
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF4500)
      .setTitle('Server Promotion')
      .setDescription(description);

    embed.addFields({ 
      name: 'Status', 
      value: response.errors.length > 0 ? 'Partial Success' : 'Success' 
    });

    return embed
      .setFooter({ text: `Updated by ${interaction.user.tag}` })
      .setTimestamp();
  },

  /**
   * Handles errors during command execution.
   * @param {Error} error - The error that occurred
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   */
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
        ['promote']
      );

      const result = await pool.query(
        `SELECT remind_at::timestamp AT TIME ZONE 'UTC' as remind_at 
         FROM main.reminder_recovery 
         WHERE type = $1 
         ORDER BY remind_at DESC 
         LIMIT 1`,
        ['promote']
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
        ['promote']
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
        [reminderId, nextPromotionTime, 'promote']
      );
    } catch (error) {
      logger.error("Error recording next promotion time:", { error: error.message });
    }
  }
}; 