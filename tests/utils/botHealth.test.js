const fs = require('fs');
const os = require('os');
const path = require('path');

describe('botHealth', () => {
  let tempDir;
  let botHealth;

  beforeEach(() => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-heartbeat-'));
    process.env.DATA_DIR = tempDir;
    botHealth = require('../../utils/botHealth');
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should write and read a heartbeat file', () => {
    botHealth.writeBotHeartbeat();
    expect(botHealth.readBotHeartbeat()?.at).toEqual(expect.any(Number));
  });

  it('should treat a recent heartbeat as fresh', () => {
    jest.useFakeTimers();
    botHealth.writeBotHeartbeat();
    expect(botHealth.isBotHeartbeatFresh()).toBe(true);
    jest.useRealTimers();
  });

  it('should treat stale or missing heartbeats as not fresh', () => {
    jest.useFakeTimers();
    botHealth.writeBotHeartbeat();
    jest.advanceTimersByTime(botHealth.DEFAULT_MAX_AGE_MS + 1);
    expect(botHealth.isBotHeartbeatFresh()).toBe(false);
    jest.useRealTimers();

    fs.rmSync(botHealth.getHeartbeatPath(), { force: true });
    expect(botHealth.readBotHeartbeat()).toBeNull();
    expect(botHealth.isBotHeartbeatFresh()).toBe(false);
  });

  it('should ignore invalid heartbeat payloads', () => {
    fs.writeFileSync(botHealth.getHeartbeatPath(), JSON.stringify({ at: 'not-a-number' }));
    expect(botHealth.readBotHeartbeat()).toBeNull();
  });

  it('should use the default data directory when DATA_DIR is unset', () => {
    delete process.env.DATA_DIR;
    jest.resetModules();
    const freshHealth = require('../../utils/botHealth');
    expect(freshHealth.getHeartbeatPath()).toContain('bot-heartbeat.json');
  });
});
