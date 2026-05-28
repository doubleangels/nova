const {
  LEAGUE_TLA_TO_ISO2,
  AREA_CODE_TO_ISO2,
  COMPETITION_DEFAULT_ISO2,
  CLUB_TLA_TO_ISO2,
  CLUB_NAME_TO_ISO2
} = require('./clubTeamFlagsData');

/**
 * @param {string} code
 * @returns {string|null}
 */
function areaCodeToIso2(code) {
  if (!code || typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) return upper;
  return AREA_CODE_TO_ISO2[upper] || null;
}

/**
 * @param {string} name
 * @returns {string[]}
 */
function clubNameLookupKeys(name) {
  if (!name || typeof name !== 'string') return [];
  const keys = [];
  let n = name.trim().toLowerCase();
  if (!n) return keys;

  const push = value => {
    const key = value.trim();
    if (key) keys.push(key);
  };

  push(n);
  push(n.replace(/\s+de\s+fútbol$/i, ''));
  push(n.replace(/\s+de\s+barcelona$/i, ''));
  push(n.replace(/\s+de\s+madrid$/i, ''));
  push(n.replace(/\s+balompié$/i, '').replace(/\s+balompie$/i, ''));
  push(n.replace(/^rcd\s+/i, ''));
  push(n.replace(/^rc\s+/i, ''));
  push(n.replace(/^ca\s+/i, ''));
  push(n.replace(/^deportivo\s+/i, ''));
  push(n.replace(/^real\s+/i, 'real '));
  push(n.replace(/\s+fc$/i, ''));
  push(n.replace(/\s+cf$/i, ''));
  push(n.replace(/\s+afc$/i, ''));
  push(n.replace(/\s+ud$/i, ''));
  push(n.replace(/\s+sv$/i, ''));
  push(n.replace(/\s+\d{2,4}$/i, ''));

  return [...new Set(keys)];
}

/**
 * @param {string} [name]
 * @returns {string|null}
 */
function iso2FromClubName(name) {
  for (const key of clubNameLookupKeys(name)) {
    if (CLUB_NAME_TO_ISO2[key]) return CLUB_NAME_TO_ISO2[key];
  }
  return null;
}

/**
 * @param {string} [tla]
 * @param {string} [competitionCode]
 * @returns {string|null}
 */
function iso2FromClubTla(tla, competitionCode) {
  if (!tla || typeof tla !== 'string') return null;
  const upper = tla.trim().toUpperCase();
  if (!upper) return null;

  if (competitionCode && LEAGUE_TLA_TO_ISO2[competitionCode]?.[upper]) {
    return LEAGUE_TLA_TO_ISO2[competitionCode][upper];
  }

  return CLUB_TLA_TO_ISO2[upper] || null;
}

/**
 * Resolve ISO2 for a club team (country flag), using football-data.org team fields.
 *
 * @param {unknown} team
 * @param {string} [competitionCode] PL | BL1 | PD | CL — scopes ambiguous TLAs
 * @returns {string|null}
 */
function resolveClubIso2FromTeam(team, competitionCode) {
  if (!team || typeof team !== 'object') return null;

  const fromArea = areaCodeToIso2(team.area?.code);
  if (fromArea) return fromArea;

  const fromName =
    iso2FromClubName(team.name) || iso2FromClubName(team.shortName);
  if (fromName) return fromName;

  const fromTla = iso2FromClubTla(team.tla, competitionCode);
  if (fromTla) return fromTla;

  if (competitionCode && COMPETITION_DEFAULT_ISO2[competitionCode]) {
    return COMPETITION_DEFAULT_ISO2[competitionCode];
  }

  return null;
}

module.exports = {
  areaCodeToIso2,
  clubNameLookupKeys,
  iso2FromClubName,
  iso2FromClubTla,
  resolveClubIso2FromTeam
};
