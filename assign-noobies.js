/**
 * One-off script to assign the Noobies role to members who have the
 * Creatures role but do NOT have the Fren role.
 *
 * Usage: node assign-noobies.js [--token=TOKEN] [--creatures=ROLE_ID]
 *
 * It will use config.js to get NOOBIES_ROLE_ID and FREN_ROLE_ID.
 */

require('dotenv').config();

const args = process.argv.slice(2);
let creaturesRoleId = null;

for (const arg of args) {
  if (arg === '--token' || arg === '-t') {
    const i = args.indexOf(arg);
    if (args[i + 1]) process.env.DISCORD_BOT_TOKEN = args[i + 1];
  }
  if (arg.startsWith('--token=')) {
    process.env.DISCORD_BOT_TOKEN = arg.slice(8);
  }
  if (arg.startsWith('--creatures=')) {
    creaturesRoleId = arg.slice(12);
  }
}

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

async function main() {
  if (!config.token) {
    console.error('DISCORD_BOT_TOKEN is not set. Set it in .env or pass with --token=TOKEN');
    process.exit(1);
  }

  if (!config.noobiesRoleId) {
    console.error('NOOBIES_ROLE_ID is not set in config/env. Cannot assign Noobies role.');
    process.exit(1);
  }

  if (!config.givePermsFrenRoleId) {
    console.error('GIVE_PERMS_FREN_ROLE_ID is not set in config/env. Cannot determine Fren role.');
    process.exit(1);
  }

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

        console.log(`Working on guild: ${guild.name} (${guild.id})`);

        // Find creatures role if not specifically provided
        if (!creaturesRoleId) {
          const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'creatures');
          if (role) {
            creaturesRoleId = role.id;
            console.log(`Found 'creatures' role by name: ID ${creaturesRoleId}`);
          } else {
            console.error('Could not automatically find a role named "creatures". Please pass --creatures=ROLE_ID');
            client.destroy();
            process.exit(1);
          }
        }

        console.log(`Fetching all members...`);
        await guild.members.fetch({ force: true });

        const members = guild.members.cache.filter(m => !m.user.bot);
        let assignedCount = 0;
        let checkedCount = 0;

        for (const [, member] of members) {
          checkedCount++;
          const hasCreatures = member.roles.cache.has(creaturesRoleId);
          const hasFren = member.roles.cache.has(config.givePermsFrenRoleId);
          const hasNoobies = member.roles.cache.has(config.noobiesRoleId);

          if (hasCreatures && !hasFren) {
            if (!hasNoobies) {
              console.log(`Assigning Noobies role to ${member.user.tag} (${member.id})`);
              await member.roles.add(config.noobiesRoleId, 'Assigned by temporary script (has creatures, lacks fren)');
              assignedCount++;
              
              // Sleep briefly to avoid discord API rate limits on massive assigns
              await new Promise(r => setTimeout(r, 500));
            }
          }
        }

        console.log(`Checked ${checkedCount} non-bot members. Assigned Noobies role to ${assignedCount} members.`);
        client.destroy();
        resolve();
      } catch (err) {
        console.error('Error:', err.message);
        client.destroy();
        reject(err);
      }
    });

    client.login(config.token).catch(err => {
      console.error('Login failed:', err.message);
      reject(err);
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
