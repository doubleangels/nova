const { SlashCommandBuilder } = require('discord.js');
const logger = require('../logger')('ghostPing.js');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

/**
 * We handle the ghost ping command.
 * This function creates a message that mentions a user but immediately deletes the mention.
 *
 * We perform several tasks:
 * 1. Create a message with a user mention
 * 2. Delete the message after a short delay
 * 3. Log the ghost ping action
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
    /**
     * Slash command definition for ghost pinging a user.
     * This command sends a message that mentions a user but immediately deletes it.
     */
    data: new SlashCommandBuilder()
        .setName('ghostping')
        .setDescription('Send a message that mentions a user but then immediately delete the mention.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user do you want to ghost ping?')
                .setRequired(true)),

    /**
     * Executes the /ghostping command.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            // We get the target user from the interaction options.
            const targetUser = interaction.options.getUser('user');
            
            logger.info("Ghost ping command initiated.", {
                userId: interaction.user.id,
                targetUserId: targetUser.id,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });

            // We create a message that mentions the target user.
            const message = await interaction.reply({
                content: `Hey ${targetUser}!`,
                fetchReply: true
            });
            
            // We delete the message after a short delay to create the ghost ping effect.
            setTimeout(async () => {
                try {
                    await message.delete();
                } catch (error) {
                    logger.error("Error deleting ghost ping message.", {
                        error: error.message,
                        messageId: message.id
                    });
                }
            }, 1000);
            
            logger.debug(`Ghost ping executed by ${interaction.user.tag} targeting ${targetUser.tag}`);

            // Confirm to the command user that the ghost ping was sent
            await interaction.editReply({
                content: `Ghost pinged ${targetUser.username}!`,
                ephemeral: true
            });
            
            logger.info("Ghost ping command completed successfully.", {
                userId: interaction.user.id,
                targetUserId: targetUser.id
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Handles errors that occur during command execution.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Error} error - The error that occurred.
     */
    async handleError(interaction, error) {
        logError(error, 'ghostping', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        try {
            await interaction.editReply({ 
                content: ERROR_MESSAGES.UNEXPECTED_ERROR,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for ghostping command.", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: ERROR_MESSAGES.UNEXPECTED_ERROR,
                ephemeral: true 
            }).catch(() => {
                // Silent catch if everything fails.
            });
        }
    }
}; 