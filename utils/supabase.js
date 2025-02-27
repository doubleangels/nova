const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

// Initialize the Supabase client with the URL and Key from the config.
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

/**
 * Retrieves a value from the 'config_test' table based on a given key.
 *
 * @param {string} key - The key to retrieve.
 * @returns {Promise<any|null>} The parsed value if found, otherwise null.
 */
async function getValue(key) {
  try {
    const { data, error } = await supabase
      .from('config_test')
      .select('value')
      .eq('id', key)
      .maybeSingle();
    if (error) throw error;
    return data && data.value ? JSON.parse(data.value) : null;
  } catch (err) {
    logger.error(`Error getting key ${key}:`, err);
    return null;
  }
}

/**
 * Sets a value in the 'config_test' table for a given key.
 * Inserts a new record if the key does not exist; otherwise, updates the existing record.
 *
 * @param {string} key - The key to set.
 * @param {any} value - The value to store, which will be serialized to JSON.
 */
async function setValue(key, value) {
  try {
    const serialized = JSON.stringify(value);
    const existing = await getValue(key);
    if (existing === null) {
      const { error } = await supabase.from('config_test').insert([{ id: key, value: serialized }]);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('config_test').update({ value: serialized }).eq('id', key);
      if (error) throw error;
    }
  } catch (err) {
    logger.error(`Error setting key ${key}:`, err);
  }
}

/**
 * Deletes a value from the 'config_test' table for a given key.
 *
 * @param {string} key - The key to delete.
 */
async function deleteValue(key) {
  try {
    const { error } = await supabase.from('config_test').delete().eq('id', key);
    if (error) throw error;
  } catch (err) {
    logger.error(`Error deleting key ${key}:`, err);
  }
}

/**
 * Retrieves all configuration records from the 'config_test' table.
 *
 * @returns {Promise<Array<Object>>} An array of config objects.
 */
async function getAllConfigs() {
  try {
    const { data, error } = await supabase.from('config_test').select('*');
    if (error) throw error;
    return data;
  } catch (err) {
    logger.error("Error getting all config values:", err);
    return [];
  }
}

/**
 * Retrieves reminder data from the 'reminders_test' table for a given key.
 *
 * @param {string} key - The reminder key.
 * @returns {Promise<Object|null>} The reminder data if found, otherwise null.
 */
async function getReminderData(key) {
  try {
    const { data, error } = await supabase
      .from('reminders_test')
      .select('scheduled_time, reminder_id')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (err) {
    logger.error(`Error getting reminder data for key ${key}:`, err);
    return null;
  }
}

/**
 * Sets reminder data in the 'reminders_test' table for a given key.
 * Inserts a new record if none exists; otherwise, updates the existing record.
 *
 * @param {string} key - The reminder key.
 * @param {string} scheduled_time - The scheduled time as an ISO string.
 * @param {string} reminder_id - A unique identifier for the reminder.
 */
async function setReminderData(key, scheduled_time, reminder_id) {
  try {
    const existing = await getReminderData(key);
    if (!existing) {
      const { error } = await supabase
        .from('reminders_test')
        .insert([{ key, scheduled_time, reminder_id }]);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('reminders_test')
        .update({ scheduled_time, reminder_id })
        .eq('key', key);
      if (error) throw error;
    }
  } catch (err) {
    logger.error(`Error setting reminder data for key ${key}:`, err);
  }
}

/**
 * Deletes reminder data from the 'reminders_test' table for a given key.
 *
 * @param {string} key - The reminder key.
 */
async function deleteReminderData(key) {
  try {
    const { error } = await supabase.from('reminders_test').delete().eq('key', key);
    if (error) throw error;
  } catch (err) {
    logger.error(`Error deleting reminder data for key ${key}:`, err);
  }
}

/**
 * Tracks a new member by inserting or updating their information in the 'tracked_members_test' table.
 *
 * @param {string} memberId - The Discord member ID.
 * @param {string} username - The username of the member.
 * @param {string} joinTime - The ISO string representing when the member joined.
 */
async function trackNewMember(memberId, username, joinTime) {
  try {
    logger.debug(`Tracking new member '${username}' with ID ${memberId} joining at ${joinTime}.`);
    const { data, error } = await supabase
      .from('tracked_members_test')
      .upsert({ member_id: memberId, join_time: joinTime, username: username });
    if (error) {
      logger.warn(`Failed to track ${username} - ${error.message || error}`);
    } else {
      logger.debug(`Tracked new member: ${username} at ${joinTime}.`);
    }
  } catch (err) {
    logger.error(`Error tracking new member ${username}:`, err);
  }
}

/**
 * Retrieves tracking data for a specific member from the 'tracked_members_test' table.
 *
 * @param {string} memberId - The Discord member ID.
 * @returns {Promise<Object|null>} The tracking data if found, otherwise null.
 */
async function getTrackedMember(memberId) {
  try {
    logger.debug(`Retrieving tracking information for member with ID ${memberId}.`);
    const { data, error } = await supabase
      .from('tracked_members_test')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      logger.debug(`Tracking data for member ${memberId} retrieved: ${JSON.stringify(data)}`);
      return data;
    }
    logger.debug(`No tracking data found for member ${memberId}.`);
    return null;
  } catch (err) {
    logger.error("Error retrieving tracked data for a member:", err);
    return null;
  }
}

/**
 * Removes tracking data for a specific member from the 'tracked_members_test' table.
 *
 * @param {string} memberId - The Discord member ID.
 */
async function removeTrackedMember(memberId) {
  try {
    logger.debug(`Attempting to remove tracking information for member ID ${memberId}.`);
    const { data, error } = await supabase
      .from('tracked_members_test')
      .delete()
      .eq('member_id', memberId);
    if (error) {
      logger.error(`Failed to remove tracked member with ID ${memberId}. Error: ${error.message || error}`);
    } else if (!data || data.length === 0) {
      logger.debug(`No tracked member found for ID ${memberId}. Nothing to remove.`);
    } else {
      logger.debug(`Successfully removed tracked member with ID ${memberId}.`);
    }
  } catch (err) {
    logger.error(`Error removing tracked member:`, err);
  }
}

/**
 * Retrieves all tracked members from the 'tracked_members_test' table.
 *
 * @returns {Promise<Array<Object>>} An array of objects containing member_id, username, and join_time.
 */
async function getAllTrackedMembers() {
  try {
    logger.debug("Retrieving all tracked members from the database.");
    const { data, error } = await supabase
      .from('tracked_members_test')
      .select('member_id, username, join_time');
    if (error) throw error;
    if (data) {
      logger.debug(`Retrieved ${data.length} tracked members.`);
      return data;
    }
    logger.debug("No tracked members found.");
    return [];
  } catch (err) {
    logger.error("Error retrieving all tracked members from Supabase:", err);
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
