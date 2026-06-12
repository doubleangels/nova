const dayjs = require('dayjs');
const { Collection } = require('discord.js');

describe('worldCupScheduledEvents', () => {
  let events;

  const futureKickoff = () => dayjs().add(3, 'day').toISOString();

  const sampleFixture = (overrides = {}) => ({
    id: 100,
    home: 'Brazil',
    away: 'Argentina',
    homeIso2: 'BR',
    awayIso2: 'AR',
    homeTla: 'BRA',
    awayTla: 'ARG',
    kickoff: futureKickoff(),
    status: 'NS',
    venue: 'MetLife Stadium',
    stage: 'GROUP_STAGE',
    group: 'GROUP_A',
    goals: { home: null, away: null },
    ...overrides
  });

  beforeEach(() => {
    jest.resetModules();
    events = require('../../utils/worldCupScheduledEvents');
  });

  describe('buildScheduledEventName', () => {
    it('should format teams with flags', () => {
      const name = events.buildScheduledEventName(sampleFixture());
      expect(name).toContain('Brazil');
      expect(name).toContain('Argentina');
      expect(name).toContain('vs.');
    });
  });

  describe('buildScheduledEventDescription', () => {
    it('should include venue stage group kickoff and match id', () => {
      const description = events.buildScheduledEventDescription(sampleFixture());
      expect(description).toContain('MetLife Stadium');
      expect(description).toContain('Stage: Group Stage');
      expect(description).toContain('Group: GROUP A');
      expect(description).toContain('Kickoff:');
      const noKickoff = events.buildScheduledEventDescription(
        sampleFixture({ kickoff: null })
      );
      expect(noKickoff).not.toContain('Kickoff:');
      expect(description).toContain('Match ID: 100');
    });
  });

  describe('buildScheduledEventLocation', () => {
    it('should use venue when present', () => {
      expect(events.buildScheduledEventLocation(sampleFixture())).toBe('MetLife Stadium');
    });

    it('should fall back when venue missing', () => {
      expect(events.buildScheduledEventLocation(sampleFixture({ venue: null }))).toBe(
        'FIFA World Cup 2026'
      );
    });
  });

  describe('isFixtureEligibleForScheduledEvent', () => {
    it('should accept future open fixtures', () => {
      expect(events.isFixtureEligibleForScheduledEvent(sampleFixture())).toBe(true);
    });

    it('should reject past kickoff', () => {
      const fixture = sampleFixture({
        kickoff: dayjs().subtract(1, 'hour').toISOString()
      });
      expect(events.isFixtureEligibleForScheduledEvent(fixture)).toBe(false);
    });

    it('should reject finished fixtures', () => {
      expect(events.isFixtureEligibleForScheduledEvent(sampleFixture({ status: 'FT' }))).toBe(false);
    });
  });

  describe('hasExistingEventForFixture', () => {
    it('should detect fixture id marker in description', () => {
      const collection = new Collection([
        ['1', { description: 'Kickoff soon\nMatch ID: 100' }]
      ]);
      expect(events.hasExistingEventForFixture(collection, 100)).toBe(true);
      expect(events.hasExistingEventForFixture(collection, 101)).toBe(false);
    });
  });

  describe('buildScheduledEventCreateOptions', () => {
    it('should set external event with two hour end time', () => {
      const fixture = sampleFixture();
      const options = events.buildScheduledEventCreateOptions(fixture);
      expect(options.entityType).toBe(3);
      expect(options.entityMetadata.location).toBe('MetLife Stadium');
      expect(dayjs(options.scheduledEndTime).diff(dayjs(options.scheduledStartTime), 'hour')).toBe(2);
    });
  });

  describe('syncWorldCupScheduledEvents', () => {
    it('should create events for eligible fixtures and skip existing', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'evt-1', description: 'Match ID: 100' });
      const collection = new Collection();
      const guild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(collection),
          create
        }
      };

      const fixtures = [
        sampleFixture({ id: 100 }),
        sampleFixture({ id: 101, home: 'France', away: 'Germany', homeIso2: 'FR', awayIso2: 'DE' })
      ];

      const result = await events.syncWorldCupScheduledEvents(guild, fixtures);

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should skip fixtures that already have events', async () => {
      const collection = new Collection([
        ['existing', { description: 'Match ID: 100' }]
      ]);
      const create = jest.fn();
      const guild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(collection),
          create
        }
      };

      const result = await events.syncWorldCupScheduledEvents(guild, [sampleFixture()]);

      expect(create).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('should count ineligible fixtures as skipped', async () => {
      const guild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(new Collection()),
          create: jest.fn()
        }
      };

      const result = await events.syncWorldCupScheduledEvents(guild, [
        sampleFixture({ status: 'FT' })
      ]);

      expect(result.skipped).toBe(1);
      expect(guild.scheduledEvents.create).not.toHaveBeenCalled();
    });

    it('should record failures without stopping', async () => {
      const create = jest
        .fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({ id: 'evt-2', description: 'Match ID: 101' });
      const guild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(new Collection()),
          create
        }
      };

      const result = await events.syncWorldCupScheduledEvents(guild, [
        sampleFixture({ id: 100 }),
        sampleFixture({ id: 101 })
      ]);

      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('Fixture 100');
    });
    it('should stringify non-Error failures', async () => {
      const guild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(new Collection()),
          create: jest.fn().mockRejectedValue('boom')
        }
      };

      const result = await events.syncWorldCupScheduledEvents(guild, [sampleFixture()]);

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toBe('Fixture 100: boom');
    });

  });
  describe('truncation and edge cases', () => {
    it('should truncate long event names', () => {
      const longName = 'A'.repeat(60);
      const name = events.buildScheduledEventName(
        sampleFixture({ home: longName, away: longName, homeIso2: null, awayIso2: null })
      );
      expect(name.length).toBe(events.EVENT_NAME_MAX_LENGTH);
      expect(name.endsWith('…')).toBe(true);
    });

    it('should truncate long descriptions while preserving match id', () => {
      const description = events.buildScheduledEventDescription(
        sampleFixture({ venue: 'V'.repeat(1200) })
      );
      expect(description.length).toBeLessThanOrEqual(1000);
      expect(description).toContain('Match ID: 100');
    });

    it('should truncate long locations', () => {
      const location = events.buildScheduledEventLocation(
        sampleFixture({ venue: 'S'.repeat(150) })
      );
      expect(location.length).toBe(events.EVENT_LOCATION_MAX_LENGTH);
      expect(location.endsWith('…')).toBe(true);
    });

    it('should reject fixtures without kickoff', () => {
      expect(events.isFixtureEligibleForScheduledEvent(sampleFixture({ kickoff: null }))).toBe(false);
    });

    it('should reject cancelled fixtures', () => {
      expect(events.isFixtureEligibleForScheduledEvent(sampleFixture({ status: 'CANC' }))).toBe(false);
    });

    it('should build minimal descriptions with invalid kickoff', () => {
      const description = events.buildScheduledEventDescription(
        sampleFixture({ venue: null, stage: null, group: null, kickoff: 'not-a-date' })
      );
      expect(description).toContain('Kickoff: TBD');
      expect(description).toContain('Match ID: 100');
    });

    it('should return marker-only description when fixture has no metadata lines', () => {
      const description = events.buildScheduledEventDescription(
        sampleFixture({ venue: null, stage: null, group: null, kickoff: null })
      );
      expect(description).toBe('Match ID: 100');
    });

    it('should truncate marker-only descriptions that exceed the limit', () => {
      const description = events.buildScheduledEventDescription(
        sampleFixture({
          id: `9${'9'.repeat(2000)}`,
          venue: null,
          stage: null,
          group: null,
          kickoff: null
        })
      );
      expect(description.length).toBeLessThanOrEqual(1000);
      expect(description.endsWith('…')).toBe(true);
    });

    it('should ignore events with empty descriptions when checking duplicates', () => {
      const collection = new Collection([['1', { description: null }]]);
      expect(events.hasExistingEventForFixture(collection, 100)).toBe(false);
    });
  });

});
