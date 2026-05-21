const REQUIRED_ENV_VARS = [
  'DISCORD_BOT_TOKEN',
  'BOT_STATUS',
  'MEMBER_FREN_ROLE_ID',
  'CUSTOM_ROLE_POSITIONING_ANCHOR_ID',
  'GOOGLE_API_KEY',
  'IMAGE_SEARCH_ENGINE_ID',
  'MAL_CLIENT_ID',
  'RETURNING_MEMBER_ROLE_ID',
  'PERMISSION_BENCHMARK_ROLE_ID',
  'NEW_MEMBER_ROLE_ID',
  'OMDB_API_KEY',
  'PIRATEWEATHER_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_PASSWORD',
  'REDDIT_USERNAME',
  'SEARCH_ENGINE_ID',
  'SERVER_INVITE_URL'
];

function setAllRequiredEnv() {
  REQUIRED_ENV_VARS.forEach((name) => {
    process.env[name] = process.env[name] || `test-${name.toLowerCase()}`;
  });
}

describe('config', () => {
  let exitSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setAllRequiredEnv();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('loads config with all required env vars', () => {
    const config = require('../config');
    expect(config.token).toBe(process.env.DISCORD_BOT_TOKEN);
    expect(config.guildName).toBe(process.env.GUILD_NAME || 'Da Frens');
    expect(config.botStatusType).toBe(process.env.BOT_STATUS_TYPE || 'watching');
    expect(config.settings.deployCommandsOnStart).toBe(true);
  });

  it('parses baseEmbedColor with hash prefix', () => {
    process.env.BASE_EMBED_COLOR = '#CD41FF';
    const config = require('../config');
    expect(config.baseEmbedColor).toBe(0xCD41FF);
  });

  it('parses baseEmbedColor with 0x prefix', () => {
    process.env.BASE_EMBED_COLOR = '0xABCDEF';
    const config = require('../config');
    expect(config.baseEmbedColor).toBe(0xABCDEF);
  });

  it('falls back to default color for invalid hex', () => {
    process.env.BASE_EMBED_COLOR = 'not-a-color';
    const config = require('../config');
    expect(config.baseEmbedColor).toBe(0x999999);
  });

  it('uses default log level when LOG_LEVEL is unset', () => {
    const saved = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    const config = require('../config');
    expect(config.logLevel).toBe('info');
    if (saved !== undefined) {
      process.env.LOG_LEVEL = saved;
    }
  });

  it('exits when required env vars are missing', () => {
    delete process.env.DISCORD_BOT_TOKEN;
    require('../config');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
