const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setReminderData } = require('../utils/supabase');
const { randomUUID } = require('crypto');

/**
 * Module for the /fix command.
 * This command runs the fix logic for Disboard by adding the service data to the database.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Runs the fix logic for Disboard by adding the service data to the database.'),
    
  /**
   * Executes the /fix command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Check if the user has Administrator permissions using two methods for compatibility.
    if (!interaction.memberPermissions.has("Administrator") && 
        !interaction.memberPermissions.has(require('discord.js').PermissionsBitField.Flags.Administrator)) {
      logger.warn(`Unauthorized /fix attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    try {
      // Log that the command has been received along with the user's tag.
      logger.debug(`/fix command received from ${interaction.user.tag} for service: disboard`);
      
      // Defer the reply to allow processing time.
      await interaction.deferReply();

      // Define the delay for the reminder in seconds.
      const seconds = 7200;
      logger.debug(`Service 'disboard' selected with a delay of ${seconds} seconds.`);

      // Generate a unique identifier for the reminder.
      const reminderId = randomUUID();
      // Calculate the scheduled time by adding the delay to the current time.
      const scheduledTime = new Date(Date.now() + seconds * 1000).toISOString();

      // Set the reminder data for the disboard service in the database.
      await setReminderData("disboard", scheduledTime, reminderId);
      logger.debug(`Fix logic applied: {"scheduled_time": "${scheduledTime}", "reminder_id": "${reminderId}"}`);

      // Edit the deferred reply to inform the user that the fix logic was successfully applied.
      await interaction.editReply("✅ Fix logic successfully applied for **disboard**!");
    } catch (error) {
      // Log any errors that occur during the command execution.
      logger.error(`Error in /fix command: ${error}`);
      // Inform the user that an error occurred.
      await interaction.editReply("⚠️ An error occurred while applying fix logic. Please try again later.");
    }
  }
};
