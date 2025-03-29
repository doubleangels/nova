const { SlashCommandBuilder } = require('discord.js');
const logger = require('../logger')('ghostping.js');

module.exports = {
  // Define the slash command with its name, description and required options
  data: new SlashCommandBuilder()
    .setName('ghostping')
    .setDescription('Ghost ping a user by mentioning them and then deleting the message.')
    .addUserOption(option => 
      option
        .setName('user')
        .setDescription('What user would you like to ghost ping?')
        .setRequired(true)
    ),

  /**
   * Execute the ghost ping command
   * @param {Interaction} interaction - The interaction object representing the command execution
   */
  async execute(interaction) {
    // Acknowledge the command with an ephemeral reply to prevent timeout
    await interaction.deferReply({ 
      ephemeral: true
    });
    
    // Get the user to ping from the command options
    const target = interaction.options.getUser('user');
    
    try {
      // Send a message that mentions the target user
      const pingMessage = await interaction.channel.send(`<@${target.id}>`);
      
      // Immediately delete the message - this creates the "ghost ping" effect
      await pingMessage.delete();
      
      // Send a confirmation to the command user (only they can see this)
      await interaction.editReply({
        content: "✅ Successfully ghost pinged!",
        ephemeral: true
      });
      
      // Log the ghost ping for moderation purposes
      logger.info(`${interaction.user.tag} ghost pinged ${target.tag} in #${interaction.channel.name}`);
    } catch (error) {
      // Handle any errors that might occur during execution
      logger.error(`Error in ghost ping command: ${error}`);
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        ephemeral: true
      });
    }
  },
};
