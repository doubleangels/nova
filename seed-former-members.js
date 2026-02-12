/**
 * One-off script to add all current guild members (non-bots only) to the former-member database.
 * So when they leave and re-join, they get the "been in server before" role.
 * Bots are always skipped for this feature.
 *
 * Usage: node seed-former-members.js
 *
 * Requires: DISCORD_BOT_TOKEN (and optionally GUILD_ID if bot is in multiple guilds).
 * Ensure the database is accessible (e.g. run from project root with .env, or set DATA_DIR).
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { initializeDatabase, setFormerMember } = require('./utils/database');
const config = require('./config');

async function main() {
  if (!config.token) {
    console.error('DISCORD_BOT_TOKEN is not set.');
    process.exit(1);
  }

  console.log('Initializing database...');
  await initializeDatabase();
  console.log('Database ready.');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  const guildId = process.env.GUILD_ID;

  return new Promise((resolve, reject) => {
    client.once('clientReady', async () => {
      try {
        const guild = guildId
          ? client.guilds.cache.get(guildId)
          : client.guilds.cache.first();

        if (!guild) {
          console.error(guildId ? `Guild ${guildId} not found.` : 'Bot is not in any guild.');
          client.destroy();
          process.exit(1);
        }

        console.log(`Fetching all members for guild: ${guild.name} (${guild.id})...`);
        await guild.members.fetch({ force: true });

        const members = guild.members.cache.filter(m => !m.user.bot);
        let added = 0;

        for (const [, member] of members) {
          await setFormerMember(member.id);
          added++;
          if (added % 100 === 0) {
            console.log(`  ... ${added}/${members.size}`);
          }
        }

        console.log(`Done. Added ${added} member(s) to the former-member database (bots always skipped).`);
        client.destroy();
        resolve();
      } catch (err) {
        console.error('Error:', err.message);
        client.destroy();
        reject(err);
        process.exit(1);
      }
    });

    client.login(config.token).catch(err => {
      console.error('Login failed:', err.message);
      reject(err);
      process.exit(1);
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
