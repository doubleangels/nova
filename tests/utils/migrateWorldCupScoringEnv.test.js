describe('migrateWorldCupScoringEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('should disable mock API during bootstrap', () => {
    process.env.FOOTBALL_PREDICTION_MOCK_API = 'true';
    const { bootstrapMigrationEnv } = require('../../utils/migrateWorldCupScoringEnv');
    bootstrapMigrationEnv();
    expect(process.env.FOOTBALL_PREDICTION_MOCK_API).toBe('false');
  });

  it('should report ready when football API key is set', () => {
    const { getFootballApiReadiness } = require('../../utils/migrateWorldCupScoringEnv');
    expect(getFootballApiReadiness({ footballDataApiKey: 'test-key' })).toEqual({ ready: true });
  });

  it('should report not ready when football API key is missing', () => {
    const { getFootballApiReadiness } = require('../../utils/migrateWorldCupScoringEnv');
    const result = getFootballApiReadiness({ footballDataApiKey: '' });
    expect(result.ready).toBe(false);
    expect(result.message).toContain('FOOTBALL_DATA_API_KEY is not set');
    expect(result.message).toContain('doppler run --');
  });
});
