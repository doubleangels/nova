const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and get heads or tails'),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            logger.info("/coinflip command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id
            });

            const result = this.flipCoin();
            
            const embed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('Coin Flip')
                .setDescription(`🪙 The coin landed on: **${result}**`)
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/coinflip command completed successfully:", {
                userId: interaction.user.id,
                result
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    flipCoin() {
        return Math.random() < 0.5 ? 'Heads' : 'Tails';
    },

    async handleError(interaction, error) {
        logger.error("Error in coinflip command:", {
            error: error.message,
            stack: error.stack,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id
        });
        
        let errorMessage = "⚠️ An unexpected error occurred while flipping the coin.";
        
        if (error.message === "RESULT_FAILED") {
            errorMessage = "⚠️ Failed to generate coin flip result.";
        } else if (error.message === "RESPONSE_FAILED") {
            errorMessage = "⚠️ Failed to send coin flip result.";
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for coin flip command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                ephemeral: true 
            }).catch(() => {
            });
        }
    }
};
