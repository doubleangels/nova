const fs = require('fs');
const os = require('os');
const path = require('path');

const jestDataDir = path.join(os.tmpdir(), 'nova-jest', String(process.pid));
fs.mkdirSync(jestDataDir, { recursive: true });
process.env.DATA_DIR = jestDataDir;

process.env.TZ = 'UTC';
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.BOT_STATUS = 'test status';
process.env.MEMBER_FREN_ROLE_ID = '111111111111111111';
process.env.CUSTOM_ROLE_POSITIONING_ANCHOR_ID = '222222222222222222';
process.env.GOOGLE_API_KEY = 'test-google-key';
process.env.IMAGE_SEARCH_ENGINE_ID = 'test-image-engine';
process.env.MAL_CLIENT_ID = 'test-mal-client';
process.env.RETURNING_MEMBER_ROLE_ID = '333333333333333333';
process.env.PERMISSION_BENCHMARK_ROLE_ID = '444444444444444444';
process.env.NEW_MEMBER_ROLE_ID = '555555555555555555';
process.env.OMDB_API_KEY = 'test-omdb-key';
process.env.PIRATEWEATHER_API_KEY = 'test-weather-key';
process.env.REDDIT_CLIENT_ID = 'test-reddit-id';
process.env.REDDIT_CLIENT_SECRET = 'test-reddit-secret';
process.env.REDDIT_PASSWORD = 'test-reddit-pass';
process.env.REDDIT_USERNAME = 'test-reddit-user';
process.env.SEARCH_ENGINE_ID = 'test-search-engine';
process.env.SERVER_INVITE_URL = 'https://discord.gg/test';

jest.setTimeout(10000);

// moduleLoad.test.js reloads config once per command module and can exceed the default limit
process.setMaxListeners(200);

afterEach(() => {
  try {
    const sqliteStorePath = require.resolve('../utils/sqliteStore');
    if (require.cache[sqliteStorePath]) {
      require('../utils/sqliteStore').closeDatabaseConnections();
    }
  } catch {
    // sqliteStore may be mocked or not loaded in this test file
  }
});