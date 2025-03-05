const { createClient } = require('@supabase/supabase-js');
const logger = require('../logger')('supabase.js');
const dayjs = require('dayjs');
const config = require('../config');

// Initialize the Supabase client with the URL and key from the config.
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

/**
 * Retrieves a value from the 'config' table based on a given key.
 *
 * @param {string} key - The key to retrieve.
 * @returns {Promise<any|null>} The parsed value if found, otherwise null.
 */
async function getValue(key) {
  try {
    logger.debug(`Getting config value for key "${key}".`);
    const { data, error } = await supabase
      .from('config')
      .select('value')
      .eq('id', key)
      .maybeSingle();
    if (error) throw error;
    // Parse the value if it exists.
    const parsed = data && data.value ? JSON.parse(data.value) : null;
    logger.debug(`Retrieved config for key "${key}": ${parsed}`);
    return parsed;
  } catch (err) {
    logger.error(`Error getting key "${key}":`, { error: err });
    return null;
  }
}

/**
 * Sets a value in the 'config' table for a given key.
 * Inserts a new record if the key does not exist; otherwise, updates the existing record.
 *
 * @param {string} key - The key to set.
 * @param {any} value - The value to store, which will be serialized to JSON.
 */
async function setValue(key, value) {
  try {
    logger.debug(`Setting config value for key "${key}".`);
    const serialized = JSON.stringify(value);
    const existing = await getValue(key);
    if (existing === null) {
      const { error } = await supabase.from('config').insert([{ id: key, value: serialized }]);
      if (error) throw error;
      logger.debug(`Inserted new config for key "${key}".`);
    } else {
      const { error } = await supabase.from('config').update({ value: serialized }).eq('id', key);
      if (error) throw error;
      logger.debug(`Updated existing config for key "${key}".`);
    }
  } catch (err) {
    logger.error(`Error setting key "${key}":`, { error: err });
  }
}

/**
 * Deletes a value from the 'config' table for a given key.
 *
 * @param {string} key - The key to delete.
 */
async function deleteValue(key) {
  try {
    logger.debug(`Deleting config for key "${key}".`);
    const { error } = await supabase.from('config').delete().eq('id', key);
    if (error) throw error;
    logger.debug(`Deleted config for key "${key}".`);
  } catch (err) {
    logger.error(`Error deleting key "${key}":`, { error: err });
  }
}

/**
 * Retrieves all configuration records from the 'config' table.
 *
 * @returns {Promise<Array<Object>>} An array of config objects.
 */
async function getAllConfigs() {
  try {
    logger.debug("Retrieving all config records.");
    const { data, error } = await supabase.from('config').select('*');
    if (error) throw error;
    logger.debug(`Retrieved ${data ? data.length : 0} config records.`);
    return data;
  } catch (err) {
    logger.error("Error getting all config values:", { error: err });
    return [];
  }
}

/**
 * Retrieves reminder data from the 'reminders' table for a given key.
 *
 * @param {string} key - The reminder key.
 * @returns {Promise<Object|null>} The reminder data if found, otherwise null.
 */
