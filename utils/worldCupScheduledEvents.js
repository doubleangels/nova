const dayjs = require('dayjs');
const {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel
} = require('discord.js');
const { formatFixtureTeam } = require('./worldCupTeamFlags');
const { isFixtureOpenForPrediction } = require('./predictionGameUi');

const EVENT_NAME_MAX_LENGTH = 100;
const EVENT_LOCATION_MAX_LENGTH = 100;
const EVENT_DESCRIPTION_MAX_LENGTH = 1000;
const MATCH_DURATION_HOURS = 2;
const FIXTURE_ID_MARKER_PREFIX = 'Match ID:';

const INELIGIBLE_STATUSES = new Set(['FT', 'CANC', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @returns {string}
 */
function buildScheduledEventName(fixture) {
  const name = `${formatFixtureTeam(fixture, 'home')} vs. ${formatFixtureTeam(fixture, 'away')}`;
  if (name.length <= EVENT_NAME_MAX_LENGTH) return name;
  return `${name.slice(0, EVENT_NAME_MAX_LENGTH - 1)}…`;
}

/**
 * @param {string} isoDate
 * @returns {string}
 */
function formatKickoffTimestamp(isoDate) {
  const unix = Math.floor(new Date(isoDate).getTime() / 1000);
  if (!Number.isFinite(unix)) return 'TBD';
  return `<t:${unix}:F>`;
}

/**
 * @param {string|null|undefined} stage
 * @returns {string|null}
 */
function formatStageLabel(stage) {
  if (!stage) return null;
  return stage
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @returns {string}
 */
function buildScheduledEventDescription(fixture) {
  const lines = [];

  if (fixture.venue) {
    lines.push(`🏟️ ${fixture.venue}`);
  }

  const stageLabel = formatStageLabel(fixture.stage);
  if (stageLabel) {
    lines.push(`Stage: ${stageLabel}`);
  }

  if (fixture.group) {
    lines.push(`Group: ${fixture.group.replace(/_/g, ' ')}`);
  }

  if (fixture.kickoff) {
    lines.push(`Kickoff: ${formatKickoffTimestamp(fixture.kickoff)}`);
  }

  lines.push(`${FIXTURE_ID_MARKER_PREFIX} ${fixture.id}`);

  const description = lines.join('\n');
  if (description.length <= EVENT_DESCRIPTION_MAX_LENGTH) return description;
  return `${description.slice(0, EVENT_DESCRIPTION_MAX_LENGTH - 1)}…`;
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @returns {string}
 */
function buildScheduledEventLocation(fixture) {
  const venue = String(fixture.venue || '').trim();
  const location = venue || 'FIFA World Cup 2026';
  if (location.length <= EVENT_LOCATION_MAX_LENGTH) return location;
  return `${location.slice(0, EVENT_LOCATION_MAX_LENGTH - 1)}…`;
}

/**
 * @param {number} fixtureId
 * @returns {RegExp}
 */
function fixtureIdMarkerRegex(fixtureId) {
  return new RegExp(`${FIXTURE_ID_MARKER_PREFIX}\\s*${fixtureId}\\b`);
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @param {Date} [now]
 * @returns {boolean}
 */
function isFixtureEligibleForScheduledEvent(fixture, now = new Date()) {
  if (!fixture?.kickoff) return false;
  if (INELIGIBLE_STATUSES.has(fixture.status)) return false;
  return isFixtureOpenForPrediction(fixture, now);
}

/**
 * @param {import('discord.js').Collection<string, import('discord.js').GuildScheduledEvent>} existingEvents
 * @param {number} fixtureId
 * @returns {boolean}
 */
function hasExistingEventForFixture(existingEvents, fixtureId) {
  const marker = fixtureIdMarkerRegex(fixtureId);
  for (const event of existingEvents.values()) {
    if (marker.test(event.description || '')) return true;
  }
  return false;
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @returns {import('discord.js').GuildScheduledEventCreateOptions}
 */
function buildScheduledEventCreateOptions(fixture) {
  return {
    name: buildScheduledEventName(fixture),
    description: buildScheduledEventDescription(fixture),
    scheduledStartTime: fixture.kickoff,
    scheduledEndTime: dayjs(fixture.kickoff).add(MATCH_DURATION_HOURS, 'hour').toDate(),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: {
      location: buildScheduledEventLocation(fixture)
    }
  };
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('./worldCupUtils').NormalizedFixture[]} fixtures
 * @param {Date} [now]
 * @returns {Promise<{ created: number, skipped: number, failed: number, errors: string[] }>}
 */
async function syncWorldCupScheduledEvents(guild, fixtures, now = new Date()) {
  const existingEvents = await guild.scheduledEvents.fetch();
  const result = { created: 0, skipped: 0, failed: 0, errors: [] };

  const eligible = fixtures.filter(fixture =>
    isFixtureEligibleForScheduledEvent(fixture, now)
  );

  for (const fixture of eligible) {
    if (hasExistingEventForFixture(existingEvents, fixture.id)) {
      result.skipped += 1;
      continue;
    }

    try {
      const created = await guild.scheduledEvents.create(
        buildScheduledEventCreateOptions(fixture)
      );
      existingEvents.set(created.id, created);
      result.created += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Fixture ${fixture.id}: ${message}`);
    }
  }

  result.skipped += fixtures.length - eligible.length;
  return result;
}

module.exports = {
  EVENT_NAME_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  MATCH_DURATION_HOURS,
  FIXTURE_ID_MARKER_PREFIX,
  buildScheduledEventName,
  buildScheduledEventDescription,
  buildScheduledEventLocation,
  isFixtureEligibleForScheduledEvent,
  hasExistingEventForFixture,
  buildScheduledEventCreateOptions,
  syncWorldCupScheduledEvents
};
