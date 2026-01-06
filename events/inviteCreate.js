const { Events } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getInviteUsage, setInviteUsage, getInviteCodeToTagMap } = require('../utils/database');

module.exports = {
  name: Events.InviteCreate,

  /**
   * Handles the event when a new invite is created in the guild.
   * This function updates the invite usage tracking to include tagged invites,
   * ensuring that tagged invites can be tracked when members join.
   * 
   * @param {Invite} invite - The invite that was created
   * @returns {Promise<void>}
   */
  async execute(invite) {
    try {
      logger.debug('New invite created in guild.', {
        inviteCode: invite.code,
        guildId: invite.guild.id,
        inviterId: invite.inviter?.id,
        maxUses: invite.maxUses,
        maxAge: invite.maxAge
      });

      // Check if bot has permission to view invites
      const botMember = invite.guild.members.me;
      if (!botMember?.permissions.has('ManageGuild')) {
        logger.debug('Bot does not have ManageGuild permission, skipping invite tracking update.');
        return;
      }

      // Only track tagged invites
      const codeToTagMap = await getInviteCodeToTagMap(invite.guild.id);
      const normalizedCode = invite.code.toLowerCase();
      
      if (!codeToTagMap[normalizedCode]) {
        logger.debug('Invite is not tagged, skipping tracking.', {
          inviteCode: invite.code
        });
        return;
      }
      
      // Get current invite usage tracking
      const currentUsage = await getInviteUsage(invite.guild.id);
      
      // Add the new tagged invite to tracking with its current usage count (0 for new invites)
      currentUsage[invite.code] = invite.uses || 0;
      
      // Update the invite usage tracking
      await setInviteUsage(invite.guild.id, currentUsage);
      
      logger.debug('Updated invite usage tracking with new tagged invite.', {
        inviteCode: invite.code,
        guildId: invite.guild.id,
        uses: invite.uses || 0
      });
    } catch (error) {
      logger.error('Error occurred while tracking new invite.', {
        err: error,
        inviteCode: invite.code,
        guildId: invite.guild.id
      });
      // Don't throw - this is a non-critical feature
    }
  }
};

