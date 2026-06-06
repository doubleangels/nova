const fs = require('fs');
const path = require('path');
const { dataDir } = require('./sqliteStore');

const HEARTBEAT_FILENAME = 'bot-heartbeat.json';
const DEFAULT_MAX_AGE_MS = 120_000;

/**
 * @returns {string}
 */
function getHeartbeatPath() {
  return path.join(process.env.DATA_DIR || dataDir, HEARTBEAT_FILENAME);
}

function writeBotHeartbeat() {
  const heartbeatPath = getHeartbeatPath();
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
  fs.writeFileSync(heartbeatPath, JSON.stringify({ at: Date.now() }));
}

/**
 * @returns {{ at: number }|null}
 */
function readBotHeartbeat() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getHeartbeatPath(), 'utf8'));
    if (!parsed || typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {number} [maxAgeMs]
 * @returns {boolean}
 */
function isBotHeartbeatFresh(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const heartbeat = readBotHeartbeat();
  if (!heartbeat) return false;
  return Date.now() - heartbeat.at <= maxAgeMs;
}

module.exports = {
  HEARTBEAT_FILENAME,
  DEFAULT_MAX_AGE_MS,
  getHeartbeatPath,
  writeBotHeartbeat,
  readBotHeartbeat,
  isBotHeartbeatFresh
};
