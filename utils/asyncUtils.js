/**
 * Runs async tasks with a concurrency limit.
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @returns {Promise<T[]>}
 */
async function runWithConcurrency(tasks, limit = 3) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Safely fetches the bot member in a guild, falling back to fetchMe() if uncached.
 * @param {CommandInteraction} interaction
 * @returns {Promise<GuildMember|null>}
 */
async function getBotMember(interaction) {
  if (!interaction?.guild?.members) return null;
  return interaction.guild.members.me || await interaction.guild.members.fetchMe();
}

module.exports = { runWithConcurrency, getBotMember };
