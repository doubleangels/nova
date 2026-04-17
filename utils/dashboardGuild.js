const logger = require('../logger')('dashboard:guild');

/**
 * Resolves which guild the dashboard and OAuth flows target.
 * When the bot is in multiple guilds, set DASHBOARD_GUILD_ID to the guild snowflake.
 *
 * @param {import('discord.js').Client} client
 * @returns {import('discord.js').Guild | null}
 */
function getDashboardGuild(client) {
  if (!client?.guilds?.cache) return null;

  const envId = String(process.env.DASHBOARD_GUILD_ID || '').trim();
  if (envId) {
    const g = client.guilds.cache.get(envId);
    if (!g) {
      logger.warn('DASHBOARD_GUILD_ID does not match any guild the bot is currently in.', { guildId: envId });
    }
    return g || null;
  }

  if (client.guilds.cache.size === 1) {
    return client.guilds.cache.first() || null;
  }
  if (client.guilds.cache.size === 0) {
    return null;
  }

  logger.warn(
    'The bot is in more than one guild. Set DASHBOARD_GUILD_ID in the environment so the dashboard and OAuth use the correct server.'
  );
  return null;
}

module.exports = { getDashboardGuild };
