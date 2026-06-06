/** Valid main-namespace config keys (main:config:<key>). */
const VALID_CONFIG_KEYS = new Set([
  'notext_channel',
  'troll_mode_enabled',
  'troll_mode_account_age',
  'reminder_channel',
  'reminder_role',
  'mute_mode_enabled',
  'mute_mode_kick_time_hours',
  'spam_mode_enabled',
  'spam_mode_threshold',
  'spam_mode_window_hours',
  'spam_mode_channel_id',
  'invite_notification_channel',
  'mute_mode_users',
  'spam_mode_users'
]);

const DISCORD_ID_REGEX = /^\d{17,20}$/;

/**
 * @param {string} rest
 * @returns {boolean}
 */
function isPredictionGameRestKeyValid(rest) {
  if (rest === 'registered' ||
      rest === 'prompted_fixtures' ||
      rest === 'scored_fixtures' ||
      rest === 'all_participants' ||
      rest === 'prompting_paused') {
    return true;
  }

  if (rest.startsWith('prediction:')) {
    const parts = rest.split(':');
    if (parts.length !== 3) return false;
    const userId = parts[1];
    const fixtureId = parts[2];
    return DISCORD_ID_REGEX.test(userId) && /^\d+$/.test(fixtureId);
  }

  if (rest.startsWith('points:')) {
    const userId = rest.substring('points:'.length);
    return DISCORD_ID_REGEX.test(userId);
  }

  if (rest.startsWith('predictions_by_fixture:')) {
    const fixtureId = rest.substring('predictions_by_fixture:'.length);
    return /^\d+$/.test(fixtureId);
  }

  if (rest.startsWith('user_predictions:')) {
    const userId = rest.substring('user_predictions:'.length);
    return DISCORD_ID_REGEX.test(userId);
  }

  if (rest.startsWith('pending_prediction:')) {
    const parts = rest.split(':');
    if (parts.length !== 3) return false;
    const userId = parts[1];
    const fixtureId = parts[2];
    return DISCORD_ID_REGEX.test(userId) && /^\d+$/.test(fixtureId);
  }

  if (rest.startsWith('scoring_lock:')) {
    const fixtureId = rest.substring('scoring_lock:'.length);
    return /^\d+$/.test(fixtureId);
  }

  return false;
}

/**
 * @param {string} dbKey
 * @returns {boolean}
 */
function isKeyNeeded(dbKey) {
  const parts = dbKey.split(':');
  if (parts.length < 2) {
    return false;
  }

  const namespace = parts[0];
  const rest = parts.slice(1).join(':');

  if (namespace === 'main') {
    if (rest.startsWith('config:')) {
      const configKey = rest.substring('config:'.length);
      return VALID_CONFIG_KEYS.has(configKey);
    }

    if (rest.startsWith('mute_mode:')) {
      const userId = rest.substring('mute_mode:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    if (rest.startsWith('spam_mode:')) {
      const userId = rest.substring('spam_mode:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    if (rest.startsWith('former_member:')) {
      const userId = rest.substring('former_member:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    if (rest.startsWith('message_count:')) {
      const userId = rest.substring('message_count:'.length);
      return DISCORD_ID_REGEX.test(userId);
    }

    if (rest.startsWith('invite_usage:')) {
      const guildId = rest.substring('invite_usage:'.length);
      return DISCORD_ID_REGEX.test(guildId);
    }

    if (rest.startsWith('invite_code_to_tag_map:')) {
      const guildId = rest.substring('invite_code_to_tag_map:'.length);
      return DISCORD_ID_REGEX.test(guildId);
    }

    return false;
  }

  if (namespace === 'invites') {
    if (rest.startsWith('tags:')) {
      const tagName = rest.substring('tags:'.length);
      return tagName.length > 0;
    }
    return false;
  }

  if (namespace === 'worldcup' || namespace === 'football') {
    return isPredictionGameRestKeyValid(rest);
  }

  if (namespace === 'nova_reminders') {
    if (rest === 'reminders:bump:list' ||
        rest === 'reminders:promote:list' ||
        rest === 'reminders:needafriend:list') {
      return true;
    }

    if (rest.startsWith('reminder:')) {
      const reminderId = rest.substring('reminder:'.length);
      return reminderId.length > 0;
    }

    return false;
  }

  return false;
}

/**
 * @param {string[]} dbKeys
 * @returns {{ keepCount: number, deleteKeys: string[] }}
 */
function analyzeDatabaseKeys(dbKeys) {
  let keepCount = 0;
  const deleteKeys = [];

  for (const key of dbKeys) {
    if (isKeyNeeded(key)) {
      keepCount++;
    } else {
      deleteKeys.push(key);
    }
  }

  deleteKeys.sort();
  return { keepCount, deleteKeys };
}

module.exports = {
  VALID_CONFIG_KEYS,
  DISCORD_ID_REGEX,
  isKeyNeeded,
  isPredictionGameRestKeyValid,
  analyzeDatabaseKeys
};
