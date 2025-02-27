const { SlashCommandBuilder } = require('discord.js');
const { setReminderData } = require('../utils/supabase');
const logger = require('../logger');
const { randomUUID } = require('crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Runs the fix logic for Disboard by adding the service data to the database.'),
  async execute(interaction) {
    if (!interaction.memberPermissions.has("Administrator") && 
        !interaction.memberPermissions.has(require('discord.js').PermissionsBitField.Flags.Administrator)) {
      logger.warn(`Unauthorized /fix attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    try {
      logger.debug(`/fix command received from ${interaction.user.tag} for service: disboard`);
      
      await interaction.deferReply();

      const seconds = 7200;
      logger.debug(`Service 'disboard' selected with a delay of ${seconds} seconds.`);

      const reminderId = randomUUID();
      const scheduledTime = new Date(Date.now() + seconds * 1000).toISOString();

      await setReminderData("disboard", scheduledTime, reminderId);
      logger.debug(`Fix logic applied: {"scheduled_time": "${scheduledTime}", "reminder_id": "${reminderId}"}`);

      await interaction.editReply("✅ Fix logic successfully applied for **disboard**!");
    } catch (error) {
      logger.error(`Error in /fix command: ${error}`);
      await interaction.editReply("⚠️ An error occurred while applying fix logic. Please try again later.");
    }
  }
};
