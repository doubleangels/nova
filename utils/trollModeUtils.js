const logger = require('../logger')('trollModeUtils.js');
const dayjs = require('dayjs');
const { getValue } = require('../utils/database');
const { EmbedBuilder } = require('discord.js');

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
    logger.error(`Error checking account age for ${member.user.tag}:`, {
      error: error.message,
      stack: error.stack
    });
    return true;
  }
}

async function performKick(member) {
  try {
    const requiredAge = parseInt(await getValue('troll_mode_account_age'), 10) || 30;
    const accountAge = dayjs().diff(dayjs(member.user.createdAt), 'day');

    try {
      const embed = new EmbedBuilder()
        .setColor(0xCD41FF)
        .setTitle('Account Age Requirement')
        .setDescription(`You were kicked from Da Frens because your account is too new.`)
        .addFields(
          { name: 'Your Account Age', value: `${accountAge} days` },
          { name: 'Required Age', value: `${requiredAge} days` },
          { name: 'Want to rejoin?', value: 'You can rejoin at [dafrens.games](https://dafrens.games) once your account meets the age requirement.' }
        );
      await member.send({ embeds: [embed] });
    } catch (dmError) {
      logger.warn(`Failed to send DM to member ${member.user.tag} before kick:`, { error: dmError.message });
    }

    await member.kick("Account age does not meet server requirements.");
    logger.info(`Member ${member.user.tag} kicked due to insufficient account age.`, {
      accountAge,
      requiredAge
    });
  } catch (error) {
    logger.error(`Failed to kick member ${member.user.tag}:`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  checkAccountAge,
  performKick
}; 