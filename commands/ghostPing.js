const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
    /**
     * Slash command definition for ghost pinging a user.
     * This command sends a message that mentions a user but immediately deletes it.
     */
    data: new SlashCommandBuilder()
        .setName('ghostping')
        .setDescription('Ghost pings a user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user would youn like to ghost ping?')
                .setRequired(true)),

    /**
     * Executes the /ghostping command.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const targetUser = interaction.options.getUser('user');
            
            logger.info("Ghost ping command initiated.", {
                userId: interaction.user.id,
                targetUserId: targetUser.id,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });

            // Send the ping message
            const pingMessage = await interaction.channel.send(`${targetUser}`);
            
            // Delete the message after a very short delay
            setTimeout(async () => {
                try {
                    await pingMessage.delete();
                } catch (error) {
                    logger.error("Error deleting ghost ping message.", {
                        error: error.message,
                        messageId: pingMessage.id
                    });
                }
            }, 100);

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
            logger.error("Error executing ghost ping command.", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });
            
            await interaction.editReply({
                content: "⚠️ An unexpected error occurred. Please try again later.",
                ephemeral: true
            });
        }
    }
}; 