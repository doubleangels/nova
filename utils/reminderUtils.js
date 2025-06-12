/**
 * Reminder utilities module for handling server reminders and notifications.
 * Manages bump and promotion reminders with Discord timestamps.
 * @module utils/reminderUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('./database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Creates a reminder for a user.
 * @async
 * @function createReminder
 * @param {string} userId - The user ID to create reminder for
 * @param {string} type - The type of reminder ('bump' or 'promote')
 * @param {number} hours - Hours until reminder
 * @returns {Promise<boolean>} Whether the reminder was created successfully
 */
async function createReminder(userId, type, hours) {
    try {
        const reminderTime = dayjs().add(hours, 'hour');
        const reminderTimestamp = reminderTime.valueOf();
        
        const reminderData = {
            type,
            timestamp: reminderTimestamp,
            hours
        };
        
        await setValue(`reminder_${userId}`, reminderData);
        
        const confirmationMessage = type === 'bump' 
            ? "Thanks for bumping! I'll remind you again <t:%s:R>."
            : "🎯 Server promoted successfully! I'll remind you to promote again <t:%s:R>.";
            
        return {
            success: true,
            message: confirmationMessage.replace('%s', Math.floor(reminderTimestamp / 1000))
        };
    } catch (error) {
        logger.error(`Error creating reminder for user ${userId}:`, error);
        throw new Error("⚠️ Failed to create reminder.");
    }
}

/**
 * Sends a reminder notification to a user.
 * @async
 * @function sendReminderNotification
 * @param {User} user - The user to send notification to
 * @param {string} type - The type of reminder ('bump' or 'promote')
 * @returns {Promise<void>}
 */
async function sendReminderNotification(user, type) {
    try {
        const notificationMessage = type === 'bump'
            ? " Time to bump the server! Use `/bump` to help us grow!"
            : " Time to promote the server! Use `/promote` to post on Reddit!";
            
        const emoji = type === 'bump' ? '🔔' : '🎯';
        
        await user.send(`${emoji}${notificationMessage}`);
        logger.info(`Sent ${type} reminder notification to ${user.tag}`);
    } catch (error) {
        logger.error(`Error sending reminder notification to ${user.tag}:`, error);
    }
}

/**
 * Checks and processes due reminders.
 * @async
 * @function checkReminders
 * @param {Client} client - The Discord client instance
 * @returns {Promise<void>}
 */
async function checkReminders(client) {
    try {
        const now = Date.now();
        const reminders = await getValue('reminders') || {};
        
        for (const [userId, reminder] of Object.entries(reminders)) {
            if (reminder.timestamp <= now) {
                const user = await client.users.fetch(userId).catch(() => null);
                
                if (user) {
                    await sendReminderNotification(user, reminder.type);
                }
                
                delete reminders[userId];
            }
        }
        
        await setValue('reminders', reminders);
    } catch (error) {
        logger.error('Error checking reminders:', error);
    }
}

/**
 * Reschedules a reminder for a user.
 * @async
 * @function rescheduleReminder
 * @param {string} userId - The user ID to reschedule reminder for
 * @param {string} type - The type of reminder ('bump' or 'promote')
 * @param {number} hours - Hours until reminder
 * @returns {Promise<boolean>} Whether the reminder was rescheduled successfully
 */
async function rescheduleReminder(userId, type, hours) {
    try {
        const reminderTime = dayjs().add(hours, 'hour');
        const reminderTimestamp = reminderTime.valueOf();
        
        const reminderData = {
            type,
            timestamp: reminderTimestamp,
            hours
        };
        
        await setValue(`reminder_${userId}`, reminderData);
        
        const confirmationMessage = type === 'bump'
            ? "Thanks for bumping! I'll remind you again <t:%s:R>."
            : "🎯 Server promoted successfully! I'll remind you to promote again <t:%s:R>.";
            
        return {
            success: true,
            message: confirmationMessage.replace('%s', Math.floor(reminderTimestamp / 1000))
        };
    } catch (error) {
        logger.error(`Error rescheduling reminder for user ${userId}:`, error);
        throw new Error("⚠️ Failed to reschedule reminder.");
    }
}

/**
 * Gets the remaining time for a user's reminder.
 * @async
 * @function getRemainingTime
 * @param {string} userId - The user ID to check
 * @returns {Promise<number|null>} Remaining time in milliseconds, or null if no reminder
 */
async function getRemainingTime(userId) {
    try {
        const reminder = await getValue(`reminder_${userId}`);
        
        if (!reminder) {
            return null;
        }
        
        const remaining = reminder.timestamp - Date.now();
        return remaining > 0 ? remaining : 0;
    } catch (error) {
        logger.error(`Error getting remaining time for user ${userId}:`, error);
        return null;
    }
}

module.exports = {
    createReminder,
    sendReminderNotification,
    checkReminders,
    rescheduleReminder,
    getRemainingTime
};
