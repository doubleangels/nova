process.env.TZ = 'UTC';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_BOT_TOKEN = 'test-token';

jest.setTimeout(10000);