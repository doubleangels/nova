const dayjs = require('dayjs');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const msgs = require('./predictionMessages');

const OPEN_STATUSES = new Set(['NS', 'TBD', 'PST']);

/**
 * @param {string} isoDate
 * @param {'t'|'T'|'d'|'D'|'f'|'F'|'R'} [style='f']
 * @returns {string}
 */
function formatDiscordTimestamp(isoDate, style = 'f') {
  const unix = Math.floor(new Date(isoDate).getTime() / 1000);
  if (!Number.isFinite(unix)) return 'TBD';
  return `<t:${unix}:${style}>`;
}

/**
 * @param {import('./predictionGameStore').PendingPrediction|null|undefined} pending
 * @returns {boolean}
 */
function isPendingPredictionComplete(pending) {
  const { isPendingPredictionComplete: check } = require('./predictionGameStore');
  return check(pending);
}

/**
 * @param {{ kickoff?: string, status: string }} fixture
 * @param {Date} [now]
 * @returns {boolean}
 */
function isFixtureOpenForPrediction(fixture, now = new Date()) {
  if (!fixture) return false;
  if (!OPEN_STATUSES.has(fixture.status)) return false;
  if (!fixture.kickoff) return true;
  return dayjs(fixture.kickoff).isAfter(dayjs(now));
}

/**
 * @param {{ kickoff?: string, status: string }} fixture
 * @param {Date} [now]
 * @param {number} [reminderHours]
 * @returns {boolean}
 */
function isInReminderWindow(
  fixture,
  now = new Date(),
  reminderHours = config.predictionReminderHours
) {
  if (!fixture.kickoff || !OPEN_STATUSES.has(fixture.status)) return false;
  const kickoff = dayjs(fixture.kickoff);
  const start = kickoff.subtract(reminderHours, 'hour');
  const current = dayjs(now);
  return (current.isAfter(start) || current.isSame(start)) && current.isBefore(kickoff);
}

/**
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncateModalLabel(text, maxLength = 45) {
  const s = String(text || '').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1)}…`;
}

/**
 * @param {object} fixture
 * @param {(fixture: object, side: 'home'|'away') => string} formatTeam
 * @param {(fixture: object) => string} [formatLinePrefix]
 * @returns {string}
 */
function formatFixtureLine(fixture, formatTeam, formatLinePrefix) {
  const kickoff = fixture.kickoff
    ? formatDiscordTimestamp(fixture.kickoff)
    : 'TBD';
  const prefix = formatLinePrefix ? formatLinePrefix(fixture) : '';
  return `${prefix}**${formatTeam(fixture, 'home')}** vs **${formatTeam(fixture, 'away')}** - ${kickoff} (\`${fixture.status}\`)`;
}

/**
 * @param {object} fixture
 * @param {(fixture: object, side: 'home'|'away') => string} formatTeam
 * @param {'home'|'draw'|'away'} resultPick
 * @returns {string}
 */
function formatResultPickDisplay(fixture, formatTeam, resultPick) {
  if (resultPick === 'home') return formatTeam(fixture, 'home');
  if (resultPick === 'away') return formatTeam(fixture, 'away');
  if (resultPick === 'draw') return 'Draw';
  return resultPick;
}

/**
 * @param {'worldcup'|'club'} gameId
 * @param {object} fixture
 * @param {(fixture: object, side: 'home'|'away') => string} formatTeam
 * @param {(fixture: object) => string} [formatLinePrefix]
 * @param {{ aiPrediction?: import('./matchPredictionAi').AiMatchPrediction }} [options]
 * @returns {EmbedBuilder}
 */
function buildPromptEmbed(gameId, fixture, formatTeam, formatLinePrefix, options = {}) {
  const league =
    gameId === 'club'
      ? fixture.competitionName || fixture.competitionCode
      : undefined;

  const embed = new EmbedBuilder()
    .setColor(msgs.GAME[gameId].embedColor)
    .setTitle(msgs.buildPromptTitle(gameId, league))
    .setDescription(
      `${formatFixtureLine(fixture, formatTeam, formatLinePrefix)}\n\n${msgs.buildPromptDescription(fixture, formatTeam)}`
    )
    .setFooter({ text: msgs.PROMPT_FOOTER });

  if (options.aiPrediction) {
    embed.addFields({
      name: msgs.AI_PICK_FIELD_NAME,
      value: msgs
        .formatAiPredictionField(fixture, options.aiPrediction, formatTeam)
        .slice(0, 1024)
    });
  }

  return embed;
}

