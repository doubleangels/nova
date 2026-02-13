const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, addMuteModeUser, addSpamModeJoinTime, getInviteUsage, setInviteUsage, getInviteNotificationChannel, getInviteTag, getInviteCodeToTagMap, rebuildCodeToTagMap, isFormerMember } = require('../utils/database');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const { checkAccountAge, performKick } = require('../utils/trollModeUtils');
const config = require('../config');

// Lock map to prevent race conditions in invite usage tracking
const inviteCheckLocks = new Map();

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
      logger.info('New member joined the guild.', {
        userTag: member.user.tag
      });

      if (member.user.bot) {
        logger.debug('Bot joined the guild, skipping mute mode tracking.', { botTag: member.user.tag });
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

      // Assign "been in server before" role only to returning members (if they have the role, they're not new)
      if (config.newUserBeenInServerBeforeRoleId) {
        const returning = await isFormerMember(member.id);
        if (returning) {
          await member.roles.add(config.newUserBeenInServerBeforeRoleId).catch(err => {
            logger.warn('Could not add been-in-server-before role on re-join.', {
              err: err.message,
              guildId: member.guild.id,
              userId: member.id,
              roleId: config.newUserBeenInServerBeforeRoleId
            });
          });
        }
      }

      // Check for tagged invite usage
      await this.checkTaggedInvite(member);

      logger.info('Successfully processed new member.', {
        userTag: member.user.tag
      });
    } catch (error) {
      logger.error('Error occurred while processing new member.', {
        err: error,
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
      logger.debug('Checking tagged invite for member.', {
        userTag: member.user.tag,
        userId: member.user.id
      });
      
      // Get notification channel
      const notificationChannelId = await getInviteNotificationChannel();
      if (!notificationChannelId) {
        logger.debug('No invite notification channel configured, skipping invite check.');
        return;
      }
      logger.debug('Notification channel ID retrieved.', {
        channelId: notificationChannelId
      });

      // Try to get channel from cache first, then fetch if not found
      let notificationChannel = member.guild.channels.cache.get(notificationChannelId);
      if (!notificationChannel) {
        try {
          notificationChannel = await member.guild.channels.fetch(notificationChannelId);
          logger.debug('Fetched notification channel from API.', {
            channelName: notificationChannel.name,
            channelId: notificationChannel.id
          });
        } catch (fetchError) {
          logger.error('Failed to fetch notification channel from API.', {
            err: fetchError,
            channelId: notificationChannelId
          });
          return;
        }
      }
      
      if (!notificationChannel) {
        logger.warn('Invite notification channel not found in guild.', {
          channelId: notificationChannelId,
          guildId: member.guild.id
        });
        return;
      }
      logger.debug('Found notification channel.', {
        channelName: notificationChannel.name,
        channelId: notificationChannel.id,
        channelType: notificationChannel.type
      });
      
      // Check permissions once and cache
      const botMember = member.guild.members.me;
      if (!botMember) {
        logger.error('Bot member not found in guild.', {
          guildId: member.guild.id
        });
        return;
      }
      
      const channelPermissions = notificationChannel.permissionsFor(botMember);
      if (!channelPermissions?.has('SendMessages')) {
        logger.error('Bot does not have SendMessages permission in notification channel.', {
          channelName: notificationChannel.name,
          channelId: notificationChannel.id
        });
        return;
      }
      
      if (!channelPermissions.has('EmbedLinks')) {
        logger.error('Bot does not have EmbedLinks permission in notification channel.', {
          channelName: notificationChannel.name,
          channelId: notificationChannel.id
        });
        return;
      }

      // Check if bot has permission to view invites
      if (!botMember.permissions.has('ManageGuild')) {
        logger.debug('Bot does not have ManageGuild permission, cannot check invites.');
        return;
      }

      // Fetch current invites
      let currentInvites;
      try {
        currentInvites = await member.guild.invites.fetch();
        logger.debug('Fetched invites from guild.', {
          inviteCount: currentInvites.size
        });
      } catch (error) {
        logger.error('Failed to fetch invites from guild.', {
          err: error
        });
        return;
      }

      // Get previous invite usage counts
      const previousUsage = await getInviteUsage(member.guild.id);
      logger.debug('Retrieved previous invite usage data.', {
        previousUsage: JSON.stringify(previousUsage)
      });
      
      // Build current usage map
      // Store codes in their original case for Discord API compatibility
      const currentUsage = {};
      currentInvites.each(invite => {
        const code = invite.code; // Keep original case
        currentUsage[code] = invite.uses || 0;
      });
      logger.debug('Built current invite usage data.', {
        currentUsage: JSON.stringify(currentUsage)
      });
      
      // If previous usage is empty (bot just started or first time), initialize it
      const isFirstRun = Object.keys(previousUsage).length === 0;
      if (isFirstRun) {
        logger.debug('No previous invite usage data found, initializing with current state. Skipping invite detection for this join.');
        // On first run, just initialize the usage tracking and skip detection
        // We can't reliably determine which invite was used without previous state
        await setInviteUsage(member.guild.id, currentUsage).catch(err => {
          logger.error('Failed to initialize invite usage tracking.', {
            err: err,
            guildId: member.guild.id
          });
        });
        return; // Skip notification on first run
      }

      // Use a lock per guild to prevent race conditions
      const guildId = member.guild.id;
      let lockPromise = inviteCheckLocks.get(guildId);
      if (lockPromise) {
        // Wait for the previous check to complete
        await lockPromise;
      }
      
      // Create a new lock promise for this check
      let resolveLock;
      const newLockPromise = new Promise(resolve => {
        resolveLock = resolve;
      });
      inviteCheckLocks.set(guildId, newLockPromise);

      try {
        // Re-read previous usage after acquiring lock to get latest state
        const lockedPreviousUsage = await getInviteUsage(guildId);
        
        // Get tagged invite code mapping
        let codeToTagMap = await getInviteCodeToTagMap(member.guild.id);
        if (!codeToTagMap || Object.keys(codeToTagMap).length === 0) {
          // Try rebuilding the map
          codeToTagMap = await rebuildCodeToTagMap(member.guild.id);
        }
        
        // Find which tagged invite was used (usage count increased)
        let usedInviteCode = null;
        let maxIncrease = 0;
        
        // Normalize previous usage keys to lowercase for case-insensitive comparison
        const normalizedPreviousUsage = {};
        for (const [code, count] of Object.entries(lockedPreviousUsage)) {
          normalizedPreviousUsage[code.toLowerCase()] = count;
        }
        
        // Only check tagged invites
        for (const [code, currentCount] of Object.entries(currentUsage)) {
          const normalizedCode = code.toLowerCase();
          
          // Skip if not a tagged invite
          if (!codeToTagMap[normalizedCode]) {
            continue;
          }
          
          const previousCount = normalizedPreviousUsage[normalizedCode] || 0;
          const increase = currentCount - previousCount;
          logger.debug('Comparing tagged invite usage counts.', {
            inviteCode: code,
            previousCount: previousCount,
            currentCount: currentCount,
            increase: increase
          });
          
          if (increase > 0) {
            if (increase > maxIncrease) {
              maxIncrease = increase;
              usedInviteCode = code; // Keep original case
            }
          }
        }

        // If we couldn't find it by comparison, check if it's a new tagged invite
        if (!usedInviteCode) {
          logger.debug('No tagged invite found with increased usage, checking for new tagged invites.');
          for (const [code, currentCount] of Object.entries(currentUsage)) {
            const normalizedCode = code.toLowerCase();
            // Check for new tagged invites that weren't in previous usage
            if (!normalizedPreviousUsage[normalizedCode] && currentCount >= 1 && codeToTagMap[normalizedCode]) {
              usedInviteCode = code; // Keep original case
              logger.debug('Found new tagged invite that was likely used.', {
                inviteCode: code,
                uses: currentCount
              });
              break;
            }
          }
        }
        
        logger.debug('Detected used invite code.', {
          inviteCode: usedInviteCode || 'NONE'
        });
        
        // Update stored usage counts BEFORE processing notification
        // This ensures we have the latest state for next join
        await setInviteUsage(member.guild.id, currentUsage).catch(err => {
          logger.error('Failed to update invite usage tracking.', {
            err: err,
            guildId: member.guild.id
          });
        });

        // Only send notification for tagged invites
        if (usedInviteCode) {
          // Normalize the code for lookup
          const normalizedUsedCode = usedInviteCode.toLowerCase();
          const tagName = codeToTagMap[normalizedUsedCode];
          
          logger.debug('Looked up tag name for invite code.', {
            inviteCode: usedInviteCode,
            normalizedCode: normalizedUsedCode,
            tagName: tagName || 'not found'
          });
          
          if (tagName) {
            const inviteTag = await getInviteTag(tagName);
            logger.debug('Retrieved invite tag data.', {
              inviteTag: JSON.stringify(inviteTag)
            });
            
            if (inviteTag && inviteTag.code && inviteTag.code.toLowerCase() === normalizedUsedCode) {
              // Send tagged invite notification
              try {
                const embed = new EmbedBuilder()
                  .setColor(config.baseEmbedColor ?? 0)
                  .setTitle('🎉 New Member Joined via Tagged Invite')
                  .setDescription(`${member.displayName} (${member.user.username}) joined the server using a tagged invite.`)
                  .addFields(
                    { name: 'Member', value: `${member.displayName} (${member.user.username})`, inline: true },
                    { name: 'Invite Tag', value: inviteTag.name || tagName, inline: true },
                    { name: 'Invite Code', value: usedInviteCode, inline: true },
                    { name: 'Full URL', value: `https://discord.gg/${usedInviteCode}`, inline: false }
                  )
                  .setThumbnail(member.user.displayAvatarURL())
                  .setTimestamp();

                logger.debug('Attempting to send notification to channel.', {
                  channelId: notificationChannel.id,
                  channelName: notificationChannel.name
                });
                
                const sentMessage = await notificationChannel.send({ embeds: [embed] });
                logger.info('Sent invite notification for member using tagged invite.', {
                  userTag: member.user.tag,
                  inviteTagName: inviteTag.name,
                  inviteCode: usedInviteCode,
                  messageId: sentMessage.id
                });
              } catch (sendError) {
                logger.error('Failed to send notification to channel.', {
                  err: sendError,
                  channelId: notificationChannel.id,
                  channelName: notificationChannel.name,
                  guildId: member.guild.id
                });
              }
            }
          }
        } else {
          // No tagged invite detected - don't send notification
          logger.debug('No tagged invite detected for member, skipping notification.', {
            userTag: member.user.tag,
            userId: member.user.id
          });
        }
        
      } finally {
        // Release the lock (guard in case resolveLock was never assigned)
        if (typeof resolveLock === 'function') {
          resolveLock();
        }
        if (inviteCheckLocks.get(guildId) === newLockPromise) {
          inviteCheckLocks.delete(guildId);
        }
      }
    } catch (error) {
      logger.error('Error occurred while checking tagged invite.', {
        err: error,
        userId: member.user.id,
        guildId: member.guild.id
      });
      // Don't throw - this is a non-critical feature
    }
  }
};