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

function withStartupWarningsEnabled(fn) {
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    fn();
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
  }
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

  it('should load optional GUILD_ID when set', () => {
    process.env.GUILD_ID = '123456789012345678';
    const config = require('../config');
    expect(config.guildId).toBe('123456789012345678');
  });

  it('should leave guildId null when GUILD_ID is unset', () => {
    delete process.env.GUILD_ID;
    const config = require('../config');
    expect(config.guildId).toBeNull();
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
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.DEEPL_API_KEY;
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'DEEPL_API_KEY is not set. Flag-emoji translation reactions will be unavailable.'
      );
      consoleWarnSpy.mockRestore();
    });
  });

  it('should warn when DISCORD_CLIENT_ID is not set', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.DISCORD_CLIENT_ID;
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DISCORD_CLIENT_ID is not set')
      );
      consoleWarnSpy.mockRestore();
    });
  });

  it('should not warn about DISCORD_CLIENT_ID when it is set', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.DISCORD_CLIENT_ID = '123456789';
      require('../config');
      expect(consoleWarnSpy.mock.calls.some(([msg]) => String(msg).includes('DISCORD_CLIENT_ID is not set'))).toBe(false);
      delete process.env.DISCORD_CLIENT_ID;
      consoleWarnSpy.mockRestore();
    });
  });

  it('should warn and fall back when positive int env is invalid', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.FOOTBALL_PREDICTION_POLL_INTERVAL_MS = 'not-a-number';
    require('../config');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid positive integer for FOOTBALL_PREDICTION_POLL_INTERVAL_MS')
    );
    delete process.env.FOOTBALL_PREDICTION_POLL_INTERVAL_MS;
    consoleWarnSpy.mockRestore();
  });

  it('should warn when FOOTBALL_PREDICTION_MOCK_API is enabled', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.FOOTBALL_PREDICTION_MOCK_API = 'true';
      delete process.env.FOOTBALL_DATA_API_KEY;
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'FOOTBALL_PREDICTION_MOCK_API is enabled. /worldcup and /football use simulated fixtures instead of football-data.org.'
      );
      delete process.env.FOOTBALL_PREDICTION_MOCK_API;
      consoleWarnSpy.mockRestore();
    });
  });

  it('should enable mock mode from legacy WORLD_CUP_MOCK_API', () => {
    delete process.env.FOOTBALL_PREDICTION_MOCK_API;
    process.env.WORLD_CUP_MOCK_API = 'true';
    let config = require('../config');
    expect(config.predictionMockApi).toBe(true);

    jest.resetModules();
    process.env.WORLD_CUP_MOCK_API = 'yes';
    config = require('../config');
    expect(config.predictionMockApi).toBe(true);

    jest.resetModules();
    process.env.WORLD_CUP_MOCK_API = '1';
    config = require('../config');
    expect(config.predictionMockApi).toBe(true);

    delete process.env.WORLD_CUP_MOCK_API;
  });

  it('should warn when FOOTBALL_DATA_API_KEY is not set', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.WORLD_CUP_MOCK_API;
      delete process.env.FOOTBALL_DATA_API_KEY;
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'FOOTBALL_DATA_API_KEY is not set. /worldcup and /football predictions will be unavailable.'
      );
      consoleWarnSpy.mockRestore();
    });
  });

  it('should warn when prediction channel is missing but API key set', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.FOOTBALL_DATA_API_KEY = 'test-football-key';
      delete process.env.FOOTBALL_PREDICTION_CHANNEL_ID;
      delete process.env.WORLD_CUP_CHANNEL_ID;
      delete process.env.FOOTBALL_CHANNEL_ID;
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'FOOTBALL_CHANNEL_ID is not set. Football prediction prompts and announcements will not be posted.'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'WORLD_CUP_CHANNEL_ID is not set. World Cup prediction prompts and announcements will not be posted.'
      );
      consoleWarnSpy.mockRestore();
    });
  });

  it('should resolve shared prediction settings from legacy env vars', () => {
    delete process.env.FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID;
    delete process.env.FOOTBALL_PREDICTION_CHANNEL_ID;
    process.env.WORLD_CUP_PARTICIPANT_ROLE_ID = '111111111111111111';
    process.env.WORLD_CUP_CHANNEL_ID = '222222222222222222';
    process.env.WORLD_CUP_REMINDER_HOURS = '48';
    const config = require('../config');
    expect(config.predictionParticipantRoleId).toBe('111111111111111111');
    expect(config.predictionChannelId).toBe('222222222222222222');
    expect(config.predictionReminderHours).toBe(48);
  });

  it('should not warn when DEEPL_API_KEY is set', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.DEEPL_API_KEY = 'test-deepl-key';
      consoleWarnSpy.mockClear();
      require('../config');
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        'DEEPL_API_KEY is not set. Flag-emoji translation reactions will be unavailable.'
      );
      consoleWarnSpy.mockRestore();
    });
  });

  it('should use custom prediction reminder and poll intervals when valid', () => {
    process.env.FOOTBALL_PREDICTION_REMINDER_HOURS = '48';
    process.env.FOOTBALL_PREDICTION_POLL_INTERVAL_MS = '60000';
    const config = require('../config');
    expect(config.predictionReminderHours).toBe(48);
    expect(config.predictionPollIntervalMs).toBe(60000);
  });

  it('should fall back when prediction reminder and poll env vars are invalid', () => {
    process.env.FOOTBALL_PREDICTION_REMINDER_HOURS = 'not-a-number';
    process.env.FOOTBALL_PREDICTION_POLL_INTERVAL_MS = '0';
    const config = require('../config');
    expect(config.predictionReminderHours).toBe(24);
    expect(config.predictionPollIntervalMs).toBe(15 * 60 * 1000);
  });

  it('should use custom prediction pending TTL when valid', () => {
    process.env.FOOTBALL_PREDICTION_PENDING_TTL_MS = '300000';
    const config = require('../config');
    expect(config.predictionPendingTtlMs).toBe(300000);
  });

  it('should parse FOOTBALL_PREDICTION_AI_CACHE_TTL_MS if it is valid number', () => {
    process.env.FOOTBALL_PREDICTION_AI_CACHE_TTL_MS = '60000';
    const config = require('../config');
    expect(config.geminiPredictionCacheTtlMs).toBe(60000);
  });

  it('should fallback to 0 if FOOTBALL_PREDICTION_AI_CACHE_TTL_MS is invalid number', () => {
    process.env.FOOTBALL_PREDICTION_AI_CACHE_TTL_MS = 'invalid';
    const config = require('../config');
    expect(config.geminiPredictionCacheTtlMs).toBe(0);
  });

  it('should warn if FOOTBALL_PREDICTION_AI_ENABLED is set but GEMINI_API_KEY is missing', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.FOOTBALL_PREDICTION_AI_ENABLED = 'true';
      delete process.env.GEMINI_API_KEY;
      consoleWarnSpy.mockClear();
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'FOOTBALL_PREDICTION_AI_ENABLED is set but GEMINI_API_KEY is missing. AI match suggestions will be skipped.'
      );
      consoleWarnSpy.mockRestore();
    });
  });

  it('should warn if an AI command flag is set but GEMINI_API_KEY is missing', () => {
    withStartupWarningsEnabled(() => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.WEATHER_AI_ENABLED = 'true';
      delete process.env.GEMINI_API_KEY;
      consoleWarnSpy.mockClear();
      require('../config');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'WEATHER_AI_ENABLED is set but GEMINI_API_KEY is missing. That command\'s AI insight field will be skipped.'
      );
      consoleWarnSpy.mockRestore();
    });
  });
});
