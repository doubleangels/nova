/** football-data.org competition codes supported by the /football game. */
const FOOTBALL_COMPETITIONS = {
  PL: { code: 'PL', name: 'Premier League' },
  BL1: { code: 'BL1', name: 'Bundesliga' },
  PD: { code: 'PD', name: 'La Liga' },
  CL: { code: 'CL', name: 'UEFA Champions League' }
};

const DEFAULT_COMPETITION_CODES = ['PL', 'BL1', 'PD', 'CL'];

/**
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parseCompetitionCodes(value) {
  const raw = value == null ? '' : String(value).trim();
  const tokens = raw
    ? raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_COMPETITION_CODES];

  const valid = tokens.filter(code => FOOTBALL_COMPETITIONS[code]);
  const invalid = tokens.filter(code => !FOOTBALL_COMPETITIONS[code]);
  if (invalid.length > 0) {
    console.warn(
      '[footballCompetitions] Ignoring invalid FOOTBALL_COMPETITION_CODES entries:',
      invalid.join(', '),
      '- using:',
      (valid.length > 0 ? valid : DEFAULT_COMPETITION_CODES).join(', ')
    );
  }
  return valid.length > 0 ? [...new Set(valid)] : [...DEFAULT_COMPETITION_CODES];
}

/**
 * @param {string} code
 * @returns {string}
 */
function getCompetitionName(code) {
  return FOOTBALL_COMPETITIONS[code]?.name || code;
}

module.exports = {
  FOOTBALL_COMPETITIONS,
  DEFAULT_COMPETITION_CODES,
  parseCompetitionCodes,
  getCompetitionName
};
