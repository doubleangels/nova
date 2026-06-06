/**
 * @param {import('discord.js').Client['guilds']['cache']} cache
 * @returns {import('discord.js').Guild[]}
 */
function listGuilds(cache) {
  if (!cache) return [];
  if (typeof cache.values === 'function') {
    return [...cache.values()];
  }
  if (typeof cache.first === 'function') {
    const guild = cache.first();
    return guild ? [guild] : [];
  }
  return [];
}

/**
 * Resolves the primary guild for this single-guild bot.
 * @param {import('discord.js').Client} client
 * @param {{ guildId?: string|null, warn?: (message: string, meta?: object) => void }} [options]
 * @returns {import('discord.js').Guild|null}
 */
function resolvePrimaryGuild(client, options = {}) {
  const warn = options.warn ?? (() => {});
  const configuredGuildId = options.guildId?.trim() || null;
  const guilds = listGuilds(client.guilds?.cache);

  if (guilds.length === 0) {
    warn('Bot is not in any guild.');
    return null;
  }

  if (configuredGuildId) {
    const guild = client.guilds.cache.get(configuredGuildId);
    if (!guild) {
      warn('GUILD_ID is set but the bot is not a member of that guild.', {
        guildId: configuredGuildId,
        memberOfGuildIds: guilds.map((g) => g.id)
      });
      return null;
    }
    return guild;
  }

  if (guilds.length > 1) {
    warn('Bot is in multiple guilds but GUILD_ID is not set; using the first guild.', {
      guildIds: guilds.map((g) => g.id)
    });
  }

  return guilds[0];
}

module.exports = {
  listGuilds,
  resolvePrimaryGuild
};
