const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, addMuteModeUser, addSpamModeJoinTime, getInviteUsage, setInviteUsage, getInviteNotificationChannel, getInviteTag, getInviteCodeToTagMap, rebuildCodeToTagMap } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const { checkAccountAge, performKick } = require('../utils/trollModeUtils');
const config = require('../config');

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
      logger.info(`New member joined: ${member.user.tag}.`);

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
      
      // Store join time in spam mode tracking (for tracking even after user sends message)
      await addSpamModeJoinTime(member.id, member.user.tag, member.joinedAt);

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

      // Check for tagged invite usage
      await this.checkTaggedInvite(member);

      logger.info(`Successfully processed new member: ${member.user.tag}.`);
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
  },

  /**
   * Checks if the member joined using a tagged invite and sends a notification if so
   * @param {GuildMember} member - The member that joined
   * @returns {Promise<void>}
   */
  async checkTaggedInvite(member) {
    try {
      logger.debug(`Checking tagged invite for member ${member.user.tag} (${member.user.id})`);
      
      // Get notification channel
      const notificationChannelId = await getInviteNotificationChannel();
      if (!notificationChannelId) {
        logger.debug("No invite notification channel configured, skipping invite check.");
        return;
      }
      logger.debug(`Notification channel ID: ${notificationChannelId}`);

      // Try to get channel from cache first, then fetch if not found
      let notificationChannel = member.guild.channels.cache.get(notificationChannelId);
      if (!notificationChannel) {
        try {
          notificationChannel = await member.guild.channels.fetch(notificationChannelId);
          logger.debug(`Fetched notification channel from API: ${notificationChannel.name} (${notificationChannel.id})`);
        } catch (fetchError) {
          logger.error(`Failed to fetch notification channel ${notificationChannelId}:`, { error: fetchError.message });
          return;
        }
      }
      
      if (!notificationChannel) {
        logger.warn(`Invite notification channel ${notificationChannelId} not found in guild ${member.guild.id}.`);
        return;
      }
      logger.debug(`Found notification channel: ${notificationChannel.name} (${notificationChannel.id}), type: ${notificationChannel.type}`);
      
      // Check if bot can send messages in this channel
      if (!notificationChannel.permissionsFor(member.guild.members.me)?.has('SendMessages')) {
        logger.error(`Bot does not have SendMessages permission in channel ${notificationChannel.name} (${notificationChannel.id})`);
        return;
      }
      
      // Check if bot can embed links
      if (!notificationChannel.permissionsFor(member.guild.members.me)?.has('EmbedLinks')) {
        logger.error(`Bot does not have EmbedLinks permission in channel ${notificationChannel.name} (${notificationChannel.id})`);
        return;
      }

      // Check if bot has permission to view invites
      if (!member.guild.members.me.permissions.has('ManageGuild')) {
        logger.debug("Bot doesn't have ManageGuild permission, cannot check invites.");
        return;
      }

      // Fetch current invites
      let currentInvites;
      try {
        currentInvites = await member.guild.invites.fetch();
        logger.debug(`Fetched ${currentInvites.size} invites`);
      } catch (error) {
        logger.error("Failed to fetch invites:", { error: error.message });
        return;
      }

      // Get previous invite usage counts
      const previousUsage = await getInviteUsage(member.guild.id);
      logger.debug(`Previous usage data:`, JSON.stringify(previousUsage));
      
      // Build current usage map and store invite objects for later use
      const currentUsage = {};
      const inviteObjects = new Map();
      currentInvites.each(invite => {
        currentUsage[invite.code] = invite.uses || 0;
        inviteObjects.set(invite.code, invite);
      });
      logger.debug(`Current usage data:`, JSON.stringify(currentUsage));

      // Find which invite was used (usage count increased)
      let usedInviteCode = null;
      let maxIncrease = 0;
      const invitesWithIncrease = [];
      
      for (const [code, currentCount] of Object.entries(currentUsage)) {
        const previousCount = previousUsage[code] || 0;
        const increase = currentCount - previousCount;
        logger.debug(`Invite ${code}: previous=${previousCount}, current=${currentCount}, increase=${increase}`);
        
        if (increase > 0) {
          invitesWithIncrease.push({ code, increase });
          if (increase > maxIncrease) {
            maxIncrease = increase;
            usedInviteCode = code;
          }
        }
      }

      // If we couldn't find it by comparison, check if it's a new invite
      if (!usedInviteCode) {
        logger.debug("No invite found with increased usage, checking for new invites");
        for (const [code, currentCount] of Object.entries(currentUsage)) {
          if (!previousUsage[code] && currentCount > 0) {
            usedInviteCode = code;
            logger.debug(`Found new invite: ${code} with ${currentCount} uses`);
            break;
          }
        }
      }

      // If multiple invites increased, log warning but use the one with highest increase
      if (invitesWithIncrease.length > 1) {
        logger.warn(`Multiple invites increased usage: ${invitesWithIncrease.map(i => `${i.code} (+${i.increase})`).join(', ')}. Using ${usedInviteCode} with highest increase.`);
      }

      logger.debug(`Detected used invite code: ${usedInviteCode}`);

      // Update stored usage counts
      await setInviteUsage(member.guild.id, currentUsage);

      // Check if the used invite code matches any tagged invite
      if (usedInviteCode) {
        // Check if we have a direct code match stored
        let codeToTagMap = await getInviteCodeToTagMap(member.guild.id);
        logger.debug(`Code to tag map:`, JSON.stringify(codeToTagMap));
        
        let tagName = codeToTagMap[usedInviteCode.toLowerCase()];
        logger.debug(`Tag name for code ${usedInviteCode}: ${tagName || 'not found'}`);
        
        // If mapping is empty or doesn't have this code, try to rebuild it from existing tags
        if (!tagName && Object.keys(codeToTagMap).length === 0) {
          logger.debug("Code-to-tag map is empty, attempting to rebuild from existing tags");
          codeToTagMap = await rebuildCodeToTagMap(member.guild.id);
          tagName = codeToTagMap[usedInviteCode.toLowerCase()];
          logger.debug(`After rebuild, tag name for code ${usedInviteCode}: ${tagName || 'not found'}`);
        }
        
        // If still not found, try rebuilding even if map wasn't empty (might be missing this specific code)
        if (!tagName) {
          logger.debug("Tag not found in mapping, attempting to rebuild from existing tags");
          codeToTagMap = await rebuildCodeToTagMap(member.guild.id);
          tagName = codeToTagMap[usedInviteCode.toLowerCase()];
          logger.debug(`After rebuild, tag name for code ${usedInviteCode}: ${tagName || 'not found'}`);
        }
        
        if (tagName) {
          const inviteTag = await getInviteTag(tagName);
          logger.debug(`Invite tag data:`, JSON.stringify(inviteTag));
          
          if (!inviteTag) {
            logger.error(`Tag "${tagName}" found in mapping but tag data is null/undefined`);
            return;
          }
          
          if (inviteTag.code.toLowerCase() === usedInviteCode.toLowerCase()) {
            // Send notification
            try {
              const embed = new EmbedBuilder()
                .setColor(config.baseEmbedColor)
                .setTitle('🎉 New Member Joined via Tagged Invite')
                .setDescription(`${member.user} joined the server using a tagged invite.`)
                .addFields(
                  { name: 'Member', value: `${member.user}`, inline: true },
                  { name: 'Invite Tag', value: inviteTag.name || tagName, inline: true },
                  { name: 'Invite Code', value: usedInviteCode, inline: true },
                  { name: 'Full URL', value: `https://discord.gg/${usedInviteCode}`, inline: false }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

              logger.debug(`Attempting to send notification to channel ${notificationChannel.id} (${notificationChannel.name})`);
              
              // Build embed JSON for logging
              const embedJSON = embed.toJSON();
              logger.debug(`Embed data:`, JSON.stringify(embedJSON, null, 2));
              logger.debug(`Embed fields count: ${embedJSON.fields?.length || 0}`);
              logger.debug(`Embed title: ${embedJSON.title || 'none'}`);
              logger.debug(`Embed description: ${embedJSON.description || 'none'}`);
              
              const sentMessage = await notificationChannel.send({ embeds: [embed] });
              logger.info(`✅ Sent invite notification for member ${member.user.tag} using tagged invite "${inviteTag.name}" (code: ${usedInviteCode}). Message ID: ${sentMessage.id}`);
            } catch (sendError) {
              logger.error(`Failed to send notification to channel:`, { 
                error: sendError.message,
                stack: sendError.stack,
                channelId: notificationChannel.id,
                channelName: notificationChannel.name,
                guildId: member.guild.id
              });
            }
          } else {
            logger.warn(`Tag found but code mismatch: tag code=${inviteTag.code}, used code=${usedInviteCode}`);
          }
        } else {
          // No tag found - send notification with invite creator info
          logger.debug(`No tag found for invite code: ${usedInviteCode}. Sending notification with creator info.`);
          
          const usedInvite = inviteObjects.get(usedInviteCode);
          if (usedInvite) {
            try {
              let creatorMention = 'Unknown';
              let creatorId = null;
              
              // Get invite creator
              if (usedInvite.inviter) {
                creatorMention = `${usedInvite.inviter}`;
                creatorId = usedInvite.inviter.id;
              } else if (usedInvite.inviterId) {
                // Use mention format with ID
                creatorMention = `<@${usedInvite.inviterId}>`;
                creatorId = usedInvite.inviterId;
              }
              
              const embed = new EmbedBuilder()
                .setColor(config.baseEmbedColor)
                .setTitle('👤 New Member Joined via Invite')
                .setDescription(`${member.user} joined the server using an invite.`)
                .addFields(
                  { name: 'Member', value: `${member.user}`, inline: true },
                  { name: 'Invite Creator', value: creatorMention, inline: true },
                  { name: 'Invite Code', value: usedInviteCode, inline: true },
                  { name: 'Full URL', value: `https://discord.gg/${usedInviteCode}`, inline: false }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();
              
              // Add channel info if available
              if (usedInvite.channel) {
                embed.addFields({ name: 'Channel', value: `${usedInvite.channel}`, inline: true });
              }
              
              // Add uses info if available
              if (usedInvite.uses !== null && usedInvite.maxUses !== null) {
                embed.addFields({ 
                  name: 'Uses', 
                  value: `${usedInvite.uses}${usedInvite.maxUses > 0 ? `/${usedInvite.maxUses}` : ''}`, 
                  inline: true 
                });
              }
              
              logger.debug(`Attempting to send notification to channel ${notificationChannel.id} (${notificationChannel.name})`);
              
              const sentMessage = await notificationChannel.send({ embeds: [embed] });
              logger.info(`✅ Sent invite notification for member ${member.user.tag} using untagged invite created by ${creatorId ? `user ${creatorId}` : 'unknown'} (code: ${usedInviteCode}). Message ID: ${sentMessage.id}`);
            } catch (sendError) {
              logger.error(`Failed to send notification for untagged invite:`, { 
                error: sendError.message,
                stack: sendError.stack,
                channelId: notificationChannel.id,
                channelName: notificationChannel.name,
                guildId: member.guild.id
              });
            }
          } else {
            logger.warn(`Invite object not found for code ${usedInviteCode}`);
          }
        }
      } else {
        logger.debug("No invite code detected for this join");
      }
    } catch (error) {
      logger.error('Error checking tagged invite:', {
        error: error.message,
        stack: error.stack,
        userId: member.user.id,
        guildId: member.guild.id
      });
      // Don't throw - this is a non-critical feature
    }
  }
};