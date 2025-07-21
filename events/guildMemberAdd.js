const { Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, addMuteModeUser } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const { checkAccountAge, performKick } = require('../utils/trollModeUtils');

module.exports = {
  name: Events.GuildMemberAdd,

  /**
   * Handles the event when a new member joins the guild.
   * This function:
   * 1. Checks if the member's account meets age requirements
   * 2. Adds the member to mute mode tracking
   * 3. If mute mode is enabled, schedules an automatic kick after the configured time
   * 
   * @param {GuildMember} member - The member that joined the guild
   * @throws {Error} If there's an error processing the new member, with specific error messages for different failure cases
   * @returns {Promise<void>}
   */
  async execute(member) {
    try {
      logger.info(`New member joined: ${member.user.tag}`);

      if (member.user.bot) {
        logger.debug("Bot joined; skipping mute mode tracking:", { botTag: member.user.tag });
        return;
      }

      const meetsAgeRequirement = await checkAccountAge(member);
      if (!meetsAgeRequirement) {
        await performKick(member);
        return;
      }

      await addMuteModeUser(member.id, member.user.tag);

      const muteModeEnabled = await getValue('mute_mode_enabled');
      if (muteModeEnabled) {
        const muteKickTime = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
        await scheduleMuteKick(
          member.id,
          member.joinedAt,
          muteKickTime,
          member.client,
          member.guild.id
        );
      }

      logger.info(`Successfully processed new member: ${member.user.tag}`);
    } catch (error) {
      logger.error('Error processing new member:', {
        error: error.stack,
        message: error.message,
        userId: member.user.id
      });

      let errorMessage = "⚠️ An unexpected error occurred while processing the new member.";
      
      if (error.message === "⚠️ Failed to track new member data.") {
        errorMessage = "⚠️ Failed to track new member data.";
      } else if (error.message === "⚠️ Failed to schedule mute kick for new member.") {
        errorMessage = "⚠️ Failed to schedule mute kick for new member.";
      } else if (error.message === "⚠️ Database error occurred while processing new member.") {
        errorMessage = "⚠️ Database error occurred while processing new member.";
      } else if (error.message === "⚠️ Insufficient permissions to process new member.") {
        errorMessage = "⚠️ Insufficient permissions to process new member.";
      } else if (error.message === "⚠️ Invalid member data received.") {
        errorMessage = "⚠️ Invalid member data received.";
      } else if (error.message === "⚠️ Failed to verify account age.") {
        errorMessage = "⚠️ Failed to verify account age.";
      } else if (error.message === "⚠️ Failed to kick member due to age requirement.") {
        errorMessage = "⚠️ Failed to kick member due to age requirement.";
      }
      
      throw new Error(errorMessage);
    }
  }
};