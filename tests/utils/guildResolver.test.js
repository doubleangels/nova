const { resolvePrimaryGuild } = require('../../utils/guildResolver');

function createClient(guilds) {
  return {
    guilds: {
      cache: new Map(guilds.map((guild) => [guild.id, guild]))
    }
  };
}

describe('guildResolver', () => {
  it('should return null when the bot is not in any guild', () => {
    const client = createClient([]);
    const warn = jest.fn();

    expect(resolvePrimaryGuild(client, { warn })).toBeNull();
    expect(warn).toHaveBeenCalledWith('Bot is not in any guild.');
  });

  it('should return the configured guild when GUILD_ID matches', () => {
    const guildA = { id: '111111111111111111', name: 'A' };
    const guildB = { id: '222222222222222222', name: 'B' };
    const client = createClient([guildA, guildB]);

    expect(resolvePrimaryGuild(client, { guildId: guildB.id })).toBe(guildB);
  });

  it('should warn and return null when configured guild is missing', () => {
    const guildA = { id: '111111111111111111', name: 'A' };
    const client = createClient([guildA]);
    const warn = jest.fn();

    expect(resolvePrimaryGuild(client, { guildId: '999999999999999999', warn })).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'GUILD_ID is set but the bot is not a member of that guild.',
      expect.objectContaining({ guildId: '999999999999999999' })
    );
  });

  it('should warn and use the first guild when multiple guilds exist without GUILD_ID', () => {
    const guildA = { id: '111111111111111111', name: 'A' };
    const guildB = { id: '222222222222222222', name: 'B' };
    const client = createClient([guildA, guildB]);
    const warn = jest.fn();

    expect(resolvePrimaryGuild(client, { warn })).toBe(guildA);
    expect(warn).toHaveBeenCalledWith(
      'Bot is in multiple guilds but GUILD_ID is not set; using the first guild.',
      expect.objectContaining({ guildIds: [guildA.id, guildB.id] })
    );
  });

  it('should return the only guild without warning when GUILD_ID is unset', () => {
    const guildA = { id: '111111111111111111', name: 'A' };
    const client = createClient([guildA]);
    const warn = jest.fn();

    expect(resolvePrimaryGuild(client, { warn })).toBe(guildA);
    expect(warn).not.toHaveBeenCalled();
  });

  it('should default options when the second argument is omitted', () => {
    const guildA = { id: '111111111111111111', name: 'A' };
    const client = createClient([guildA]);

    expect(resolvePrimaryGuild(client)).toBe(guildA);
  });

  it('should support discord.js style caches without a first() helper', () => {
    const { listGuilds } = require('../../utils/guildResolver');
    expect(listGuilds(null)).toEqual([]);
    expect(listGuilds(undefined)).toEqual([]);
    expect(listGuilds({})).toEqual([]);

    const guildA = { id: '111111111111111111', name: 'A' };
    const client = {
      guilds: {
        cache: new Map([[guildA.id, guildA]])
      }
    };

    expect(resolvePrimaryGuild(client, {})).toBe(guildA);
  });

  it('should return null when cache.first() returns no guild', () => {
    const client = {
      guilds: {
        cache: {
          first: () => null
        }
      }
    };

    expect(resolvePrimaryGuild(client, {})).toBeNull();
  });
});
