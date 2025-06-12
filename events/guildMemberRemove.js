const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { removeMuteModeUser } = require('../utils/database');
const { Events } = require('discord.js');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    try {
      if (member.user.bot) {
        logger.debug("Bot member left; skipping tracking removal:", { botTag: member.user.tag });
        return;
      }
      logger.info(`Member left: ${member.user.tag} (ID: ${member.id})`);
      
      await removeMuteModeUser(member.id);

      logger.info(`Successfully processed member departure: ${member.user.tag}`);
    } catch (error) {
      logger.error('Error processing member leave:', {
        error: error.stack,
        message: error.message,
        userId: member.user.id
      });
      
      let errorMessage = "⚠️ An unexpected error occurred while processing member departure.";
      
      if (error.message === "⚠️ Failed to remove member tracking data.") {
        errorMessage = "⚠️ Failed to remove member tracking data.";
      } else if (error.message === "⚠️ Database error occurred while processing member departure.") {
        errorMessage = "⚠️ Database error occurred while processing member departure.";
      } else if (error.message === "⚠️ Insufficient permissions to process member departure.") {
        errorMessage = "⚠️ Insufficient permissions to process member departure.";
      } else if (error.message === "⚠️ Invalid member data received.") {
        errorMessage = "⚠️ Invalid member data received.";
      } else if (error.message === "⚠️ Cannot process bot member departure.") {
        errorMessage = "⚠️ Cannot process bot member departure.";
      }
      
      throw new Error(errorMessage);
    }
  }
};