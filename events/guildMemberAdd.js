const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { captureError } = require('../instrument');
const { getValue, addMuteModeUser, addSpamModeJoinTime, getInviteUsage, setInviteUsage, getInviteNotificationChannel, getInviteTag, getInviteCodeToTagMap, rebuildCodeToTagMap, isFormerMember } = require('../utils/database');
const { updateInviteSnapshotFromCollection } = require('../utils/inviteCache');
const { scheduleMuteKick } = require('../utils/muteModeUtils');
const { checkAccountAge, performKick } = require('../utils/trollModeUtils');
const config = require('../config');

// Lock map to prevent race conditions in invite usage tracking
const inviteCheckLocks = new Map();

function releaseInviteCheckLock(guildId, resolveLock, newLockPromise) {
  if (typeof resolveLock === 'function') {
    resolveLock();
  }
  if (inviteCheckLocks.get(guildId) === newLockPromise) {
    inviteCheckLocks.delete(guildId);
  }
}

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

      await addSpamModeJoinTime(member.id, member.user.tag, member.joinedAt);

      const [muteModeEnabled, muteKickTimeValue] = await Promise.all([
        getValue('mute_mode_enabled'),
        getValue('mute_mode_kick_time_hours')
      ]);

      if (muteModeEnabled) {
        await addMuteModeUser(member.id, member.user.tag);
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
      if (config.returningMemberRoleId) {
        const returning = await isFormerMember(member.id);
        if (returning) {
          await member.roles.add(config.returningMemberRoleId).catch(err => {
            logger.warn('Could not add been-in-server-before role on re-join.', {
              err: err.message,
              guildId: member.guild?.id,
              userId: member.id,
              roleId: config.returningMemberRoleId
            });
          });
        }
      }

      // Assign Noobies role immediately on join (new members have 0 messages and will qualify)
      // This ensures the role exists from the moment they join, not just after their first message
      if (config.newMemberRoleId && config.memberFrenRoleId) {
        const hasFrenRole = member.roles.cache.has(config.memberFrenRoleId);
        if (!hasFrenRole) {
          await member.roles.add(config.newMemberRoleId, 'Assigned Noobies role on join (< 100 messages, no Fren role)').catch(err => {
            logger.warn('Could not add Noobies role on join.', {
              err: err.message,
              guildId: member.guild?.id,
              userId: member.id,
              roleId: config.newMemberRoleId
            });
          });
          logger.debug('Assigned Noobies role on member join.', { userId: member.id });
        }
      }

      // Check for tagged invite usage
      await this.checkTaggedInvite(member);

      logger.info('Successfully processed new member.', {
        userTag: member.user.tag
      });
    } catch (error) {
      captureError(error, { event: 'guildMemberAdd' });
      // Do not rethrow — event handlers have no caller to receive the error.
      // Rethrowing here causes an unhandled promise rejection.
      logger.error('Error occurred while processing new member.', {
        err: error,
        userId: member.user.id
      });
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

      const notificationChannelId = await getInviteNotificationChannel();
      if (!notificationChannelId) {
        logger.debug('No invite notification channel configured, skipping invite check.');
        return;
      }

      if (!member.guild) {
        logger.warn('Member has no guild, skipping invite check.', {
          userId: member.user.id
        });
        return;
      }

      let codeToTagMap = await getInviteCodeToTagMap(member.guild.id);
      if (Object.keys(codeToTagMap).length === 0) {
        codeToTagMap = await rebuildCodeToTagMap(member.guild.id);
      }
      if (Object.keys(codeToTagMap).length === 0) {
        logger.debug('No tagged invites configured, skipping invite check.');
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
          guildId: member.guild?.id
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
          guildId: member.guild?.id
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

      const guildId = member.guild.id;

      // Use a lock per guild to prevent race conditions.
      // Acquire before awaiting: set our promise as the new tail of the chain,
      // then wait for the previous tail. This correctly serialises any number
      // of concurrent events (not just pairs).
      const prev = inviteCheckLocks.get(guildId);
      let resolveLock;
      const newLockPromise = new Promise((resolve) => {
        resolveLock = resolve;
      });
      inviteCheckLocks.set(guildId, newLockPromise);
      if (prev) {
        await prev;
      }

      let currentInvites;
      try {
        // Re-read previous usage after acquiring lock to get latest state
        const lockedPreviousUsage = await getInviteUsage(guildId);

        // Fetch current invites once inside the lock (shared across concurrent joins)
        try {
          currentInvites = await member.guild.invites.fetch();
          logger.debug('Fetched invites from guild.', {
            inviteCount: currentInvites.size
          });
        } catch (error) {
          captureError(error, { event: 'guildMemberAdd', handler: 'fetchInvites' });
          logger.error('Failed to fetch invites from guild.', {
            err: error
          });
          return;
        }

        const currentUsage = updateInviteSnapshotFromCollection(guildId, currentInvites);
        logger.debug('Built current invite usage data.', {
          currentUsage: JSON.stringify(currentUsage)
        });

        const isFirstRun = Object.keys(lockedPreviousUsage).length === 0;
        if (isFirstRun) {
          logger.debug('No previous invite usage data found, initializing with current state. Skipping invite detection for this join.');
          await setInviteUsage(guildId, currentUsage).catch((err) => {
            logger.error('Failed to initialize invite usage tracking.', {
              err: err,
              guildId: guildId
            });
          });
          return;
        }

        // Find which tagged invite was used (usage count increased)
        let usedInviteCode = null;
        let maxIncrease = 0;

        const normalizedPreviousUsage = {};
        for (const [code, count] of Object.entries(lockedPreviousUsage)) {
          normalizedPreviousUsage[code.toLowerCase()] = count;
        }

        for (const [code, currentCount] of Object.entries(currentUsage)) {
          const normalizedCode = code.toLowerCase();

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

          if (increase > 0 && increase > maxIncrease) {
            maxIncrease = increase;
            usedInviteCode = code;
          }
        }

        if (!usedInviteCode) {
          logger.debug('No tagged invite found with increased usage, checking for new tagged invites.');
          for (const [code, currentCount] of Object.entries(currentUsage)) {
            const normalizedCode = code.toLowerCase();
            if (!normalizedPreviousUsage[normalizedCode] && currentCount >= 1 && codeToTagMap[normalizedCode]) {
              usedInviteCode = code;
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

        await setInviteUsage(member.guild.id, currentUsage).catch((err) => {
          logger.error('Failed to update invite usage tracking.', {
            err: err,
            guildId: member.guild?.id
          });
        });

        if (usedInviteCode) {
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
                  guildId: member.guild?.id
                });
              }
            }
          }
        } else {
          logger.debug('No tagged invite detected for member, skipping notification.', {
            userTag: member.user.tag,
            userId: member.user.id
          });
        }
      } finally {
        releaseInviteCheckLock(guildId, resolveLock, newLockPromise);
      }
    } catch (error) {
      captureError(error, { event: 'guildMemberAdd', handler: 'checkTaggedInvite' });
      logger.error('Error occurred while checking tagged invite.', {
        err: error,
        userId: member.user.id,
        guildId: member.guild?.id
      });
      // Don't throw - this is a non-critical feature
    }
  }
};

if (process.env.NODE_ENV === 'test') {
  module.exports.__test__ = { inviteCheckLocks, releaseInviteCheckLock };
}