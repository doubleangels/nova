const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');
const db = require('../utils/database');

/**
 * These are the configuration constants for the yappers command.
 * We use these to control the limits and appearance of the statistics.
 */
const YAPPERS_EMBED_COLOR = 0xcd41ff;
const TOP_USERS_LIMIT = 10;
const TOP_CHANNELS_LIMIT = 5;
const TOP_VOICE_LIMIT = 5;

/**
 * We format time in minutes to a human-readable string with hours and minutes.
 * 
 * @param {number} minutes - The time in minutes to format.
 * @returns {string} A formatted string like "2h 30m" or "45m".
 */
function formatTime(minutes) {
  if (!minutes || isNaN(minutes)) return '0m';
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * We handle the yappers command.
 * This function displays statistics about top chatters, channels, and voice channels.
 *
 * We perform several tasks:
 * 1. We validate command permissions and guild context.
 * 2. We fetch message statistics from the database.
 * 3. We fetch voice channel statistics from the database.
 * 4. We create and display a formatted embed with the results.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('yappers')
    .setDescription('Display top chatters, channels, and voice channels statistics'),

  /**
   * We execute the /yappers command.
   * This function processes the statistics gathering and displays results.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>} Resolves when the command is complete.
   */
  async execute(interaction) {
    try {
      logger.debug("Yappers command received", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildName: interaction.guild?.name,
        guildId: interaction.guild?.id
      });

      // We check if the command is being used in a DM, where it's not supported.
      if (!interaction.guild) {
        logger.warn("Command used in DMs where it's not supported", {
          userId: interaction.user.id,
          userTag: interaction.user.tag
        });
        
        return await interaction.reply({
          content: ERROR_MESSAGES.DM_NOT_SUPPORTED,
          ephemeral: true
        });
      }

      // We defer the reply since database queries might take some time.
      await interaction.deferReply();
      logger.debug("Deferred reply for yappers command");

      // We fetch top message senders from the database.
      logger.debug("Fetching top message senders", { limit: TOP_USERS_LIMIT });
      const topUsers = await db.getTopMessageSenders(TOP_USERS_LIMIT);
      logger.debug("Retrieved top message senders", { 
        count: topUsers.length,
        users: topUsers.map(u => ({ username: u.username, count: u.message_count }))
      });

      // We fetch top voice users from the database.
      logger.debug("Fetching top voice users", { limit: TOP_VOICE_LIMIT });
      const topVoiceUsers = await db.getTopVoiceUsers(TOP_VOICE_LIMIT);
      logger.debug("Retrieved top voice users", {
        count: topVoiceUsers.length,
        users: topVoiceUsers.map(u => ({ username: u.username, seconds: u.seconds_spent }))
      });

      // We fetch top channels from the database.
      logger.debug("Fetching top message channels", { limit: TOP_CHANNELS_LIMIT });
      const topChannels = await db.query(
        `SELECT channel_id, channel_name, message_count 
         FROM main.message_channel_counts 
         ORDER BY message_count DESC 
         LIMIT $1`,
        [TOP_CHANNELS_LIMIT]
      );
      logger.debug("Retrieved top message channels", {
        count: topChannels.rows.length,
        channels: topChannels.rows.map(c => ({ name: c.channel_name, count: c.message_count }))
      });

      // We fetch top voice channels from the database.
      logger.debug("Fetching top voice channels", { limit: TOP_VOICE_LIMIT });
      const topVoiceChannels = await db.query(
        `SELECT channel_id, channel_name, 
         total_seconds / 60 as total_minutes
         FROM main.voice_channel_time 
         ORDER BY total_seconds DESC 
         LIMIT $1`,
        [TOP_VOICE_LIMIT]
      );
      logger.debug("Retrieved top voice channels", {
        count: topVoiceChannels.rows.length,
        channels: topVoiceChannels.rows.map(c => ({ name: c.channel_name, minutes: c.total_minutes }))
      });

      // We create the embed with all our gathered statistics.
      logger.debug("Creating statistics embed");
      const embed = new EmbedBuilder()
        .setColor(YAPPERS_EMBED_COLOR)
        .setTitle('🏆 Top Yappers Statistics')
        .setDescription(`Statistics for ${interaction.guild.name}`)
        .addFields(
          {
            name: '👥 Top Chatters',
            value: topUsers.map((user, index) => 
              `${index + 1}. ${user.username}: ${user.message_count} messages`
            ).join('\n') || 'No messages found'
          },
          {
            name: '📝 Most Active Channels',
            value: topChannels.rows.map((channel, index) => 
              `${index + 1}. <#${channel.channel_id}>: ${channel.message_count} messages`
            ).join('\n') || 'No messages found'
          },
          {
            name: '🎤 Most Active Voice Channels',
            value: topVoiceChannels.rows.map((channel, index) => 
              `${index + 1}. <#${channel.channel_id}>: ${formatTime(channel.total_minutes)}`
            ).join('\n') || 'No voice activity found'
          },
          {
            name: '🎙️ Top Voice Users',
            value: topVoiceUsers.map((user, index) => 
              `${index + 1}. ${user.username}: ${formatTime(user.seconds_spent / 60)}`
            ).join('\n') || 'No voice activity found'
          }
        )
        .setTimestamp()
        .setFooter({ text: `Updated today at ${new Date().toLocaleTimeString()}` });

      logger.debug("Sending statistics embed");
      await interaction.editReply({ embeds: [embed] });

      logger.info("Yappers statistics sent successfully", {
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        stats: {
          topUsers: topUsers.length,
          topVoiceUsers: topVoiceUsers.length,
          topChannels: topChannels.rows.length,
          topVoiceChannels: topVoiceChannels.rows.length
        }
      });

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * We handle any errors that occur during command execution.
   * This function logs the error and sends an appropriate message to the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   * @returns {Promise<void>} Resolves when the error is handled.
   */
  async handleError(interaction, error) {
    logger.error("Error in yappers command", {
      error: error.message,
      stack: error.stack,
      guildId: interaction.guild?.id,
      guildName: interaction.guild?.name,
      userId: interaction.user.id,
      userTag: interaction.user.tag
    });

    const errorMessage = getErrorMessage(error);
    await interaction.editReply({
      content: errorMessage,
      ephemeral: true
    });
  }
}; 