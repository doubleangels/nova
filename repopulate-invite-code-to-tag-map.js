/**
 * Script to repopulate the invite code-to-tag mapping for all guilds
 * 
 * This script:
 * 1. Connects to Discord to get all guilds the bot is in
 * 2. Reads all invite tags from the database
 * 3. Rebuilds the code-to-tag mapping for each guild
 * 
 * Usage: node repopulate-invite-code-to-tag-map.js
 * 
 * Note: Requires DISCORD_BOT_TOKEN to be set in .env
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { initializeDatabase, rebuildCodeToTagMap } = require('./utils/database');

async function repopulateInviteCodeToTagMap() {
  try {
    // Initialize database
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized.');

    // Initialize Discord client
    console.log('Connecting to Discord...');
    const client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });

    await new Promise((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
      client.login(process.env.DISCORD_BOT_TOKEN).catch(reject);
    });

    console.log(`✅ Connected to Discord as ${client.user.tag}.`);
    console.log(`Found ${client.guilds.cache.size} guild(s).\n`);

    // Rebuild mapping for each guild
    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const guild of client.guilds.cache.values()) {
      try {
        console.log(`Processing guild: ${guild.name} (${guild.id})...`);
        const codeToTagMap = await rebuildCodeToTagMap(guild.id);
        const entryCount = Object.keys(codeToTagMap).length;
        
        if (entryCount > 0) {
          console.log(`  ✅ Rebuilt mapping with ${entryCount} entries`);
          successCount++;
          results.push({
            guild: guild.name,
            guildId: guild.id,
            entries: entryCount,
            status: 'success'
          });
        } else {
          console.log(`  ⚠️  No invite tags found to map`);
          results.push({
            guild: guild.name,
            guildId: guild.id,
            entries: 0,
            status: 'no_tags'
          });
        }
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        failCount++;
        results.push({
          guild: guild.name,
          guildId: guild.id,
          entries: 0,
          status: 'error',
          error: error.message
        });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log('='.repeat(60));
    console.log(`Total guilds: ${client.guilds.cache.size}`);
    console.log(`✅ Successfully rebuilt: ${successCount}`);
    console.log(`⚠️  No tags found: ${results.filter(r => r.status === 'no_tags').length}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('');

    if (results.length > 0) {
      console.log('Details:');
      results.forEach(result => {
        const statusIcon = result.status === 'success' ? '✅' : result.status === 'no_tags' ? '⚠️' : '❌';
        console.log(`  ${statusIcon} ${result.guild} (${result.guildId}): ${result.entries} entries${result.error ? ` - ${result.error}` : ''}`);
      });
    }

    // Cleanup
    client.destroy();
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
repopulateInviteCodeToTagMap();

