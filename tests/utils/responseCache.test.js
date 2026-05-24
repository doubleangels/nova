const { getCached, setCached, cacheKey } = require('../../utils/responseCache');

describe('responseCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return undefined for missing key', () => {
    expect(getCached('missing')).toBeUndefined();
  });

  it('should store and retrieves a value', () => {
    setCached('key1', 'value1', 60000);
    expect(getCached('key1')).toBe('value1');
  });

  it('should return undefined and deletes expired entries', () => {
    setCached('expired', 'old', 1000);
    jest.advanceTimersByTime(2000);
    expect(getCached('expired')).toBeUndefined();
    expect(getCached('expired')).toBeUndefined();
  });

  it('should use default TTL when ttlMs is omitted', () => {
    setCached('default-ttl', 'value');
    expect(getCached('default-ttl')).toBe('value');
  });

  it('should build lowercase cache keys from parts', () => {
    expect(cacheKey('Foo', 'BAR')).toBe('foo:bar');
  });
});