async function getReminderData(key) {
  try {
    logger.debug(`Getting reminder data for key "${key}".`);
    const { data, error } = await supabase
      .from('reminders')
      .select('scheduled_time, reminder_id')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    logger.debug(`Reminder data for key "${key}": ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    logger.error(`Error getting reminder data for key "${key}":`, { error: err });
    return null;
  }
}

/**
 * Sets reminder data in the 'reminders' table for a given key.
 * Inserts a new record if none exists; otherwise, updates the existing record.
 *
 * @param {string} key - The reminder key.
 * @param {string} scheduled_time - The scheduled time as an ISO string.
 * @param {string} reminder_id - A unique identifier for the reminder.
 */
async function setReminderData(key, scheduled_time, reminder_id) {
  try {
    logger.debug(`Setting reminder data for key "${key}".`);
    const existing = await getReminderData(key);
    if (!existing) {
      const { error } = await supabase
        .from('reminders')
        .insert([{ key, scheduled_time, reminder_id }]);
      if (error) throw error;
      logger.debug(`Inserted new reminder data for key "${key}".`);
    } else {
      const { error } = await supabase
        .from('reminders')
        .update({ scheduled_time, reminder_id })
        .eq('key', key);
      if (error) throw error;
      logger.debug(`Updated reminder data for key "${key}".`);
    }
  } catch (err) {
    logger.error(`Error setting reminder data for key "${key}":`, { error: err });
  }
}

/**
 * Deletes reminder data from the 'reminders' table for a given key.
 *
 * @param {string} key - The reminder key.
 */
async function deleteReminderData(key) {
  try {
    logger.debug(`Deleting reminder data for key "${key}".`);
    const { error } = await supabase.from('reminders').delete().eq('key', key);
    if (error) throw error;
    logger.debug(`Deleted reminder data for key "${key}".`);
  } catch (err) {
    logger.error(`Error deleting reminder data for key "${key}":`, { error: err });
  }
}

/**
 * Tracks a new member by inserting or updating their information in the 'tracked_members' table.
 *
 * @param {string} memberId - The Discord member ID.
 * @param {string} username - The username of the member.
 * @param {string} joinTime - The ISO string representing when the member joined.
 */
async function trackNewMember(memberId, username, joinTime) {
  try {
    const formattedJoinTime = dayjs(joinTime).toISOString();
    logger.debug(`Tracking new member "${username}" (ID: ${memberId}) joining at ${formattedJoinTime}.`);
    const { data, error } = await supabase
      .from('tracked_members')
      .upsert({ member_id: memberId, join_time: formattedJoinTime, username });
    if (error) {
      logger.warn(`Failed to track member "${username}" (ID: ${memberId}): ${error.message || error}`);
    } else {
      logger.debug(`Successfully tracked member "${username}" (ID: ${memberId}).`);
    }
  } catch (err) {
    logger.error(`Error tracking new member "${username}":`, { error: err });
  }
}

/**
 * Retrieves tracking data for a specific member from the 'tracked_members' table.
 *
 * @param {string} memberId - The Discord member ID.
 * @returns {Promise<Object|null>} The tracking data if found, otherwise null.
 */
async function getTrackedMember(memberId) {
  try {
    logger.debug(`Retrieving tracking data for member ID "${memberId}".`);
    const { data, error } = await supabase
      .from('tracked_members')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      logger.debug(`Found tracking data for member ID "${memberId}": ${JSON.stringify(data)}`);
      return data;
    }
    logger.debug(`No tracking data found for member ID "${memberId}".`);
    return null;
  } catch (err) {
    logger.error(`Error retrieving tracking data for member ID "${memberId}":`, { error: err });
    return null;
  }
}

/**
 * Removes tracking data for a specific member from the 'tracked_members' table.
 *
 * @param {string} memberId - The Discord member ID.
 */
async function removeTrackedMember(memberId) {
  try {
    logger.debug(`Removing tracking data for member ID "${memberId}".`);
    const { data, error } = await supabase
      .from('tracked_members')
      .delete()
      .eq('member_id', memberId);
    if (error) {
      logger.error(`Failed to remove tracking data for member ID "${memberId}": ${error.message || error}`);
    } else if (!data || data.length === 0) {
      logger.debug(`No tracking data found for member ID "${memberId}" to remove.`);
    } else {
      logger.debug(`Successfully removed tracking data for member ID "${memberId}".`);
    }
  } catch (err) {
    logger.error("Error removing tracked member:", { error: err });
  }
}

/**
 * Retrieves all tracked members from the 'tracked_members' table.
 *
 * @returns {Promise<Array<Object>>} An array of objects containing member_id, username, and join_time.
 */
async function getAllTrackedMembers() {
  try {
    logger.debug("Retrieving all tracked members.");
    const { data, error } = await supabase
      .from('tracked_members')
      .select('member_id, username, join_time');
    if (error) throw error;
    if (data) {
      logger.debug(`Retrieved ${data.length} tracked member(s).`);
      return data;
    }
    logger.debug("No tracked members found.");
    return [];
  } catch (err) {
    logger.error("Error retrieving all tracked members:", { error: err });
    return [];
  }
}

module.exports = {
  getValue,
  setValue,
  deleteValue,
  getAllConfigs,
  getReminderData,
  setReminderData,
  deleteReminderData,
  trackNewMember,
  getTrackedMember,
  removeTrackedMember,
  getAllTrackedMembers
};
