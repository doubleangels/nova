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
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const REDDIT_EMBED_COLOR = 0xFF4500;
const TARGET_SUBREDDIT = 'findaserver';

// Predefined server advertisement content
const SERVER_TITLE = '[21+] 🎉 Welcome to Da Frens — a chill spot for real talk 🗣️, weird vibes 😜, spicy banter 🔥, and sweaty games 🎮. No drama 🚫, just laughs 😂. Like the internet 🌐, but with fewer clowns 🤡 — and way funnier ones 😎. (Adults only 🍻. Don\'t take life too seriously 🫠.)';
const SERVER_INVITE = 'https://discord.gg/dafrens';

// Initialize snoowrap client
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
      
      // Try to get the subreddit's flairs using a direct API call
      const flairs = await reddit.oauthRequest({
        uri: `/r/${postData.subreddit}/api/link_flair`,
        method: 'GET'
      });

      // Log available flairs for debugging
      logger.info('Available flairs:', flairs);

      // Use the specific flair ID
      const serverFlair = flairs.find(flair => 
        flair.id === 'b8ffcc5a-275b-11ec-8803-eade4b4709d8'
      );

      if (!serverFlair) {
        logger.error('Could not find specified flair. Available flairs:', flairs);
        return {
          error: true,
          message: 'Could not find the required flair. Please try again later or contact support.'
        };
      }

      logger.info("Using flair:", serverFlair);

      // Submit using direct API endpoint
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

    // Add fields only if they have valid values
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
    
    const errorMessage = getErrorMessage(error) || ERROR_MESSAGES.UNEXPECTED_ERROR;
    
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
  }
}; 