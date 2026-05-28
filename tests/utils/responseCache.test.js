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

  it('should delete keys by prefix', () => {
    const { deleteByPrefix } = require('../../utils/responseCache');
    setCached('prediction-ai:result:worldcup:1:a', { score: 1 });
    setCached('prediction-ai:result:worldcup:2:b', { score: 2 });
    setCached('other:keep', { ok: true });

    deleteByPrefix('prediction-ai:result:worldcup:1:');

    expect(getCached('prediction-ai:result:worldcup:1:a')).toBeUndefined();
    expect(getCached('prediction-ai:result:worldcup:2:b')).toEqual({ score: 2 });
    expect(getCached('other:keep')).toEqual({ ok: true });
  });
});

describe('deleteCached', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('should delete a specific cached key (line 26)', () => {
    const { deleteCached, setCached, getCached } = require('../../utils/responseCache');
    setCached('del-key', 'value', 60000);
    expect(getCached('del-key')).toBe('value');
    deleteCached('del-key');
    expect(getCached('del-key')).toBeUndefined();
  });
});
