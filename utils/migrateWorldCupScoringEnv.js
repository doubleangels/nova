/**
 * Environment bootstrap for the World Cup scoring migration script.
 * Always uses the real football-data.org API (never mock fixtures).
 */

/**
 * Loads .env for local runs, then disables mock API before config is required.
 */
function bootstrapMigrationEnv() {
  require('dotenv').config();
  process.env.FOOTBALL_PREDICTION_MOCK_API = 'false';
}

/**
 * @param {{ footballDataApiKey?: string }} config
 * @returns {{ ready: true } | { ready: false, message: string }}
 */
function getFootballApiReadiness(config) {
  const apiKey = config.footballDataApiKey;
  if (!apiKey || !String(apiKey).trim()) {
    return {
      ready: false,
      message:
        'FOOTBALL_DATA_API_KEY is not set. The migration fetches live scores from football-data.org.\n' +
        'Run with Doppler so the key is injected:\n' +
        '  doppler run -- node scripts/migrate-worldcup-scoring.js\n' +
        '  docker compose run --rm --no-deps nova /app/scripts/migrate-worldcup-scoring.sh'
    };
  }

  return { ready: true };
}

module.exports = {
  bootstrapMigrationEnv,
  getFootballApiReadiness
};
