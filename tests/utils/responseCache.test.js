const { getCached, setCached, cacheKey } = require('../../utils/responseCache');

describe('responseCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns undefined for missing key', () => {
    expect(getCached('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    setCached('key1', 'value1', 60000);
    expect(getCached('key1')).toBe('value1');
  });

  it('returns undefined and deletes expired entries', () => {
    setCached('expired', 'old', 1000);
    jest.advanceTimersByTime(2000);
    expect(getCached('expired')).toBeUndefined();
    expect(getCached('expired')).toBeUndefined();
  });

  it('uses default TTL when ttlMs is omitted', () => {
    setCached('default-ttl', 'value');
    expect(getCached('default-ttl')).toBe('value');
  });

  it('builds lowercase cache keys from parts', () => {
    expect(cacheKey('Foo', 'BAR')).toBe('foo:bar');
  });
});
