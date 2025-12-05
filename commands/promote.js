const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const snoowrap = require('snoowrap');
const config = require('../config');
const dayjs = require('dayjs');
const { handleReminder, getLatestReminderData } = require('../utils/reminderUtils');
const Keyv = require('keyv');
const KeyvSqlite = require('@keyv/sqlite');
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
      guildId: interaction.guildId,
      promotionTitle: PROMOTION_TITLE,
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
          ephemeral: true
        });
      }
    }

    try {
      logger.info("Attempting to post to r/findaserver", {
        subreddit: 'findaserver',
        title: PROMOTION_TITLE,
        link: PROMOTION_LINK,
        userId: interaction.user.id
      });

      // Fetch and log all available flairs
      let availableFlairs = [];
      try {
        const subreddit = reddit.getSubreddit('findaserver');
        const flairs = await subreddit.getLinkFlairTemplates();
        
        availableFlairs = flairs.map((flair, index) => {
          const flairData = {
            index: index,
            id: flair.flair_template_id,
            text: flair.flair_text,
            css_class: flair.flair_css_class,
            text_editable: flair.flair_text_editable
          };
          return flairData;
        });
        
        logger.info("Available flairs for r/findaserver:", {
          flairs: availableFlairs,
          totalCount: availableFlairs.length
        });
      } catch (flairError) {
        logger.warn("Could not fetch flairs for r/findaserver:", flairError);
      }

      // Try to find a valid flair or post without one
      const targetFlairId = '2566b69c-2a68-11ec-a4f1-7a9ed949ab8e'; // 21+ Gaming Server
      const validFlair = availableFlairs.find(flair => flair.id === targetFlairId);
      
      let submissionOptions = {
        title: PROMOTION_TITLE,
        url: PROMOTION_LINK
      };

      if (validFlair) {
        submissionOptions.flairId = targetFlairId;
        logger.info("Using flair:", { flair: validFlair });
      } else {
        logger.warn("Target flair not found, posting without flair");
      }
      
      const submission = await reddit.getSubreddit('findaserver').submitLink(submissionOptions);
      const post = await submission.fetch();
      const permalink = await post.permalink;

      logger.info("Successfully posted to r/findaserver", {
        postUrl: `https://reddit.com${permalink}`,
        postId: post.id,
        title: PROMOTION_TITLE,
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
      
      if (errorMessage.includes('BAD_FLAIR_TEMPLATE_ID')) {
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
      // Clean up expired reminders
      const reminderIds = await reminderKeyv.get('reminders:promote:list') || [];
      const now = new Date();
      for (const id of reminderIds) {
        const reminder = await reminderKeyv.get(`reminder:${id}`);
        if (reminder && reminder.remind_at) {
          const remindAt = new Date(reminder.remind_at);
          if (remindAt <= now) {
            await reminderKeyv.delete(`reminder:${id}`);
            const list = reminderIds.filter(rid => rid !== id);
            await reminderKeyv.set('reminders:promote:list', list);
          }
        }
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