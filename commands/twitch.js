const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants for Twitch integration
const TWITCH_API_BASE_URL = 'https://api.twitch.tv/helix';
const TWITCH_EMBED_COLOR = 0x9146FF; // Twitch's brand color
const REQUEST_TIMEOUT = 10000; // 10 second timeout for API requests

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Get information about a Twitch channel')
    .addStringOption(option =>
      option
        .setName('channel')
        .setDescription('The name of the Twitch channel')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // Validate Twitch API configuration
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact a server administrator.",
          ephemeral: true
        });
      }

      // Defer the reply to allow time for API requests
      await interaction.deferReply();
      logger.info(`/twitch command initiated.`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const channelName = interaction.options.getString('channel');

      // Get access token for Twitch API
      const accessToken = await this.getTwitchAccessToken();
      if (!accessToken) {
        return await interaction.editReply({
          content: "⚠️ Failed to authenticate with Twitch. Please try again later.",
          ephemeral: true
        });
      }

      // Fetch channel information
      const channelInfo = await this.fetchChannelInfo(channelName, accessToken);
      const streamInfo = await this.fetchStreamInfo(channelName, accessToken);

      if (!channelInfo) {
        return await interaction.editReply({
          content: `⚠️ No information found for channel "${channelName}"`,
          ephemeral: true
        });
      }

      // Create and send the embed
      const embed = this.createEmbed(channelInfo, streamInfo);
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error("Error executing /twitch command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        ephemeral: true
      });
    }
  },

  validateConfiguration() {
    if (!config.twitchClientId || !config.twitchClientSecret) {
      logger.error("Twitch API configuration is missing.", {
        hasClientId: !!config.twitchClientId,
        hasClientSecret: !!config.twitchClientSecret
      });
      return false;
    }
    return true;
  },

  async getTwitchAccessToken() {
    try {
      const response = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        new URLSearchParams({
          client_id: config.twitchClientId,
          client_secret: config.twitchClientSecret,
          grant_type: 'client_credentials'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: REQUEST_TIMEOUT
        }
      );

      return response.data.access_token;
    } catch (error) {
      logger.error("Failed to get Twitch access token:", {
        error: error.message
      });
      return null;
    }
  },

  async fetchChannelInfo(channelName, accessToken) {
    try {
      logger.debug('Twitch API request initiated.', { channelName });
      const response = await axios.get(`${TWITCH_API_BASE_URL}/users`, {
        params: {
          login: channelName
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': config.twitchClientId
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.data.length) {
        logger.debug('Twitch API response received.', { channelName, result: 'no results' });
        return null;
      }

      const channel = response.data.data[0];
      logger.debug('Twitch API response received.', { channelName, result: 'success' });
      return {
        name: channel.display_name,
        description: channel.description,
        url: `https://www.twitch.tv/${channel.login}`,
        profileImageUrl: channel.profile_image_url,
        viewCount: channel.view_count,
        broadcasterType: channel.broadcaster_type,
        createdAt: channel.created_at
      };
    } catch (error) {
      logger.error("Failed to fetch channel information:", {
        error: error.message,
        channelName
      });
      return null;
    }
  },

  async fetchStreamInfo(channelName, accessToken) {
    try {
      const response = await axios.get(`${TWITCH_API_BASE_URL}/streams`, {
        params: {
          user_login: channelName
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': config.twitchClientId
        },
        timeout: REQUEST_TIMEOUT
      });

      return response.data.data.length > 0 ? response.data.data[0] : null;
    } catch (error) {
      logger.error("Failed to fetch stream information:", {
        error: error.message,
        channelName
      });
      return null;
    }
  },

  createEmbed(channelInfo, streamInfo) {
    const isOnline = streamInfo !== null;
    const embed = new EmbedBuilder()
      .setColor(TWITCH_EMBED_COLOR)
      .setTitle(channelInfo.name)
      .setURL(channelInfo.url)
      .setThumbnail(channelInfo.profileImageUrl)
      .setDescription(channelInfo.description || 'No description available')
      .addFields(
        { name: 'Status', value: isOnline ? '🟢 Online' : '🔴 Offline', inline: true }
      )
      .setFooter({ text: 'Powered by Twitch API' });

    if (isOnline) {
      embed.addFields(
        { name: 'Game', value: streamInfo.game_name || 'Unknown', inline: true },
        { name: 'Viewers', value: streamInfo.viewer_count.toString(), inline: true }
      );
    }

    return embed;
  }
}; 