const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const snoowrap = require('snoowrap');
const config = require('../config');
const { Pool } = require('pg');
const dayjs = require('dayjs');
const { handleReminder } = require('../utils/reminderUtils');

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

const PROMOTION_TITLE = "[21+]🎉 Congrats! You've found Da Frens! ✨ A group of Frens with few restrictions... usually bantering or playing games, come join us!";
const PROMOTION_LINK = 'https://discord.gg/dafrens';

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
          ephemeral: true
        });
      }

      await this.handlePost(interaction);

    } catch (error) {
      await this.handleError(error, interaction);
    }
  },

  async handlePost(interaction) {
    await interaction.deferReply();
    logger.info("/promote command initiated:", { 
      userId: interaction.user.id, 
      guildId: interaction.guildId 
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
          ephemeral: true
        });
      }
    }

    try {
      logger.info("Attempting to post to r/DiscordAdvertising...");
      
      const submission = await reddit.getSubreddit('DiscordAdvertising').submitLink({
        title: PROMOTION_TITLE,
        url: PROMOTION_LINK,
        flairId: '6c962c88-1c3c-11e9-82ef-0e886aa2f7fc'
      });
      const post = await submission.fetch();

      logger.info("Successfully posted to r/DiscordAdvertising");
      
      const embed = new EmbedBuilder()
        .setColor(0xFF4500)
        .setTitle('🎉 Server Promotion Successful!')
        .setDescription('Your server has been promoted on r/DiscordAdvertising.')
        .addFields({
          name: 'Post Link',
          value: `[View Post](https://reddit.com${post.permalink})`
        })
        .setFooter({ 
          text: 'Next promotion available in 24 hours' 
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      const mockMessage = { client: interaction.client };
      await handleReminder(mockMessage, 86400000, 'promote');

    } catch (error) {
      logger.error("Error posting to r/DiscordAdvertising:", error);
      let errorMessage = error.message || 'Unknown error';
      
      if (errorMessage.includes('BAD_FLAIR_TEMPLATE_ID')) {
        errorMessage = 'Invalid flair ID. The subreddit may have updated their flairs.';
      } else if (errorMessage.includes('RATELIMIT')) {
        errorMessage = 'Rate limit exceeded. Please try again later.';
      }
      
      await interaction.editReply({
        content: `⚠️ Failed to post to r/DiscordAdvertising: ${errorMessage}`,
        ephemeral: true
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
  }
}; 