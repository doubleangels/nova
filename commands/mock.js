const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Mock')
        .setType(ApplicationCommandType.Message),
    
    async execute(interaction) {
        // Get the targeted message
        const targetMessage = interaction.targetMessage;
        const messageContent = targetMessage.content;
        
        // If there's no content, respond with an error
        if (!messageContent || messageContent.trim() === '') {
            return interaction.reply({
                content: 'There is no text to mock!',
                ephemeral: true
            });
        }
        
        // Convert the text to mOcKiNg form
        const mockedText = messageContent.split('').map((char, index) => {
            return index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
        }).join('');
        
        // Reply with the mocked text, pinging the original author
        await interaction.reply(`<@${targetMessage.author.id}>: "${mockedText}"`);
    }
};
