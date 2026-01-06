const { Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getInviteUsage, setInviteUsage, getInviteCodeToTagMap } = require('../utils/database');

module.exports = {
  name: Events.InviteDelete,

  /**
   * Handles the event when an invite is deleted from the guild.
   * This function removes the invite from usage tracking to keep the database clean.
   * 
   * @param {Invite} invite - The invite that was deleted
   * @returns {Promise<void>}
   */
  async execute(invite) {
    try {
      logger.debug('Invite deleted from guild.', {
        inviteCode: invite.code,
        guildId: invite.guild.id
      });

      // Check if bot has permission to view invites
      const botMember = invite.guild.members.me;
      if (!botMember?.permissions.has('ManageGuild')) {
        logger.debug('Bot does not have ManageGuild permission, skipping invite tracking cleanup.');
        return;
      }

      // Only clean up tagged invites (untagged invites aren't tracked)
      const codeToTagMap = await getInviteCodeToTagMap(invite.guild.id);
      const normalizedCode = invite.code.toLowerCase();
      
      if (!codeToTagMap[normalizedCode]) {
        logger.debug('Deleted invite is not tagged, skipping cleanup.', {
          inviteCode: invite.code
        });
        return;
      }
      
      // Get current invite usage tracking
      const currentUsage = await getInviteUsage(invite.guild.id);
      
      // Remove the deleted tagged invite from tracking
      if (currentUsage[invite.code] !== undefined) {
        delete currentUsage[invite.code];
        
        // Update the invite usage tracking
        await setInviteUsage(invite.guild.id, currentUsage);
        
        logger.debug('Removed deleted tagged invite from usage tracking.', {
          inviteCode: invite.code,
          guildId: invite.guild.id
        });
      } else {
        logger.debug('Deleted tagged invite was not in usage tracking (may have been created before bot started).', {
          inviteCode: invite.code,
          guildId: invite.guild.id
        });
      }
    } catch (error) {
      logger.error('Error occurred while cleaning up deleted invite from tracking.', {
        err: error,
        inviteCode: invite.code,
        guildId: invite.guild.id
      });
      // Don't throw - this is a non-critical feature
    }
  }
};

