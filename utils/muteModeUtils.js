const { logger } = require('./logger');
const { scheduleJob } = require('node-schedule');
const dayjs = require('dayjs');
const { getValue, getAllTrackedMembers, removeTrackedMember, getTrackedMember } = require('../utils/database');
const { EmbedBuilder } = require('discord.js');

const DEFAULT_MUTE_KICK_TIME_HOURS = 4;
const KICK_REASON_TIMEOUT = "User did not send a message in time.";
const IMMEDIATE_TIMEOUT_MS = 0;

let muteModeEnabled = false;
let muteModeEndTime = null;
let muteModeJob = null;

function isMuteModeEnabled() {
  return muteModeEnabled;
}

function getMuteModeEndTime() {
  return muteModeEndTime;
}

function enableMuteMode(duration) {
  if (muteModeEnabled) {
    return false;
  }

  muteModeEnabled = true;
  muteModeEndTime = new Date(Date.now() + duration);

  if (muteModeJob) {
    muteModeJob.cancel();
  }

  muteModeJob = scheduleJob(muteModeEndTime, () => {
    muteModeEnabled = false;
    muteModeEndTime = null;
    muteModeJob = null;
    logger.info('Mute mode automatically disabled');
  });

  return true;
}

function disableMuteMode() {
  if (!muteModeEnabled) {
    return false;
  }

  muteModeEnabled = false;
  muteModeEndTime = null;

  if (muteModeJob) {
    muteModeJob.cancel();
    muteModeJob = null;
  }

  return true;
}

async function scheduleMuteKick(memberId, username, joinTime, muteKickTime, guildId, client) {
  try {
    logger.debug(
      `Scheduling mute kick for member '${username}' (ID: ${memberId}) in guild ${guildId}. Join time: ${joinTime}, allowed mute time: ${muteKickTime} hour(s).`
    );
    
    if (!client) {
      logger.error("Discord client is undefined. Cannot schedule mute kick without client instance.");
      return;
    }
    
    const now = dayjs();
    const joinTimeDt = dayjs(joinTime);
    const elapsedTime = now.diff(joinTimeDt, 'second');
    logger.debug(
      `Current time: ${now.toISOString()}, Join time: ${joinTimeDt.toISOString()}, Elapsed time: ${elapsedTime} second(s).`
    );
    
    const remainingTime = (muteKickTime * 3600) - elapsedTime;
    logger.debug(`Remaining time before kick for member '${username}': ${remainingTime.toFixed(2)} second(s).`);
    
    const guildObj = client.guilds.cache.get(guildId);
    if (!guildObj) {
      logger.warn(`Guild with ID ${guildId} not found. Removing tracked member '${username}' (ID: ${memberId}).`);
      await removeTrackedMember(memberId);
      return;
    }
    
    if (remainingTime <= 0) {
      await performKick(guildObj, memberId, username, "immediate");
      return;
    }
    
    setTimeout(() => delayedKick(remainingTime), IMMEDIATE_TIMEOUT_MS);
    logger.debug(`Delayed kick for member '${username}' (ID: ${memberId}) scheduled successfully.`);
  } catch (e) {
    logger.error(`Error scheduling mute kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
  }
  
  async function delayedKick(delaySeconds) {
    try {
      logger.debug(
        `Delayed kick initiated for member '${username}' (ID: ${memberId}). Scheduled in ${delaySeconds.toFixed(2)} second(s).`
      );
      
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      
      const tracked = await getTrackedMember(memberId);
      if (!tracked) {
        logger.debug(`Member '${username}' (ID: ${memberId}) is no longer tracked at delayed kick time.`);
        return;
      }
      
      const guildNow = client.guilds.cache.get(guildId);
      if (!guildNow) {
        logger.warn(`Guild with ID ${guildId} not found at delayed kick time for member '${username}'.`);
        return;
      }
      
      await performKick(guildNow, memberId, username, "delayed");
    } catch (e) {
      logger.error(`Error in delayed kick for member '${username}' (ID: ${memberId}): ${e.message}`, { error: e });
    }
  }
}

async function performKick(guild, memberId, username, kickType) {
  try {
    let member = guild.members.cache.get(memberId);
    
    if (!member) {
      try {
        member = await guild.members.fetch(memberId);
        logger.debug(`Member '${username}' (ID: ${memberId}) fetched from API for ${kickType} kick.`);
      } catch (e) {
        logger.info(`Member '${username}' (ID: ${memberId}) not found (may have left). Removing from tracking.`, { error: e.message });
        await removeTrackedMember(memberId);
        return;
      }
    }
    
    try {
      const embed = new EmbedBuilder()
        .setColor(0xCD41FF)
        .setTitle('Mute Mode Kick')
        .setDescription('You have been kicked from Da Frens because you did not send a message within the required time limit.')
        .addFields(
          { name: 'Want to rejoin?', value: 'You can rejoin at [dafrens.games](https://dafrens.games).' }
        );
      await member.send({ embeds: [embed] });
    } catch (dmError) {
      logger.warn(`Failed to send DM to member '${username}' (ID: ${memberId}) before kick:`, { error: dmError.message });
    }
    
    await member.kick(KICK_REASON_TIMEOUT);
    await removeTrackedMember(memberId);
    logger.info(`Member '${username}' (ID: ${memberId}) kicked ${kickType === "immediate" ? "immediately" : "after scheduled delay"} due to mute timeout.`);
  } catch (e) {
    logger.warn(`Failed to kick member '${username}' (ID: ${memberId}) ${kickType}: ${e.message}`, { error: e });
  }
}

async function rescheduleAllMuteKicks(client) {
  try {
    if (!client) {
      logger.error("Discord client is undefined. Cannot reschedule mute kicks without client instance.");
      return;
    }
    
    if (!client.guilds.cache.size) {
      logger.warn("Bot is not in any guilds; cannot reschedule mute kicks.");
      return;
    }
    
    const muteKickTime = parseInt(await getValue("mute_mode_kick_time_hours"), 10) || DEFAULT_MUTE_KICK_TIME_HOURS;
    const trackedMembers = await getAllTrackedMembers();
    
    if (!trackedMembers || trackedMembers.length === 0) {
      logger.debug("No tracked members found for mute kick rescheduling.");
      return;
    }
    
    const guildId = client.guilds.cache.first().id;
    
    for (const memberData of trackedMembers) {
      logger.debug(`Rescheduling mute kick for tracked member: ${JSON.stringify(memberData)}`);
      await scheduleMuteKick(
        memberData.member_id,
        memberData.username,
        memberData.join_time,
        muteKickTime,
        guildId,
        client
      );
    }
  } catch (e) {
    logger.error(`Error rescheduling mute kicks on startup: ${e.message}`, { error: e, stack: e.stack });
  }
}

module.exports = {
  isMuteModeEnabled,
  getMuteModeEndTime,
  enableMuteMode,
  disableMuteMode,
  scheduleMuteKick,
  performKick,
  rescheduleAllMuteKicks
}; 