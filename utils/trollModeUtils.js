const logger = require('../logger')('trollModeUtils.js');
const dayjs = require('dayjs');
const { getValue, getGuildName } = require('../utils/database');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');

/**
 * Checks if a member's account meets the minimum age requirement
 * @param {GuildMember} member - The member to check
 * @returns {Promise<boolean>} True if the account meets the age requirement or if troll mode is disabled
 * @throws {Error} If checking account age fails
 */
async function checkAccountAge(member) {
  try {
    const trollModeEnabled = await getValue('troll_mode_enabled');
    if (!trollModeEnabled) {
      return true;
    }

    const requiredAge = parseInt(await getValue('troll_mode_account_age'), 10) || 30;
    const accountAge = dayjs().diff(dayjs(member.user.createdAt), 'day');

    logger.debug(`Checking account age for ${member.user.tag}:`, {
      accountAge,
      requiredAge,
      createdAt: member.user.createdAt
    });

    return accountAge >= requiredAge;
  } catch (error) {
    logger.error(`Error checking account age for ${member.user.tag}:`, error);
    return true;
  }
}

/**
 * Performs a kick on a member who doesn't meet account age requirements
 * @param {GuildMember} member - The member to kick
 * @returns {Promise<void>}
 * @throws {Error} If the kick operation fails
 */
async function performKick(member) {
  try {
    const requiredAge = parseInt(await getValue('troll_mode_account_age'), 10) || 30;
    const accountAge = dayjs().diff(dayjs(member.user.createdAt), 'day');

    try {
      const inviteUrl = config.serverInviteUrl;
      const guildName = await getGuildName();
      const embed = new EmbedBuilder()
        .setColor(config.baseEmbedColor)
        .setTitle('Account Age Requirement')
        .setDescription(`You were kicked from ${guildName} because your account is too new.`)
        .addFields(
          { name: 'Your Account Age', value: `${accountAge} days` },
          { name: 'Required Age', value: `${requiredAge} days` },
          { name: 'Want to rejoin?', value: `You can rejoin at ${inviteUrl} once your account meets the age requirement.` }
        );
      await member.send({ embeds: [embed] });
    } catch (dmError) {
      logger.warn(`Failed to send DM to member ${member.user.tag} before kick:`, dmError);
    }

    await member.kick("Account age does not meet server requirements.");
    logger.info(`Member ${member.user.tag} kicked due to insufficient account age.`, {
      accountAge,
      requiredAge
    });
  } catch (error) {
    logger.error(`Failed to kick member ${member.user.tag}:`, error);
    throw error;
  }
}

module.exports = {
  checkAccountAge,
  performKick
}; 