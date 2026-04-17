const { Events, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { captureError } = require('../instrument');
const {
  getInviteUsage,
  setInviteUsage,
  getInviteNotificationChannel,
  getInviteTag,
  getInviteCodeToTagMap,
  rebuildCodeToTagMap,
  isFormerMember,
  appendInviteJoinHistory
} = require('../utils/database');
const config = require('../config');

// Lock map to prevent race conditions in invite usage tracking
const inviteCheckLocks = new Map();

/**
 * Invite code with the largest positive use-count delta vs. previous snapshot (any invite, not only tagged).
 * @returns {string|null}
 */
function pickStrongestInviteDelta(previousUsage, currentUsage) {
  const normPrev = {};
  for (const [code, count] of Object.entries(previousUsage)) {
    normPrev[code.toLowerCase()] = count;
  }
  let bestCode = null;
  let maxIncrease = 0;
  for (const [code, currentCount] of Object.entries(currentUsage)) {
    const prev = normPrev[code.toLowerCase()] || 0;
    const increase = currentCount - prev;
    if (increase > maxIncrease) {
      maxIncrease = increase;
      bestCode = code;
    }
  }
  return maxIncrease > 0 ? bestCode : null;
}

module.exports = {
  name: Events.GuildMemberAdd,

  /**
   * Handles the event when a new member joins the guild.
   * This function:
   * 1. Assigns auto-roles and checks returning members
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
        logger.debug('Bot joined the guild, skipping tracking.', { botTag: member.user.tag });
        return;
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

      // Assign Noobies role immediately on join (new members have 0 messages and will qualify)
      // This ensures the role exists from the moment they join, not just after their first message
      if (config.noobiesRoleId && config.givePermsFrenRoleId) {
        const hasFrenRole = member.roles.cache.has(config.givePermsFrenRoleId);
        if (!hasFrenRole) {
          await member.roles.add(config.noobiesRoleId, 'Assigned Noobies role on join (< 100 messages, no Fren role)').catch(err => {
            logger.warn('Could not add Noobies role on join.', {
              err: err.message,
              guildId: member.guild.id,
              userId: member.id,
              roleId: config.noobiesRoleId
            });
          });
          logger.debug('Assigned Noobies role on member join.', { userId: member.id });
        }
      }

      await this.checkTaggedInvite(member);

      logger.info('Successfully processed new member.', {
        userTag: member.user.tag
      });
    } catch (error) {
      captureError(error, { event: 'guildMemberAdd' });
      logger.error('Error occurred while processing new member.', {
        err: error,
        userId: member.user.id
      });
    }
  },

  /**
   * Detects invite attribution, appends Invite Manager join history, and optionally sends a tagged-invite notification.
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
      let notificationChannel = null;
      let canNotify = false;
      if (notificationChannelId) {
        logger.debug('Notification channel ID retrieved.', { channelId: notificationChannelId });
        notificationChannel = member.guild.channels.cache.get(notificationChannelId);
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
          }
        }
        if (notificationChannel) {
          const botForChannel = member.guild.members.me;
          const channelPermissions = notificationChannel.permissionsFor(botForChannel);
          canNotify = Boolean(
            channelPermissions?.has('SendMessages') &&
            channelPermissions.has('EmbedLinks')
          );
          if (!canNotify) {
            logger.warn('Invite notifications disabled: bot missing SendMessages or EmbedLinks on notification channel.', {
              channelId: notificationChannel.id
            });
          }
        } else {
          logger.warn('Invite notification channel not found in guild.', {
            channelId: notificationChannelId,
            guildId: member.guild.id
          });
        }
      } else {
        logger.debug('No invite notification channel configured; join history still records invite source when possible.');
      }

      const botMember = member.guild.members.me;
      if (!botMember) {
        logger.error('Bot member not found in guild.', { guildId: member.guild.id });
        return;
      }

      if (!botMember.permissions.has('ManageGuild')) {
        await appendInviteJoinHistory(member.guild.id, {
          userId: member.id,
          userTag: member.user.tag,
          displayName: member.displayName,
          source: 'unknown',
          inviteCode: null,
          tagName: null,
          channelName: null,
          detail: 'Bot needs Manage Server to detect which invite was used.'
        });
        return;
      }

      let currentInvites;
      try {
        currentInvites = await member.guild.invites.fetch();
        logger.debug('Fetched invites from guild.', { inviteCount: currentInvites.size });
      } catch (error) {
        captureError(error, { event: 'guildMemberAdd', handler: 'fetchInvites' });
        logger.error('Failed to fetch invites from guild.', { err: error });
        await appendInviteJoinHistory(member.guild.id, {
          userId: member.id,
          userTag: member.user.tag,
          displayName: member.displayName,
          source: 'unknown',
          detail: 'Could not fetch server invites.'
        });
        return;
      }

      const previousUsage = await getInviteUsage(member.guild.id);
      const currentUsage = {};
      currentInvites.each(invite => {
        currentUsage[invite.code] = invite.uses || 0;
      });
      logger.debug('Retrieved previous invite usage data.', {
        previousUsage: JSON.stringify(previousUsage)
      });
      logger.debug('Built current invite usage data.', { currentUsage: JSON.stringify(currentUsage) });

      const isFirstRun = Object.keys(previousUsage).length === 0;
      if (isFirstRun) {
        logger.debug('No previous invite usage data — initializing baseline (detection starts next join).');
        await setInviteUsage(member.guild.id, currentUsage).catch(err => {
          logger.error('Failed to initialize invite usage tracking.', { err, guildId: member.guild.id });
        });
        await appendInviteJoinHistory(member.guild.id, {
          userId: member.id,
          userTag: member.user.tag,
          displayName: member.displayName,
          source: 'baseline',
          inviteCode: null,
          tagName: null,
          channelName: null,
          detail: 'Invite usage baseline saved; attribution begins with the next join.'
        });
        return;
      }

      const guildId = member.guild.id;
      const lockPromise = inviteCheckLocks.get(guildId);
      if (lockPromise) await lockPromise;

      let resolveLock;
      const newLockPromise = new Promise(resolve => {
        resolveLock = resolve;
      });
      inviteCheckLocks.set(guildId, newLockPromise);

      try {
        const lockedPreviousUsage = await getInviteUsage(guildId);

        let codeToTagMap = await getInviteCodeToTagMap(member.guild.id);
        if (!codeToTagMap || Object.keys(codeToTagMap).length === 0) {
          codeToTagMap = await rebuildCodeToTagMap(member.guild.id);
        }

        let usedInviteCode = null;
        let maxIncrease = 0;

        const normalizedPreviousUsage = {};
        for (const [code, count] of Object.entries(lockedPreviousUsage)) {
          normalizedPreviousUsage[code.toLowerCase()] = count;
        }

        for (const [code, currentCount] of Object.entries(currentUsage)) {
          const normalizedCode = code.toLowerCase();
          if (!codeToTagMap[normalizedCode]) continue;
          const previousCount = normalizedPreviousUsage[normalizedCode] || 0;
          const increase = currentCount - previousCount;
          logger.debug('Comparing tagged invite usage counts.', {
            inviteCode: code,
            previousCount,
            currentCount,
            increase
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
              logger.debug('Found new tagged invite that was likely used.', { inviteCode: code, uses: currentCount });
              break;
            }
          }
        }

        logger.debug('Detected tagged invite code.', { inviteCode: usedInviteCode || 'NONE' });

        await setInviteUsage(member.guild.id, currentUsage).catch(err => {
          logger.error('Failed to update invite usage tracking.', { err, guildId: member.guild.id });
        });

        const fallbackCode = pickStrongestInviteDelta(lockedPreviousUsage, currentUsage);
        const historyCode = usedInviteCode || fallbackCode;
        const historyTag = historyCode ? (codeToTagMap[historyCode.toLowerCase()] || null) : null;
        const invObj = historyCode ? currentInvites.get(historyCode) : null;
        const historyChannel = invObj?.channel?.name || null;

        let histSource = 'unknown';
        if (historyTag) histSource = 'tagged_invite';
        else if (historyCode) histSource = 'invite';

        const unknownDetail =
          histSource === 'unknown'
            ? 'Could not match an invite (vanity URL, Server Discovery, same-time joins, or untracked invite).'
            : null;

        await appendInviteJoinHistory(member.guild.id, {
          userId: member.id,
          userTag: member.user.tag,
          displayName: member.displayName,
          source: histSource,
          inviteCode: historyCode,
          tagName: historyTag,
          channelName: historyChannel,
          detail: unknownDetail
        });

        if (canNotify && notificationChannel && usedInviteCode) {
          const normalizedUsedCode = usedInviteCode.toLowerCase();
          const tagName = codeToTagMap[normalizedUsedCode];
          logger.debug('Looked up tag name for invite code.', {
            inviteCode: usedInviteCode,
            normalizedCode: normalizedUsedCode,
            tagName: tagName || 'not found'
          });

          if (tagName) {
            const inviteTag = await getInviteTag(tagName);
            logger.debug('Retrieved invite tag data.', { inviteTag: JSON.stringify(inviteTag) });

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
                  guildId: member.guild.id
                });
              }
            }
          }
        } else if (!usedInviteCode) {
          logger.debug('No tagged invite detected for notification.', {
            userTag: member.user.tag,
            userId: member.user.id
          });
        }
      } finally {
        if (typeof resolveLock === 'function') resolveLock();
        if (inviteCheckLocks.get(guildId) === newLockPromise) {
          inviteCheckLocks.delete(guildId);
        }
      }
    } catch (error) {
      captureError(error, { event: 'guildMemberAdd', handler: 'checkTaggedInvite' });
      logger.error('Error occurred while checking tagged invite.', {
        err: error,
        userId: member.user.id,
        guildId: member.guild.id
      });
    }
  }
};