/**
 * @param {'worldcup'|'club'} gameId
 * @param {object} fixture
 * @param {Array<{ userId: string, scorePoints: number, resultPoints: number, total: number }>} earners
 * @param {(fixture: object, side: 'home'|'away') => string} formatTeam
 * @param {(fixture: object) => string} [formatLinePrefix]
 * @returns {EmbedBuilder}
 */
function buildAnnouncementEmbed(
  gameId,
  fixture,
  earners,
  formatTeam,
  formatLinePrefix
) {
  const home = fixture.goals.home ?? '?';
  const away = fixture.goals.away ?? '?';
  const embed = new EmbedBuilder()
    .setColor(msgs.GAME[gameId].embedColor)
    .setTitle(
      `Full Time - ${formatTeam(fixture, 'home')} ${home}-${away} ${formatTeam(fixture, 'away')}`
    )
    .setDescription(formatFixtureLine(fixture, formatTeam, formatLinePrefix));

  embed.addFields({
    name: msgs.POINTS_FIELD_NAME,
    value: msgs.formatPointsEarnedField(earners).slice(0, 1024)
  });

  embed.setFooter({ text: msgs.buildResultsFooter(gameId) });
  return embed;
}

/**
 * @param {string} raw
 * @param {object} [fixture]
 * @param {(fixture: object, side: 'home'|'away') => string} [formatTeam]
 * @returns {'home'|'draw'|'away'|null}
 */
function parseResultPick(raw, fixture, formatTeam) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'draw' || normalized === 'd') return 'draw';

  if (fixture) {
    const homeRaw = String(fixture.home || '').trim().toLowerCase();
    const awayRaw = String(fixture.away || '').trim().toLowerCase();
    if (normalized === homeRaw) return 'home';
    if (normalized === awayRaw) return 'away';

    if (formatTeam) {
      const homeNorm = formatTeam(fixture, 'home').trim().toLowerCase();
      const awayNorm = formatTeam(fixture, 'away').trim().toLowerCase();
      if (normalized === homeNorm) return 'home';
      if (normalized === awayNorm) return 'away';
    }
  }

  if (normalized === 'home' || normalized === 'h') return 'home';
  if (normalized === 'away' || normalized === 'a') return 'away';
  return null;
}

/**
 * @param {string} homeRaw
 * @param {string} awayRaw
 * @param {object} [fixture]
 * @param {(fixture: object, side: 'home'|'away') => string} [formatTeam]
 * @returns {{ homeScore: number, awayScore: number }|{ error: string }}
 */
function parseScoreInputs(homeRaw, awayRaw, fixture, formatTeam) {
  const homeLabel = fixture && formatTeam ? formatTeam(fixture, 'home') : 'Home';
  const awayLabel = fixture && formatTeam ? formatTeam(fixture, 'away') : 'Away';
  const homeScore = parseInt(String(homeRaw).trim(), 10);
  const awayScore = parseInt(String(awayRaw).trim(), 10);
  if (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 15) {
    return { error: `${homeLabel} score must be a whole number from 0 to 15.` };
  }
  if (!Number.isInteger(awayScore) || awayScore < 0 || awayScore > 15) {
    return { error: `${awayLabel} score must be a whole number from 0 to 15.` };
  }
  return { homeScore, awayScore };
}

/**
 * @param {object} fixture
 * @param {(fixture: object, side: 'home'|'away') => string} formatTeam
 * @returns {string}
 */
function formatResultPickOptions(fixture, formatTeam) {
  return `**${formatTeam(fixture, 'home')}**, **draw**, or **${formatTeam(fixture, 'away')}**`;
}

/**
 * @param {string} teamName
 * @returns {string}
 */
function goalsModalLabel(teamName) {
  return truncateModalLabel(`${truncateModalLabel(teamName, 38)} goals`, 45);
}

module.exports = {
  OPEN_STATUSES,
  formatDiscordTimestamp,
  isPendingPredictionComplete,
  isFixtureOpenForPrediction,
  isInReminderWindow,
  truncateModalLabel,
  formatFixtureLine,
  formatResultPickDisplay,
  buildPromptEmbed,
  buildAnnouncementEmbed,
  parseResultPick,
  parseScoreInputs,
  formatResultPickOptions,
  goalsModalLabel
};
