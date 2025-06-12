/**
 * Yappers command module for displaying server statistics.
 * Handles message counting, voice time tracking, and result formatting.
 * @module commands/yappers
 */

const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const db = require('../utils/database');

/**
 * Formats time in minutes to a human-readable string.
 * @function formatTime
 * @param {number} minutes - The time in minutes to format
 * @returns {string} A formatted string like "2h 30m" or "45m"
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
    .setDescription('Display top chatters, channels, and voice channels statistics')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  /**
   * Executes the yappers command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If statistics retrieval fails
   */
  async execute(interaction) {
    try {
      logger.debug("/yappers command initiated:", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildName: interaction.guild?.name,
        guildId: interaction.guild?.id
      });

      if (!interaction.guild) {
        logger.warn("Command used in DMs where it's not supported:", {
          userId: interaction.user.id,
          userTag: interaction.user.tag
        });
        
        return await interaction.reply({
          content: "⚠️ This command cannot be used in direct messages.",
          ephemeral: true
        });
      }

      await interaction.deferReply();
      logger.debug("Deferred reply for yappers command.");

      logger.debug("Fetching top message senders:", { limit: 10 });
      const topUsers = await db.getTopMessageSenders(10);
      logger.debug("Retrieved top message senders:", { 
        count: topUsers.length,
        users: topUsers.map(u => ({ username: u.username, count: u.message_count }))
      });

      logger.debug("Fetching top voice users:", { limit: 5 });
      const topVoiceUsers = await db.getTopVoiceUsers(5);
      logger.debug("Retrieved top voice users:", {
        count: topVoiceUsers.length,
        users: topVoiceUsers.map(u => ({ username: u.username, seconds: u.seconds_spent }))
      });

      logger.debug("Fetching top message channels:", { limit: 5 });
      const topChannels = await db.query(
        `SELECT channel_id, channel_name, message_count 
         FROM main.message_channel_counts 
         ORDER BY message_count DESC 
         LIMIT $1`,
        [5]
      );
      logger.debug("Retrieved top message channels:", {
        count: topChannels.rows.length,
        channels: topChannels.rows.map(c => ({ name: c.channel_name, count: c.message_count }))
      });

      logger.debug("Fetching top voice channels:", { limit: 5 });
      const topVoiceChannels = await db.query(
        `SELECT channel_id, channel_name, 
         total_seconds / 60 as total_minutes
         FROM main.voice_channel_time 
         ORDER BY total_seconds DESC 
         LIMIT $1`,
        [5]
      );
      logger.debug("Retrieved top voice channels:", {
        count: topVoiceChannels.rows.length,
        channels: topVoiceChannels.rows.map(c => ({ name: c.channel_name, minutes: c.total_minutes }))
      });

      logger.debug("Creating statistics embed.");
      const embed = new EmbedBuilder()
        .setColor(0xcd41ff)
        .setTitle('🏆 Top Yappers Statistics')
        .setDescription(`Statistics for ${interaction.guild.name}`)
        .addFields(
          {
            name: '👥 Top Chatters',
            value: topUsers.map((user, index) => 
              `${index + 1}. <@${user.member_id}>: ${user.message_count} messages`
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
              `${index + 1}. <@${user.member_id}>: ${formatTime(user.seconds_spent / 60)}`
            ).join('\n') || 'No voice activity found'
          }
        )
        .setTimestamp()
        .setFooter({ text: `Updated today at ${new Date().toLocaleTimeString()}` });

      logger.debug("Sending statistics embed.");
      await interaction.editReply({ embeds: [embed] });

      logger.info("/yappers command completed successfully:", {
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
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logger.error("Error in yappers command:", {
      error: error.message,
      stack: error.stack,
      guildId: interaction.guild?.id,
      guildName: interaction.guild?.name,
      userId: interaction.user.id,
      userTag: interaction.user.tag
    });

    let errorMessage = "⚠️ An unexpected error occurred while fetching statistics.";
    
    if (error.message === "DM_NOT_SUPPORTED") {
      errorMessage = "⚠️ This command cannot be used in direct messages.";
    } else if (error.message === "DATABASE_ERROR") {
      errorMessage = "⚠️ Failed to retrieve statistics from the database. Please try again later.";
    } else if (error.message === "PERMISSION_DENIED") {
      errorMessage = "⚠️ You don't have permission to view server statistics.";
    } else if (error.message === "INVALID_GUILD") {
      errorMessage = "⚠️ This command can only be used in a server.";
    } else if (error.message === "NO_STATISTICS") {
      errorMessage = "⚠️ No statistics available for this server.";
    } else if (error.message === "INVALID_CHANNEL") {
      errorMessage = "⚠️ Invalid channel specified.";
    } else if (error.message === "CHANNEL_NOT_FOUND") {
      errorMessage = "⚠️ The specified channel could not be found.";
    } else if (error.message === "INVALID_USER") {
      errorMessage = "⚠️ Invalid user specified.";
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = "⚠️ The specified user could not be found.";
    }
    
    await interaction.editReply({
      content: errorMessage,
      ephemeral: true
    });
  }
}; 