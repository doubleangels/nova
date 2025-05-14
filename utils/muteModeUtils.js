const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, getAllMuteMembers, removeMuteMember, getMuteMember } = require('../utils/database');
const Sentry = require('../sentry');

/**
 * Schedules a mute kick for a member if they don't verify within the timeout period.
 * 
 * @param {string} memberId - The Discord member ID.
 * @param {string} username - The username of the member.
 * @param {string} joinTime - The ISO string when the member joined.
 * @param {number} kickTimeHours - The number of hours before kicking.
 * @param {string} guildId - The Discord guild ID.
 * @param {Client} client - The Discord client.
 */
async function scheduleMuteKick(memberId, username, joinTime, kickTimeHours, guildId, client) {
  try {
    const kickTime = new Date(new Date(joinTime).getTime() + (kickTimeHours * 60 * 60 * 1000));
    logger.debug("Scheduling mute kick:", {
      memberId,
      username,
      joinTime,
      kickTime,
      kickTimeHours
    });

    // We store the kick time in the database
    await setValue(`mute_kick_${memberId}`, {
      kickTime: kickTime.toISOString(),
      guildId
    });

    // We schedule the kick
    setTimeout(async () => {
      try {
        // We check if the member is still being tracked
        const muted = await getMuteMember(memberId);
        if (!muted) {
          logger.debug("Member is no longer being tracked; skipping kick:", {
            memberId,
            username
          });
          return;
        }

        // We get the guild and member
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(memberId);

        // We kick the member
        await member.kick("Failed to verify in mute mode");
        logger.info("Kicked member for not verifying:", {
          memberId,
          username
        });

        // We remove the tracking data
        await removeMuteMember(memberId);
      } catch (error) {
        logger.error("Error in mute kick timeout:", {
          memberId,
          username,
          error
        });
        Sentry.captureException(error, {
          extra: {
            function: 'scheduleMuteKick',
            memberId,
            username
          }
        });
      }
    }, kickTime - new Date());

    logger.info("Mute kick scheduled successfully:", {
      memberId,
      username,
      kickTime
    });
  } catch (error) {
    logger.error("Error scheduling mute kick:", {
      memberId,
      username,
      error
    });
    Sentry.captureException(error, {
      extra: {
        function: 'scheduleMuteKick',
        memberId,
        username
      }
    });
  }
}

/**
 * Checks all muted members and kicks those who haven't verified.
 * We use this after bot restarts to ensure no members are missed.
 * 
 * @param {Client} client - The Discord client.
 */
async function checkMutedMembers(client) {
  try {
    logger.info("Checking all muted members...");
    const muteMembers = await getAllMuteMembers();
    
    for (const member of muteMembers) {
      try {
        const guild = await client.guilds.fetch(member.guildId);
        const discordMember = await guild.members.fetch(member.member_id);
        
        // We check if the member has sent any messages
        if (member.message_count === 0) {
          await discordMember.kick("Failed to verify in mute mode");
          logger.info("Kicked unverified member:", {
            memberId: member.member_id,
            username: member.username
          });
        }
        
        // We remove the tracking data
        await removeMuteMember(member.member_id);
      } catch (error) {
        logger.error("Error processing muted member:", {
          memberId: member.member_id,
          username: member.username,
          error
        });
      }
    }
    
    logger.info("Finished checking muted members");
  } catch (error) {
    logger.error("Error checking muted members:", { error });
    Sentry.captureException(error, {
      extra: {
        function: 'checkMutedMembers'
      }
    });
  }
}

module.exports = {
  scheduleMuteKick,
  checkMutedMembers
};
