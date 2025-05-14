const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { updateVoiceTime } = require('../utils/database');
const Sentry = require('../sentry');

// We store the join times for users in voice channels
const voiceJoinTimes = new Map();

/**
 * Event handler for the 'voiceStateUpdate' event.
 * We track when users join and leave voice channels to calculate time spent.
 * 
 * @param {VoiceState} oldState - The previous voice state.
 * @param {VoiceState} newState - The new voice state.
 */
module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      // We ignore bot users
      if (newState.member.user.bot) return;

      const userId = newState.member.id;
      const username = newState.member.user.tag;

      // User joined a voice channel
      if (!oldState.channelId && newState.channelId) {
        voiceJoinTimes.set(userId, Date.now());
        logger.debug("User joined voice channel:", {
          userId,
          username,
          channelId: newState.channelId
        });
      }
      // User left a voice channel
      else if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceJoinTimes.get(userId);
        if (joinTime) {
          const timeSpent = Math.floor((Date.now() - joinTime) / (1000 * 60)); // Convert to minutes
          if (timeSpent > 0) {
            await updateVoiceTime(userId, username, timeSpent);
            logger.debug("Updated voice time for user:", {
              userId,
              username,
              minutesSpent: timeSpent
            });
          }
          voiceJoinTimes.delete(userId);
        }
      }
      // User switched voice channels
      else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const joinTime = voiceJoinTimes.get(userId);
        if (joinTime) {
          const timeSpent = Math.floor((Date.now() - joinTime) / (1000 * 60));
          if (timeSpent > 0) {
            await updateVoiceTime(userId, username, timeSpent);
            logger.debug("Updated voice time for user switching channels:", {
              userId,
              username,
              minutesSpent: timeSpent
            });
          }
        }
        voiceJoinTimes.set(userId, Date.now());
      }
    } catch (error) {
      logger.error("Error in voiceStateUpdate event:", { error });
      Sentry.captureException(error, {
        extra: {
          userId: newState.member.id,
          oldChannelId: oldState.channelId,
          newChannelId: newState.channelId
        }
      });
    }
  }
}; 