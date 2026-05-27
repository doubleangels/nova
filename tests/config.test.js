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

  it('should load config with all required env vars', () => {
    const config = require('../config');
    expect(config.token).toBe(process.env.DISCORD_BOT_TOKEN);
    expect(config.guildName).toBe(process.env.GUILD_NAME || 'Da Frens');
    expect(config.botStatusType).toBe(process.env.BOT_STATUS_TYPE || 'watching');
    expect(config.settings.deployCommandsOnStart).toBe(true);
  });

  it('should parse baseEmbedColor with hash prefix', () => {
    process.env.BASE_EMBED_COLOR = '#CD41FF';
    const config = require('../config');
    expect(config.baseEmbedColor).toBe(0xCD41FF);
  });

  it('should parse baseEmbedColor with 0x prefix', () => {
    process.env.BASE_EMBED_COLOR = '0xABCDEF';
    const config = require('../config');
    expect(config.baseEmbedColor).toBe(0xABCDEF);
  });

  it('should fall back to default color for invalid hex', () => {
    process.env.BASE_EMBED_COLOR = 'not-a-color';
    const config = require('../config');
    expect(config.baseEmbedColor).toBe(0x999999);
  });

  it('should use default log level when LOG_LEVEL is unset', () => {
    const saved = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    const config = require('../config');
    expect(config.logLevel).toBe('info');
    if (saved !== undefined) {
      process.env.LOG_LEVEL = saved;
    }
  });

  it('should parse DISABLED_COMMANDS as comma-separated list', () => {
    process.env.DISABLED_COMMANDS = 'promote, invite';
    const config = require('../config');
    expect(config.settings.disabledCommands).toEqual(['promote', 'invite']);
  });

  it('should return [] when DISABLED_COMMANDS is an empty string', () => {
    process.env.DISABLED_COMMANDS = '   ';
    const config = require('../config');
    expect(config.settings.disabledCommands).toEqual([]);
  });

  it('should exit when required env vars are missing', () => {
    delete process.env.DISCORD_BOT_TOKEN;
    require('../config');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('should warn when DEEPL_API_KEY is not set', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.DEEPL_API_KEY;
    require('../config');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'DEEPL_API_KEY is not set. Flag-emoji translation reactions will be unavailable.'
    );
    consoleWarnSpy.mockRestore();
  });

  it('should warn when API_FOOTBALL_KEY is not set', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.API_FOOTBALL_KEY;
    require('../config');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'API_FOOTBALL_KEY is not set. World Cup predictions will be unavailable.'
    );
    consoleWarnSpy.mockRestore();
  });

  it('should warn when WORLD_CUP_CHANNEL_ID is missing but API key set', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.API_FOOTBALL_KEY = 'test-football-key';
    delete process.env.WORLD_CUP_CHANNEL_ID;
    require('../config');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'WORLD_CUP_CHANNEL_ID is not set. World Cup prompts and announcements will not be posted.'
    );
    consoleWarnSpy.mockRestore();
  });

  it('should not warn when DEEPL_API_KEY is set', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.DEEPL_API_KEY = 'test-deepl-key';
    require('../config');
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      'DEEPL_API_KEY is not set. Flag-emoji translation reactions will be unavailable.'
    );
    consoleWarnSpy.mockRestore();
  });

  it('should use custom World Cup reminder and poll intervals when valid', () => {
    process.env.WORLD_CUP_REMINDER_HOURS = '48';
    process.env.WORLD_CUP_POLL_INTERVAL_MS = '60000';
    const config = require('../config');
    expect(config.worldCupReminderHours).toBe(48);
    expect(config.worldCupPollIntervalMs).toBe(60000);
  });

  it('should fall back when World Cup reminder and poll env vars are invalid', () => {
    process.env.WORLD_CUP_REMINDER_HOURS = 'not-a-number';
    process.env.WORLD_CUP_POLL_INTERVAL_MS = '0';
    const config = require('../config');
    expect(config.worldCupReminderHours).toBe(24);
    expect(config.worldCupPollIntervalMs).toBe(15 * 60 * 1000);
  });
});
