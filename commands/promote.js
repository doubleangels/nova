const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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

const PROMOTION_TITLE = "[21+]🎉 Congrats! You've found Da Frens! ✨ A group of Frens with few restrictions... usually bantering or playing games, come join us!";
const PROMOTION_LINK = 'https://discord.gg/dEjjqec9RM';

/**
 * Command module for promoting users to moderator status.
 * Manages moderator role assignment and permissions.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Post your server advertisement to various subreddits.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('post')
        .setDescription('Post your server advertisement to Reddit.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('View available post flairs for a subreddit.')
        .addStringOption(option =>
          option
            .setName('subreddit')
            .setDescription('The name of the subreddit to check flairs for.')
            .setRequired(true)
        )
    )
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

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'setup') {
        await this.handleSetup(interaction);
      } else if (subcommand === 'post') {
        await this.handlePost(interaction);
      }

    } catch (error) {
      await this.handleError(error, interaction);
    }
  },

  async handleSetup(interaction) {
    await interaction.deferReply();
    logger.info("/promote setup command initiated:", { 
      userId: interaction.user.id, 
      guildId: interaction.guildId 
    });

    const subredditName = interaction.options.getString('subreddit');
    
    try {
      // First check if the subreddit exists and is accessible
      const subredditInstance = await reddit.getSubreddit(subredditName);
      
      try {
        // Try to get subreddit info to check if we have proper access
        await subredditInstance.fetch();
        
        try {
          const flairs = await reddit.oauthRequest({
            uri: `/r/${subredditName}/api/link_flair`,
            method: 'GET'
          });

          logger.info(`Retrieved flairs for ${subredditName}:`, flairs);

          if (!flairs || Object.keys(flairs).length === 0) {
            const embed = new EmbedBuilder()
              .setColor(0xFF4500)
              .setTitle(`Available Flairs for r/${subredditName}`)
              .setDescription('No flairs found for this subreddit.');
            
            await interaction.editReply({ embeds: [embed] });
            return;
          }

          // Convert flairs object to array and sort by text
          const flairArray = Object.values(flairs).sort((a, b) => 
            (a.text || '').localeCompare(b.text || '')
          );

          // Split flairs into chunks of 25 (Discord's field limit)
          const chunks = [];
          for (let i = 0; i < flairArray.length; i += 25) {
            chunks.push(flairArray.slice(i, i + 25));
          }

          const embeds = chunks.map((chunk, index) => {
            const embed = new EmbedBuilder()
              .setColor(0xFF4500)
              .setTitle(`Available Flairs for r/${subredditName} (Page ${index + 1}/${chunks.length})`);

            if (index === 0) {
              embed.setDescription('Here are the available post flairs and their IDs:');
            } else {
              embed.setDescription(`Continued from previous page...`);
            }

            chunk.forEach(flair => {
              embed.addFields({
                name: flair.text || 'No Text',
                value: `ID: \`${flair.id}\`\nMod Only: ${flair.mod_only ? 'Yes' : 'No'}`
              });
            });

            return embed;
          });

          await interaction.editReply({ embeds });

        } catch (flairError) {
          logger.error(`Error fetching flairs for r/${subredditName}:`, flairError);
          
          if (flairError.statusCode === 403) {
            await interaction.editReply({
              content: `⚠️ Unable to fetch flairs for r/${subredditName}. This could be because:\n` +
                      `• The subreddit doesn't allow flair access to non-moderators\n` +
                      `• The subreddit has disabled flairs\n` +
                      `• The subreddit is private or restricted\n` +
                      `• The subreddit requires authentication to view flairs\n\n` +
                      `To resolve this:\n` +
                      `1. Check if you can view flairs manually on the subreddit\n` +
                      `2. If you're a moderator, ensure flairs are enabled in subreddit settings\n` +
                      `3. Try using a different subreddit that allows public flair access\n` +
                      `4. Contact the subreddit moderators if you need flair access`,
              ephemeral: true
            });
          } else {
            await interaction.editReply({
              content: `⚠️ Failed to fetch flairs for r/${subredditName}. Please try again later.`,
              ephemeral: true
            });
          }
        }

      } catch (subredditError) {
        logger.error(`Error accessing subreddit r/${subredditName}:`, subredditError);
        
        if (subredditError.statusCode === 403) {
          await interaction.editReply({
            content: `⚠️ Unable to access r/${subredditName}. The subreddit may be:\n` +
                    `• Private\n` +
                    `• Restricted\n` +
                    `• Requiring approval to join\n\n` +
                    `Please check if you can access the subreddit manually.`,
            ephemeral: true
          });
        } else if (subredditError.statusCode === 404) {
          await interaction.editReply({
            content: `⚠️ The subreddit r/${subredditName} does not exist.`,
            ephemeral: true
          });
        } else {
          await interaction.editReply({
            content: `⚠️ Failed to access r/${subredditName}. Please check if the subreddit name is correct.`,
            ephemeral: true
          });
        }
      }

    } catch (error) {
      logger.error(`Unexpected error in setup command:`, error);
      await interaction.editReply({
        content: `⚠️ An unexpected error occurred while trying to access r/${subredditName}. Please try again later.`,
        ephemeral: true
      });
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

    const postData = {
      subreddits: [
        {
          name: 'DiscordAdvertising',
          flairId: '6c962c88-1c3c-11e9-82ef-0e886aa2f7fc'
        },
        {
          name: 'discordservers_',
          flairId: '3f59062c-abd2-11ec-aab6-e262df74cc9d'
        },
        {
          name: 'findaserver',
          flairId: 'da3bbd30-122c-11ee-8fc7-460118f7beb8'
        },
        {
          name: 'PromoteDiscordServer',
          flairId: '9f208758-6e8a-11ed-aa22-d2a70759c546'
        },
        {
          name: 'DiscordAdults',
          flairId: 'c535d438-4639-11ef-9ddd-aa882aff8604'
        }
      ]
    };

    // Send initial response
    const initialEmbed = new EmbedBuilder()
      .setColor(0xFFFF00)
      .setTitle('🔄 Server Promotion Started')
      .setDescription('Your server promotion is being processed in the background.\nYou will be notified when all posts are complete.')
      .setTimestamp();

    await interaction.editReply({ embeds: [initialEmbed] });

    // Start background posting process
    this.postToMultipleSubreddits(postData)
      .then(async (response) => {
        const finalEmbed = this.createSuccessEmbed(response, interaction);
        await interaction.followUp({ embeds: [finalEmbed] });
      })
      .catch(async (error) => {
        logger.error("Error in background posting:", error);
        await interaction.followUp({
          content: "⚠️ An error occurred while posting to subreddits. Please check the logs for details.",
          ephemeral: true
        });
      });

    // Record the promotion time immediately
    await this.recordPromotion();
  },

  validateConfiguration() {
    return !!(config.redditClientId && config.redditClientSecret && config.redditUsername && config.redditPassword);
  },

  async postToMultipleSubreddits(postData) {
    const results = [];
    const errors = [];

    for (const subreddit of postData.subreddits) {
      try {
        logger.info(`Attempting to post to r/${subreddit.name}...`);
        
        // First try to get available flairs
        const flairs = await reddit.oauthRequest({
          uri: `/r/${subreddit.name}/api/link_flair`,
          method: 'GET'
        }).catch(error => {
          logger.warn(`Could not fetch flairs for r/${subreddit.name}:`, error);
          return null;
        });

        // If we can't get flairs, try posting without a flair
        const flairId = flairs ? subreddit.flairId : null;
        
        const response = await reddit.getSubreddit(subreddit.name).submitLink({
          title: PROMOTION_TITLE,
          url: PROMOTION_LINK,
          ...(flairId && { flairId })
        });

        logger.info(`Successfully posted to r/${subreddit.name}`);
        results.push({
          subreddit: subreddit.name,
          postId: response.id,
          url: response.url
        });

        // Add a random delay between 2-3 minutes before the next post
        const delay = Math.floor(Math.random() * (180000 - 120000) + 120000); // Random delay between 2-3 minutes
        logger.info(`Waiting ${Math.round(delay/1000)} seconds before next post...`);
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        logger.error(`Error posting to r/${subreddit.name}:`, error);
        let errorMessage = error.message || 'Unknown error';
        
        // Handle specific error cases
        if (errorMessage.includes('BAD_FLAIR_TEMPLATE_ID')) {
          errorMessage = 'Invalid flair ID. The subreddit may have updated their flairs.';
        } else if (errorMessage.includes('RATELIMIT')) {
          errorMessage = 'Rate limit exceeded. Please try again later.';
        }
        
        errors.push({
          subreddit: subreddit.name,
          error: errorMessage
        });
      }
    }

    return { results, errors };
  },

  createSuccessEmbed(response, interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎉 Server Promotion Successful!')
      .setDescription('Your server has been promoted to the following subreddits:')
      .setTimestamp();

    // Add successful posts
    if (response.results && response.results.length > 0) {
      const successList = response.results.map(result => 
        `• [r/${result.subreddit}](${result.url})`
      ).join('\n');
      
      embed.addFields({
        name: '✅ Successfully Posted To',
        value: successList || 'No successful posts'
      });
    }

    // Add any errors
    if (response.errors && response.errors.length > 0) {
      const errorList = response.errors.map(error => 
        `• r/${error.subreddit}: ${error.error}`
      ).join('\n');
      
      embed.addFields({
        name: '❌ Failed Posts',
        value: errorList || 'No errors'
      });
    }

    // Add footer with next promotion time
    embed.setFooter({ 
      text: 'Next promotion available in 24 hours' 
    });

    return embed;
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
  },

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