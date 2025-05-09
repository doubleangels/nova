const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams } = require('../utils/searchUtils');

const NEWS_API_URL = 'https://newsapi.org/v2/top-headlines';
const DEFAULT_RESULTS = 5;
const MIN_RESULTS = 1;
const MAX_RESULTS = 10;
const COLLECTOR_TIMEOUT = 120000; // 2 minutes
const EMBED_COLOR = 0x1E90FF; // Dodger blue for news
const REQUEST_TIMEOUT = 10000; // 10 seconds

module.exports = {
  data: new SlashCommandBuilder()
    .setName('news')
    .setDescription('Get the latest news headlines about a topic.')
    .addStringOption(option =>
      option
        .setName('topic')
        .setDescription('What topic do you want news about?')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('results')
        .setDescription(`How many results do you want? (${MIN_RESULTS}-${MAX_RESULTS}, Default: ${DEFAULT_RESULTS})`)
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: '⚠️ NewsAPI is not configured. Please contact a server administrator.',
          ephemeral: true
        });
      }

      await interaction.deferReply();
      logger.info('/news command initiated.', {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const topic = interaction.options.getString('topic');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        topic, resultsCount, DEFAULT_RESULTS, MIN_RESULTS, MAX_RESULTS
      );

      if (!searchParams.valid) {
        logger.warn('Invalid news search parameters.', { reason: searchParams.error });
        return await interaction.editReply({
          content: '⚠️ Please provide a valid topic to search for.',
          ephemeral: true
        });
      }

      logger.debug('Formatted news search parameters.', {
        topic: searchParams.query,
        count: searchParams.count
      });

      const newsResults = await this.fetchNewsResults(searchParams.query, searchParams.count);

      if (newsResults.error) {
        return await interaction.editReply({
          content: newsResults.message,
          ephemeral: true
        });
      }

      if (newsResults.articles.length === 0) {
        logger.warn('No news results found for topic.', { topic: searchParams.query });
        return await interaction.editReply({
          content: `⚠️ No news found for **${searchParams.query}**. Try another topic!`,
          ephemeral: true
        });
      }

      await createPaginatedResults(
        interaction,
        newsResults.articles,
        index => this.generateNewsEmbed(newsResults.articles, index, searchParams.query),
        'news',
        COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: ButtonStyle.Primary,
          prevLabel: 'Previous',
          nextLabel: 'Next',
          prevEmoji: '◀️',
          nextEmoji: '▶️'
        }
      );
    } catch (error) {
      logger.error('Error executing /news command.', {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      await interaction.editReply({
        content: '⚠️ An unexpected error occurred. Please try again later.',
        ephemeral: true
      });
    }
  },

  validateConfiguration() {
    if (!config.newsApiKey) {
      logger.error('NewsAPI key is missing in configuration.');
      return false;
    }
    return true;
  },

  async fetchNewsResults(topic, resultsCount) {
    const params = new URLSearchParams({
      q: topic,
      pageSize: resultsCount.toString(),
      apiKey: config.newsApiKey,
      language: 'en'
    });
    const requestUrl = `${NEWS_API_URL}?${params.toString()}`;
    logger.debug('Preparing NewsAPI request.', {
      topic,
      resultsRequested: resultsCount
    });
    try {
      const response = await axios.get(requestUrl, { timeout: REQUEST_TIMEOUT });
      logger.debug('NewsAPI response received.', {
        status: response.status,
        articlesReturned: response.data?.articles?.length || 0
      });
      return {
        articles: response.data.articles || []
      };
    } catch (apiError) {
      logger.error('NewsAPI request failed.', {
        error: apiError.message,
        status: apiError.response?.status,
        errorDetails: apiError.response?.data
      });
      let message = '⚠️ Failed to fetch news. Please try again later.';
      if (apiError.response?.data?.message) {
        message = `⚠️ NewsAPI error (${apiError.response.status}): ${apiError.response.data.message}`;
      }
      return {
        error: true,
        message
      };
    }
  },

  generateNewsEmbed(articles, index, topic) {
    const article = articles[index];
    const title = article.title || 'No Title';
    const url = article.url || null;
    const description = article.description || 'No description available.';
    const source = article.source?.name || 'Unknown Source';
    const publishedAt = article.publishedAt ? new Date(article.publishedAt).toLocaleString() : 'Unknown date';
    const image = article.urlToImage || null;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: `Source: ${source} | Published: ${publishedAt} | Result ${index + 1} of ${articles.length}` })
      .setTimestamp(new Date(article.publishedAt || Date.now()));

    if (url) {
      embed.setURL(url);
    }
    if (image) {
      embed.setImage(image);
    }
    if (topic) {
      embed.setAuthor({ name: `News about: ${topic}` });
    }
    return embed;
  }
}; 