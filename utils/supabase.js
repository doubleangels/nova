const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../logger');

// Initialize Supabase client using your Supabase URL and Key from config.
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

/* ===== Config Table Functions ===== */

/**
 * Retrieve a configuration value by key from the 'config_test' table.
 * @param {string} key 
 * @returns {Promise<any>} The parsed value or null.
 */
async function getValue(key) {
  try {
    const { data, error } = await supabase
      .from('config_test')
      .select('value')
      .eq('id', key)
      .single();
    if (error) throw error;
    return data && data.value ? JSON.parse(data.value) : null;
  } catch (err) {
    logger.error(`Error getting key ${key}:`, err);
    return null;
  }
}

/**
 * Insert or update a configuration value in the 'config_test' table.
 * @param {string} key 
 * @param {any} value 
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
 * Delete a configuration value by key.
 * @param {string} key 
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
 * Retrieve all rows from the "config" table.
 * @returns {Promise<Array>} An array of config records.
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

/* ===== Reminders Table Functions ===== */

/**
 * Retrieve reminder data for a given key from the 'reminders_test' table.
 * @param {string} key 
 * @returns {Promise<object|null>} Data including scheduled_time and reminder_id.
 */
async function getReminderData(key) {
  try {
    const { data, error } = await supabase
      .from('reminders_test')
      .select('scheduled_time, reminder_id')
      .eq('key', key)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    logger.error(`Error getting reminder data for key ${key}:`, err);
    return null;
  }
}

/**
 * Insert or update reminder data in the 'reminders_test' table.
 * @param {string} key 
 * @param {string|null} scheduled_time 
 * @param {string|null} reminder_id 
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
 * Delete reminder data for a given key from the 'reminders_test' table.
 * @param {string} key 
 */
async function deleteReminderData(key) {
  try {
    const { error } = await supabase.from('reminders_test').delete().eq('key', key);
    if (error) throw error;
  } catch (err) {
    logger.error(`Error deleting reminder data for key ${key}:`, err);
  }
}

/* ===== Tracked Members Functions ===== */

/**
 * Track a new member in the 'tracked_members_test' table.
 * Inserts or updates the record for a new member.
 * @param {string|number} memberId - The unique ID of the member.
 * @param {string} username - The username of the member.
 * @param {string} joinTime - The join time in ISO format.
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
 * Retrieve tracking information for a member from the 'tracked_members_test' table.
 * @param {string|number} memberId 
 * @returns {Promise<object|null>} The tracked member data if found; otherwise, null.
 */
async function getTrackedMember(memberId) {
  try {
    logger.debug(`Retrieving tracking information for member with ID ${memberId}.`);
    const { data, error } = await supabase
      .from('tracked_members_test')
      .select('*')
      .eq('member_id', memberId)
      .single();
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
 * Remove a member's tracking information from the 'tracked_members_test' table.
 * @param {string|number} memberId - The unique ID of the member to remove.
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
 * Retrieve all tracked members from the 'tracked_members_test' table.
 * @returns {Promise<Array>} A list of tracked member records; returns an empty list if none found or on error.
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
  // Config functions
  getValue,
  setValue,
  deleteValue,
  getAllConfigs,
  // Reminder functions
  getReminderData,
  setReminderData,
  deleteReminderData,
  // Tracked member functions
  trackNewMember,
  getTrackedMember,
  removeTrackedMember,
  getAllTrackedMembers
};
