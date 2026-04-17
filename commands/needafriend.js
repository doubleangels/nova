const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const dayjs = require('dayjs');
const logger = require('../logger')(path.basename(__filename));
const { redditApiRequest, isRedditConfigured } = require('../utils/redditClient');
const { handleReminder, getNextReminderTimeAfterCleanup, NEEDAFRIEND_REMINDER_MS } = require('../utils/reminderUtils');

const NEEDAFRIEND_SUBREDDIT = 'needafriend';

const WEEKLY_THREAD_TITLE = 'Weekly Discord Server Advertisement Thread';

const NEEDAFRIEND_COMMENT = `🐸 Da Frens | 21+ High-Energy Banter & Gaming
The home of sharp wit, sweaty games, and zero wallflowers.
🛸 The Vibe: Unfiltered honesty and real talk without the oversharing. We're rowdy, not reckless. 🎮 The Games: High-energy sessions where we play hard and laugh harder. 🔞 The Standard: 21+ only. We're looking for big personalities who actually participate - no spectators allowed.
Join the chaos: https://discord.gg/Z9rYazqCA6`;

/**
 * @param {string} title
 * @returns {string}
 */
function normalizeThreadTitle(title) {
  return (title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * @param {string} title
 * @returns {boolean}
 */
function isWeeklyAdvertisementThread(title) {
  const n = normalizeThreadTitle(title);
  const expected = normalizeThreadTitle(WEEKLY_THREAD_TITLE);
  if (n === expected) return true;
  return n.includes('weekly discord server advertisement');
}

/**
 * Prefer a stickied match, then any listing match (e.g. thread not sticky yet).
 * Fetches each listing once and does two passes in memory.
 * @returns {Promise<{ name: string, permalink: string, title: string, stickied?: boolean } | null>}
 */
async function findWeeklyAdvertisementPost() {
  const endpoints = [
    `/r/${NEEDAFRIEND_SUBREDDIT}/hot.json?limit=30`,
    `/r/${NEEDAFRIEND_SUBREDDIT}/new.json?limit=50`
  ];

  const listings = await Promise.all(
    endpoints.map((p) => redditApiRequest('GET', p))
  );

  const allPosts = listings.flatMap((listing) =>
    (listing?.data?.children || []).map((c) => c.data).filter(Boolean)
  );

  const sticky = allPosts.find((d) => d.stickied && isWeeklyAdvertisementThread(d.title));
  if (sticky) {
    return { name: sticky.name, permalink: sticky.permalink, title: sticky.title, stickied: true };
  }

  const any = allPosts.find((d) => isWeeklyAdvertisementThread(d.title));
  if (any) {
    return { name: any.name, permalink: any.permalink, title: any.title, stickied: !!any.stickied };
  }

  return null;
}

/**
 * @param {object} response - Reddit /api/comment JSON
 * @returns {{ permalink: string } | null}
 */
function parseCommentResponse(response) {
  const json = response?.json;
  if (!json || json.errors?.length) return null;
  const things = json.data?.things;
  const first = things?.[0]?.data;
  if (first?.permalink) {
    return { permalink: first.permalink };
  }
  return null;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function formatRedditCommentError(err) {
  const data = err.response?.data;
  if (data?.json?.errors?.length) {
    const e = data.json.errors[0];
    if (Array.isArray(e) && e.length >= 2) return `${e[0]}: ${e[1]}`;
    return String(e);
  }
  return err.message || 'Unknown Reddit error.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('needafriend')
    .setDescription('Comment on the r/needafriend weekly Discord server advertisement thread.')
    .setDefaultMemberPermissions(null),

  async execute(interaction) {
    if (!isRedditConfigured()) {
      return interaction.reply({
        content: '⚠️ This command is not properly configured. Please contact an administrator.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Cooldown check must happen before deferReply — once deferred publicly
    // Discord.js won't honour MessageFlags.Ephemeral on the subsequent editReply.
    const nextNeedafriendTime = await getNextReminderTimeAfterCleanup('needafriend');
    if (nextNeedafriendTime) {
      const now = dayjs();
      const nextTime = dayjs(nextNeedafriendTime);
      if (now.isBefore(nextTime)) {
        const totalMinutes = nextTime.diff(now, 'minute');
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
        if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
        if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
        return interaction.reply({
          content: `⚠️ Please wait ${parts.join(', ')} before using /needafriend again.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    await interaction.deferReply();

    try {
      const post = await findWeeklyAdvertisementPost();
      if (!post) {
        logger.warn('needafriend: weekly thread not found', { subreddit: NEEDAFRIEND_SUBREDDIT, expectedTitle: WEEKLY_THREAD_TITLE });
        return interaction.editReply({
          content: `⚠️ Could not find a post titled **${WEEKLY_THREAD_TITLE}** on r/${NEEDAFRIEND_SUBREDDIT} (checked hot and new). If the title changed, update \`WEEKLY_THREAD_TITLE\` in \`commands/needafriend.js\`.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const response = await redditApiRequest('POST', '/api/comment', {
        api_type: 'json',
        thing_id: post.name,
        text: NEEDAFRIEND_COMMENT
      });

      const parsed = parseCommentResponse(response);
      if (parsed) {
        const commentUrl = `https://www.reddit.com${parsed.permalink}`;
        logger.info('needafriend: comment posted', { post: post.name, commentPermalink: parsed.permalink });
        const embed = new EmbedBuilder()
          .setColor(0xFF4500)
          .setTitle('Comment Posted Successfully')
          .setDescription(
            `Your advertisement has been commented on the weekly thread on \`r/needafriend\`.\n\n• \`r/needafriend\`: [View thread](https://www.reddit.com${post.permalink})`
          );
        const mockMessage = { client: interaction.client };
        await handleReminder(mockMessage, NEEDAFRIEND_REMINDER_MS, 'needafriend');
        return interaction.editReply({ embeds: [embed] });
      }

      if (response?.json?.errors?.length) {
        const errMsg = response.json.errors.map((e) => (Array.isArray(e) ? e.join(': ') : String(e))).join(', ');
        return interaction.editReply({
          content: `⚠️ Reddit rejected the comment: ${errMsg}`,
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.editReply({
        content: '⚠️ Could not parse Reddit response after commenting.',
        flags: MessageFlags.Ephemeral
      });
    } catch (err) {
      logger.error('needafriend command failed', { err });
      return interaction.editReply({
        content: `⚠️ ${formatRedditCommentError(err)}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
