const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
    /**
     * Slash command definition for checking the bot's latency.
     * This command calculates and returns the bot's response time.
     */
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Checks the bot\'s response time.'),

    /**
     * Executes the /ping command.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        try {
            logger.debug("Ping command received:", {
                user: interaction.user.tag,
                userId: interaction.user.id,
                guild: interaction.guild?.name,
                guildId: interaction.guild?.id,
                channel: interaction.channel?.name
            });

            // Record the time when command was received
            const startTime = Date.now();
            
            logger.debug("Sending initial ping response");
            
            // Send an initial response
            await interaction.reply({ content: "Pinging..." });
            
            // Calculate the round-trip time
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            logger.debug("Response time calculated:", {
                responseTime: responseTime
            });

            // Edit the response with the calculated value
            await interaction.editReply({ 
                content: `🏓 Pong!\n⏱️ Response Time: ${responseTime}ms` 
            });
            
            logger.info("Ping command executed successfully:", {
                user: interaction.user.tag,
                responseTime: responseTime
            });
            
        } catch (error) {
            logger.error("Error executing ping command:", {
                error: error.message,
                stack: error.stack,
                user: interaction.user?.tag,
                guild: interaction.guild?.name
            });
            
            // Attempt to send an error response to the user
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: "An error occurred while checking ping.",
                        flags: MessageFlags.Ephemeral
                    });
                } else if (interaction.replied) {
                    await interaction.editReply({
                        content: "An error occurred while calculating response time."
                    });
                }
            } catch (replyError) {
                logger.error("Error sending error response:", {
                    error: replyError.message
                });
            }
        }
    }
};
