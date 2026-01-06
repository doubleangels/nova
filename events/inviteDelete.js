const { Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getInviteUsage, setInviteUsage, getInviteMetadata, setInviteMetadata } = require('../utils/database');

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

      // Get current invite usage tracking
      const currentUsage = await getInviteUsage(invite.guild.id);
      
      // Mark invite as deleted in metadata instead of immediately removing from usage tracking
      // This allows us to detect if a recently created invite was used and then deleted
      const inviteMetadata = await getInviteMetadata(invite.guild.id);
      if (inviteMetadata[invite.code]) {
        inviteMetadata[invite.code].deletedAt = new Date().toISOString();
        await setInviteMetadata(invite.guild.id, inviteMetadata);
        logger.debug('Marked invite as deleted in metadata.', {
          inviteCode: invite.code,
          guildId: invite.guild.id
        });
      }
      
      // Remove the deleted invite from usage tracking after a short delay
      // We'll clean it up in guildMemberAdd when checking for used invites
      // For now, keep it in tracking so we can detect if it was used
      // The cleanup will happen when we detect it was used or after 5 minutes
      
      logger.debug('Deleted invite tracking updated (kept in usage tracking for detection).', {
        inviteCode: invite.code,
        guildId: invite.guild.id
      });
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

