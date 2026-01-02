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

      // Parallelize database writes
      await Promise.all([
        addMuteModeUser(member.id, member.user.tag),
        addSpamModeJoinTime(member.id, member.user.tag, member.joinedAt)
      ]);

      // Parallelize config reads
      const [muteModeEnabled, muteKickTimeValue] = await Promise.all([
        getValue('mute_mode_enabled'),
        getValue('mute_mode_kick_time_hours')
      ]);
      
      if (muteModeEnabled) {
        const muteKickTime = parseInt(muteKickTimeValue, 10) || 4;
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
      
      // Check permissions once and cache
      const botMember = member.guild.members.me;
      if (!botMember) {
        logger.error(`Bot member not found in guild ${member.guild.id}`);
        return;
      }
      
      const channelPermissions = notificationChannel.permissionsFor(botMember);
      if (!channelPermissions?.has('SendMessages')) {
        logger.error(`Bot does not have SendMessages permission in channel ${notificationChannel.name} (${notificationChannel.id})`);
        return;
      }
      
      if (!channelPermissions.has('EmbedLinks')) {
        logger.error(`Bot does not have EmbedLinks permission in channel ${notificationChannel.name} (${notificationChannel.id})`);
        return;
      }

      // Check if bot has permission to view invites
      if (!botMember.permissions.has('ManageGuild')) {
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
      // Store codes in their original case for Discord API compatibility
      const currentUsage = {};
      const inviteObjects = new Map();
      currentInvites.each(invite => {
        const code = invite.code; // Keep original case
        currentUsage[code] = invite.uses || 0;
        // Store invite object with original code
        inviteObjects.set(code, invite);
        // Also store with lowercase for lookup
        inviteObjects.set(code.toLowerCase(), invite);
      });
      logger.debug(`Current usage data:`, JSON.stringify(currentUsage));
      
      // If previous usage is empty (bot just started or first time), initialize it
      const isFirstRun = Object.keys(previousUsage).length === 0;
      if (isFirstRun) {
        logger.debug("No previous invite usage data found - this may be the first join after bot restart");
      }

      // Find which invite was used (usage count increased)
      let usedInviteCode = null;
      let maxIncrease = 0;
      const invitesWithIncrease = [];
      
      // Normalize previous usage keys to lowercase for case-insensitive comparison
      const normalizedPreviousUsage = {};
      for (const [code, count] of Object.entries(previousUsage)) {
        normalizedPreviousUsage[code.toLowerCase()] = count;
      }
      
      for (const [code, currentCount] of Object.entries(currentUsage)) {
        const normalizedCode = code.toLowerCase();
        const previousCount = normalizedPreviousUsage[normalizedCode] || 0;
        const increase = currentCount - previousCount;
        logger.debug(`Invite ${code}: previous=${previousCount}, current=${currentCount}, increase=${increase}`);
        
        if (increase > 0) {
          invitesWithIncrease.push({ code, increase });
          if (increase > maxIncrease) {
            maxIncrease = increase;
            usedInviteCode = code; // Keep original case
          }
        }
      }

      // If we couldn't find it by comparison, check if it's a new invite
      if (!usedInviteCode) {
        logger.debug("No invite found with increased usage, checking for new invites");
        for (const [code, currentCount] of Object.entries(currentUsage)) {
          const normalizedCode = code.toLowerCase();
          // Check for new invites that weren't in previous usage
          // Also check for invites with exactly 1 use (likely just used)
          if (!normalizedPreviousUsage[normalizedCode] && currentCount >= 1) {
            usedInviteCode = code; // Keep original case
            logger.debug(`Found new invite: ${code} with ${currentCount} uses`);
            break;
          }
        }
      }

      // If still not found and this is first run, try to find the most recently used invite
      // (one with lowest uses, as it's likely the newest)
      if (!usedInviteCode && isFirstRun) {
        logger.debug("First run after restart - checking for most recently used invite");
        let minUses = Infinity;
        let mostRecentInvite = null;
        for (const [code, currentCount] of Object.entries(currentUsage)) {
          if (currentCount > 0 && currentCount < minUses) {
            minUses = currentCount;
            mostRecentInvite = code;
          }
        }
        if (mostRecentInvite) {
          usedInviteCode = mostRecentInvite;
          logger.debug(`Found most recently used invite after restart: ${mostRecentInvite} with ${minUses} uses`);
        }
      }

      // If multiple invites increased, log warning but use the one with highest increase
      if (invitesWithIncrease.length > 1) {
        logger.warn(`Multiple invites increased usage: ${invitesWithIncrease.map(i => `${i.code} (+${i.increase})`).join(', ')}. Using ${usedInviteCode} with highest increase.`);
      }

      logger.debug(`Detected used invite code: ${usedInviteCode || 'NONE'}`);

      // Update stored usage counts BEFORE processing notification
      // This ensures we have the latest state for next join
      await setInviteUsage(member.guild.id, currentUsage);

      // Check if the used invite code matches any tagged invite
      if (usedInviteCode) {
        // Check if we have a direct code match stored
        // Normalize the code for lookup
        const normalizedUsedCode = usedInviteCode.toLowerCase();
        let codeToTagMap = await getInviteCodeToTagMap(member.guild.id);
        logger.debug(`Code to tag map:`, JSON.stringify(codeToTagMap));
        
        let tagName = codeToTagMap[normalizedUsedCode];
        logger.debug(`Tag name for code ${usedInviteCode} (normalized: ${normalizedUsedCode}): ${tagName || 'not found'}`);
        
        // Only rebuild once if tag not found (optimize to avoid double rebuilds)
        if (!tagName) {
          logger.debug("Tag not found in mapping, attempting to rebuild from existing tags");
          codeToTagMap = await rebuildCodeToTagMap(member.guild.id);
          tagName = codeToTagMap[normalizedUsedCode];
          logger.debug(`After rebuild, tag name for code ${usedInviteCode}: ${tagName || 'not found'}`);
        }
        
        if (tagName) {
          const inviteTag = await getInviteTag(tagName);
          logger.debug(`Invite tag data:`, JSON.stringify(inviteTag));
          
          if (!inviteTag) {
            logger.error(`Tag "${tagName}" found in mapping but tag data is null/undefined`);
            // Fall through to untagged invite notification
            tagName = null;
          } else if (inviteTag.code.toLowerCase() === normalizedUsedCode) {
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
              
              const sentMessage = await notificationChannel.send({ embeds: [embed] });
              logger.info(`Sent invite notification for member ${member.user.tag} using tagged invite "${inviteTag.name}" (code: ${usedInviteCode}). Message ID: ${sentMessage.id}`);
              return; // Successfully sent notification, exit early
            } catch (sendError) {
              logger.error(`Failed to send notification to channel:`, { 
                error: sendError.message,
                stack: sendError.stack,
                channelId: notificationChannel.id,
                channelName: notificationChannel.name,
                guildId: member.guild.id
              });
              // Fall through to untagged invite notification as fallback
              tagName = null;
            }
          } else {
            logger.warn(`Tag found but code mismatch: tag code=${inviteTag.code}, used code=${usedInviteCode}`);
            // Fall through to untagged invite notification
            tagName = null;
          }
        }
        
        // If no tag found or tag lookup failed, send untagged notification
        if (!tagName) {
          // No tag found - send notification with invite creator info
          logger.debug(`No tag found for invite code: ${usedInviteCode}. Sending notification with creator info.`);
          
          // Try to get invite object (check both normalized and original code)
          let usedInvite = inviteObjects.get(usedInviteCode) || inviteObjects.get(usedInviteCode.toLowerCase());
          
          // If not in map, try to find it in the currentInvites collection
          if (!usedInvite && currentInvites) {
            usedInvite = currentInvites.find(inv => inv.code === usedInviteCode || inv.code.toLowerCase() === usedInviteCode.toLowerCase());
            if (usedInvite) {
              logger.debug(`Found invite ${usedInviteCode} in currentInvites collection`);
            }
          }
          
          // If still not found, try to fetch it directly from Discord
          if (!usedInvite) {
            try {
              logger.debug(`Invite ${usedInviteCode} not in cache, attempting to fetch from Discord`);
              usedInvite = await member.guild.invites.fetch(usedInviteCode);
              if (usedInvite) {
                logger.debug(`Successfully fetched invite ${usedInviteCode} from Discord`);
              }
            } catch (fetchError) {
              logger.debug(`Could not fetch invite ${usedInviteCode} from Discord:`, { error: fetchError.message });
            }
          }
          
          // Send notification if we have invite info, or send fallback if we don't
          if (usedInvite) {
            try {
              let creatorMention = 'Unknown';
              
              // Get invite creator
              if (usedInvite.inviter) {
                creatorMention = `${usedInvite.inviter}`;
              } else if (usedInvite.inviterId) {
                // Use mention format with ID
                creatorMention = `<@${usedInvite.inviterId}>`;
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
              logger.info(`Sent invite notification for member ${member.user.tag} using untagged invite (code: ${usedInviteCode}). Message ID: ${sentMessage.id}`);
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
            logger.warn(`Invite object not found for code ${usedInviteCode}, sending fallback notification`);
            // Send fallback notification when invite can't be found
            try {
              const embed = new EmbedBuilder()
                .setColor(config.baseEmbedColor)
                .setTitle('👤 New Member Joined')
                .setDescription(`${member.user} joined the server using invite code \`${usedInviteCode}\`, but invite details could not be retrieved.`)
                .addFields(
                  { name: 'Member', value: `${member.user}`, inline: true },
                  { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                  { name: 'Invite Code', value: usedInviteCode, inline: true },
                  { name: 'Note', value: 'Invite may have been deleted or bot lacks permissions to view it.', inline: false }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

              const sentMessage = await notificationChannel.send({ embeds: [embed] });
              logger.info(`Sent fallback invite notification for member ${member.user.tag} (code: ${usedInviteCode}). Message ID: ${sentMessage.id}`);
            } catch (sendError) {
              logger.error(`Failed to send fallback notification:`, { 
                error: sendError.message,
                stack: sendError.stack,
                channelId: notificationChannel.id,
                channelName: notificationChannel.name,
                guildId: member.guild.id
              });
            }
          }
        }
      } else {
        // No invite code detected - send fallback notification
        logger.warn(`No invite code detected for member ${member.user.tag} (${member.user.id}). Sending fallback notification.`);
        try {
          const embed = new EmbedBuilder()
            .setColor(config.baseEmbedColor)
            .setTitle('👤 New Member Joined')
            .setDescription(`${member.user} joined the server, but the invite source could not be determined.`)
            .addFields(
              { name: 'Member', value: `${member.user}`, inline: true },
              { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
              { name: 'Note', value: 'Invite tracking may have failed due to bot restart or missing permissions.', inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();

          logger.debug(`Attempting to send fallback notification to channel ${notificationChannel.id} (${notificationChannel.name})`);
          
          const sentMessage = await notificationChannel.send({ embeds: [embed] });
          logger.info(`Sent fallback invite notification for member ${member.user.tag}. Message ID: ${sentMessage.id}`);
        } catch (sendError) {
          logger.error(`Failed to send fallback notification:`, { 
            error: sendError.message,
            stack: sendError.stack,
            channelId: notificationChannel.id,
            channelName: notificationChannel.name,
            guildId: member.guild.id
          });
        }
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