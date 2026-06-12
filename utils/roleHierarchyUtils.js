/**
 * Shared role hierarchy checks for moderator commands.
 * Mirrors spam-mode moderation rules: guild owner bypass, strict position comparisons.
 */

/**
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').Guild} guild
 * @returns {boolean}
 */
function isGuildOwner(member, guild) {
  return Boolean(member && guild && member.id === guild.ownerId);
}

/**
 * @param {import('discord.js').GuildMember} botMember
 * @param {import('discord.js').Role} role
 * @returns {boolean}
 */
function canBotManageRole(botMember, role) {
  if (!botMember || !role) return false;
  if (role.managed) return false;
  return botMember.roles.highest.position > role.position;
}

/**
 * @param {import('discord.js').GuildMember} invokerMember
 * @param {import('discord.js').Role} role
 * @param {import('discord.js').Guild} guild
 * @returns {boolean}
 */
function canInvokerManageRole(invokerMember, role, guild) {
  if (!invokerMember || !role || !guild) return false;
  if (isGuildOwner(invokerMember, guild)) return true;
  return invokerMember.roles.highest.position > role.position;
}

/**
 * @param {import('discord.js').GuildMember} invokerMember
 * @param {import('discord.js').GuildMember} targetMember
 * @param {import('discord.js').Guild} guild
 * @returns {boolean}
 */
function canInvokerModerateMember(invokerMember, targetMember, guild) {
  if (!invokerMember || !targetMember || !guild) return false;
  if (guild.ownerId && targetMember.id === guild.ownerId) return false;
  if (isGuildOwner(invokerMember, guild)) return true;
  return invokerMember.roles.highest.position > targetMember.roles.highest.position;
}

/**
 * @param {import('discord.js').GuildMember} botMember
 * @param {number} rolePosition
 * @returns {boolean}
 */
function canBotManageRolePosition(botMember, rolePosition) {
  if (!botMember || !Number.isFinite(rolePosition)) return false;
  return botMember.roles.highest.position > rolePosition;
}

/**
 * @param {import('discord.js').GuildMember} invokerMember
 * @param {number} rolePosition
 * @param {import('discord.js').Guild} guild
 * @returns {boolean}
 */
function canInvokerManageRolePosition(invokerMember, rolePosition, guild) {
  if (!invokerMember || !Number.isFinite(rolePosition) || !guild) return false;
  if (isGuildOwner(invokerMember, guild)) return true;
  return invokerMember.roles.highest.position > rolePosition;
}

/**
 * @param {{
 *   botMember: import('discord.js').GuildMember,
 *   invokerMember: import('discord.js').GuildMember,
 *   role: import('discord.js').Role,
 *   targetMember?: import('discord.js').GuildMember,
 *   guild: import('discord.js').Guild
 * }} params
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateExistingRoleChange(params) {
  const { botMember, invokerMember, role, targetMember, guild } = params;

  if (role.managed) {
    return {
      ok: false,
      message: '⚠️ This role is managed by an integration and cannot be modified.'
    };
  }

  if (!canBotManageRole(botMember, role)) {
    return {
      ok: false,
      message: "⚠️ I don't have permission to manage this role."
    };
  }

  if (!canInvokerManageRole(invokerMember, role, guild)) {
    return {
      ok: false,
      message: '⚠️ You cannot manage a role that is above or equal to your highest role.'
    };
  }

  if (targetMember && !canInvokerModerateMember(invokerMember, targetMember, guild)) {
    return {
      ok: false,
      message: '⚠️ You cannot manage this member (role hierarchy).'
    };
  }

  return { ok: true };
}

module.exports = {
  isGuildOwner,
  canBotManageRole,
  canInvokerManageRole,
  canInvokerModerateMember,
  canBotManageRolePosition,
  canInvokerManageRolePosition,
  validateExistingRoleChange
};
