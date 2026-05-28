const config = require('../config');

/** ISO codes used to pick a stable random flag per mock team name. */
let mockIso2Pool = null;

/**
 * @returns {string[]}
 */
function getMockIso2Pool() {
  if (!mockIso2Pool) {
    mockIso2Pool = [...new Set(Object.values(NAME_TO_ISO2))].sort();
  }
  return mockIso2Pool;
}

/**
 * Picks a stable pseudo-random ISO2 flag for a mock team name.
 * @param {string} teamName
 * @returns {string}
 */
function mockIso2ForTeamName(teamName) {
  const pool = getMockIso2Pool();
  const normalized = String(teamName || '').trim().toLowerCase();
  if (!normalized || pool.length === 0) return pool[0] || 'US';

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

/**
 * FIFA / football-data.org three-letter codes → ISO 3166-1 alpha-2.
 * @type {Record<string, string>}
 */
const TLA_TO_ISO2 = {
  ALB: 'AL', ALG: 'DZ', ARG: 'AR', ARM: 'AM', AUS: 'AU', AUT: 'AT',
  BEL: 'BE', BIH: 'BA', BOL: 'BO', BRA: 'BR', BUL: 'BG', CMR: 'CM',
  CAN: 'CA', CHI: 'CL', CHN: 'CN', COL: 'CO', CRC: 'CR', CRO: 'HR',
  CUB: 'CU', CYP: 'CY', CZE: 'CZ', DEN: 'DK', ECU: 'EC', EGY: 'EG',
  ENG: 'GB', EQG: 'GQ', ESP: 'ES', EST: 'EE', FIN: 'FI', FRA: 'FR',
  GAB: 'GA', GEO: 'GE', GER: 'DE', GHA: 'GH', GRE: 'GR', HON: 'HN',
  HUN: 'HU', ISL: 'IS', IND: 'IN', IRN: 'IR', IRQ: 'IQ', IRL: 'IE',
  ISR: 'IL', ITA: 'IT', JAM: 'JM', JPN: 'JP', KOR: 'KR', KSA: 'SA',
  KUW: 'KW', LVA: 'LV', LIE: 'LI', LTU: 'LT', LUX: 'LU', MAR: 'MA',
  MEX: 'MX', MKD: 'MK', NED: 'NL', NGA: 'NG', NIR: 'GB', NOR: 'NO',
  NZL: 'NZ', PAN: 'PA', PAR: 'PY', PER: 'PE', POL: 'PL', POR: 'PT',
  QAT: 'QA', ROU: 'RO', RSA: 'ZA', RUS: 'RU', SCO: 'GB', SEN: 'SN',
  SRB: 'RS', SVK: 'SK', SVN: 'SI', SUI: 'CH', SWE: 'SE', TUN: 'TN',
  TUR: 'TR', UKR: 'UA', URU: 'UY', USA: 'US', VEN: 'VE', WAL: 'GB',
  ZAM: 'ZM', CIV: 'CI', CPV: 'CV', CUW: 'CW', JOR: 'JO', OMA: 'OM',
  UAE: 'AE', UZB: 'UZ', IDN: 'ID', PHI: 'PH', THA: 'TH', VIE: 'VN',
  SYR: 'SY', LBN: 'LB', PLE: 'PS', KOS: 'XK', MNE: 'ME',
  GUF: 'GF', MTQ: 'MQ', HAI: 'HT', SLV: 'SV', GTM: 'GT', NCA: 'NI',
  SUR: 'SR', GUY: 'GY', BOT: 'BW', NAM: 'NA', ANG: 'AO', MOZ: 'MZ',
  MLI: 'ML', BFA: 'BF', GIN: 'GN', SLE: 'SL', LBR: 'LR', TOG: 'TG',
  BEN: 'BJ', NIG: 'NE', MWI: 'MW', TAN: 'TZ', UGA: 'UG', KEN: 'KE',
  ETH: 'ET', SDN: 'SD', LBY: 'LY', MAD: 'MG', MRI: 'MU', SEY: 'SC',
  COM: 'KM', DJI: 'DJ', ERI: 'ER', SOM: 'SO', ZIM: 'ZW',
  COD: 'CD', CGO: 'CG', GNQ: 'GQ', CTA: 'CF', SSD: 'SS',
  MTN: 'MR', GAM: 'GM', GNB: 'GW', STP: 'ST', LES: 'LS',
  SWZ: 'SZ', REU: 'RE', FIJ: 'FJ', PNG: 'PG', SOL: 'SB',
  VAN: 'VU', SAM: 'WS', TGA: 'TO', TAH: 'PF', NCL: 'NC',
  ARS: 'GB', CHE: 'GB', LIV: 'GB', MCI: 'GB', MUN: 'GB', TOT: 'GB',
  NEW: 'GB', AVL: 'GB', WHU: 'GB', BHA: 'GB', CRY: 'GB', FUL: 'GB',
  BRE: 'GB', EVE: 'GB', NFO: 'GB', BOU: 'GB', WOL: 'GB', LEI: 'GB',
  IPS: 'GB', SOU: 'GB', BAY: 'DE', BVB: 'DE', RBL: 'DE', LEV: 'DE',
  SGE: 'DE', WOB: 'DE', FRE: 'DE', HOF: 'DE', M05: 'DE', UNI: 'DE',
  FCB: 'ES', RMA: 'ES', ATM: 'ES', BAR: 'ES', SEV: 'ES', VIL: 'ES',
  BET: 'ES', RSO: 'ES', ATH: 'ES', VAL: 'ES', GIR: 'ES', OSA: 'ES'
};

/**
 * Normalized team name (lowercase) → ISO 3166-1 alpha-2.
 * @type {Record<string, string>}
 */
const NAME_TO_ISO2 = {
  albania: 'AL', algeria: 'DZ', argentina: 'AR', armenia: 'AM', australia: 'AU',
  austria: 'AT', belgium: 'BE', bolivia: 'BO', 'bosnia and herzegovina': 'BA',
  'bosnia-herzegovina': 'BA', brazil: 'BR', bulgaria: 'BG', cameroon: 'CM',
  canada: 'CA', chile: 'CL', china: 'CN', colombia: 'CO', 'costa rica': 'CR',
  croatia: 'HR', cuba: 'CU', cyprus: 'CY', 'czech republic': 'CZ', czechia: 'CZ',
  denmark: 'DK', ecuador: 'EC', egypt: 'EG', england: 'GB', estonia: 'EE',
  finland: 'FI', france: 'FR', gabon: 'GA', georgia: 'GE', germany: 'DE',
  ghana: 'GH', greece: 'GR', honduras: 'HN', hungary: 'HU', iceland: 'IS',
  india: 'IN', iran: 'IR', iraq: 'IQ', ireland: 'IE', israel: 'IL',
  italy: 'IT', jamaica: 'JM', japan: 'JP', jordan: 'JO', 'south korea': 'KR',
  'korea republic': 'KR', 'republic of korea': 'KR', kuwait: 'KW', latvia: 'LV',
  lithuania: 'LT', luxembourg: 'LU', morocco: 'MA', mexico: 'MX',
  netherlands: 'NL', holland: 'NL', nigeria: 'NG', 'northern ireland': 'GB',
  norway: 'NO', 'new zealand': 'NZ', panama: 'PA', paraguay: 'PY', peru: 'PE',
  poland: 'PL', portugal: 'PT', qatar: 'QA', romania: 'RO', russia: 'RU',
  scotland: 'GB', senegal: 'SN', serbia: 'RS', slovakia: 'SK', slovenia: 'SI',
  spain: 'ES', sweden: 'SE', switzerland: 'CH', tunisia: 'TN', turkey: 'TR',
  turkiye: 'TR', ukraine: 'UA', uruguay: 'UY', usa: 'US',
  'united states': 'US', 'united states of america': 'US', venezuela: 'VE',
  wales: 'GB', zambia: 'ZM', 'south africa': 'ZA', 'ivory coast': 'CI',
  "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', indonesia: 'ID',
  philippines: 'PH', thailand: 'TH', vietnam: 'VN', 'saudi arabia': 'SA',
  uzbekistan: 'UZ', 'united arab emirates': 'AE', oman: 'OM', palestine: 'PS',
  montenegro: 'ME', kosovo: 'XK', haiti: 'HT',
  arsenal: 'GB', chelsea: 'GB', liverpool: 'GB', 'manchester city': 'GB',
  'manchester united': 'GB', tottenham: 'GB', 'tottenham hotspur': 'GB',
  'newcastle united': 'GB', 'aston villa': 'GB', 'west ham united': 'GB',
  'brighton and hove albion': 'GB', 'crystal palace': 'GB', fulham: 'GB',
  brentford: 'GB', everton: 'GB', 'nottingham forest': 'GB',
  'afc bournemouth': 'GB', bournemouth: 'GB', 'wolverhampton wanderers': 'GB',
  wolves: 'GB', 'leicester city': 'GB', 'ipswich town': 'GB',
  'southampton fc': 'GB', southampton: 'GB',
  'bayern munich': 'DE', 'bayern münchen': 'DE', 'borussia dortmund': 'DE',
  'rb leipzig': 'DE', 'bayer leverkusen': 'DE', 'eintracht frankfurt': 'DE',
  'vfl wolfsburg': 'DE', 'sc freiburg': 'DE', 'tsg hoffenheim': 'DE',
  'real madrid': 'ES', 'atletico madrid': 'ES', 'atlético madrid': 'ES',
  barcelona: 'ES', sevilla: 'ES', 'villarreal cf': 'ES', betis: 'ES',
  'real sociedad': 'ES', 'athletic bilbao': 'ES', 'athletic club': 'ES',
  valencia: 'ES', girona: 'ES', osasuna: 'ES',
  'el salvador': 'SV', guatemala: 'GT', nicaragua: 'NI', suriname: 'SR',
  guyana: 'GY', botswana: 'BW', namibia: 'NA', angola: 'AO', mozambique: 'MZ',
  mali: 'ML', 'burkina faso': 'BF', guinea: 'GN', 'sierra leone': 'SL',
  liberia: 'LR', togo: 'TG', benin: 'BJ', niger: 'NE', malawi: 'MW',
  tanzania: 'TZ', uganda: 'UG', kenya: 'KE', ethiopia: 'ET', sudan: 'SD',
  libya: 'LY', madagascar: 'MG', mauritius: 'MU', somalia: 'SO',
  zimbabwe: 'ZW', 'dr congo': 'CD', 'democratic republic of the congo': 'CD',
  congo: 'CG', 'equatorial guinea': 'GQ', 'central african republic': 'CF',
  'south sudan': 'SS', mauritania: 'MR', gambia: 'GM', 'guinea-bissau': 'GW',
  'cape verde': 'CV', 'cabo verde': 'CV', lesotho: 'LS', eswatini: 'SZ',
  swaziland: 'SZ', fiji: 'FJ', 'papua new guinea': 'PG', 'solomon islands': 'SB',
  vanuatu: 'VU', samoa: 'WS', tonga: 'TO', 'new caledonia': 'NC',
  bahrain: 'BH', syria: 'SY', lebanon: 'LB', curacao: 'CW', curaçao: 'CW'
};

/**
 * @param {string} iso2
 * @returns {string|null}
 */
function iso2ToFlagEmoji(iso2) {
  if (!iso2 || typeof iso2 !== 'string' || iso2.length !== 2) return null;
  const upper = iso2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  return String.fromCodePoint(
    ...[...upper].map(char => 0x1F1E6 + char.charCodeAt(0) - 65)
  );
}

/**
 * @param {string} [code]
 * @returns {string|null}
 */
function codeToIso2(code) {
  if (!code || typeof code !== 'string') return null;
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length === 2) return trimmed;
  if (trimmed.length === 3) return TLA_TO_ISO2[trimmed] || null;
  return null;
}

/**
 * @param {string} [tla]
 * @returns {string|null}
 */
function iso2FromTla(tla) {
  return codeToIso2(tla);
}

/**
 * @param {string} [name]
 * @returns {string|null}
 */
function iso2FromName(name) {
  if (!name || typeof name !== 'string') return null;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  if (NAME_TO_ISO2[normalized]) return NAME_TO_ISO2[normalized];

  const withoutSuffix = normalized
    .replace(/\s+national team$/i, '')
    .replace(/\s+fc$/i, '')
    .trim();
  if (NAME_TO_ISO2[withoutSuffix]) return NAME_TO_ISO2[withoutSuffix];

  return null;
}

/**
 * @param {unknown} team
 * @returns {string|null}
 */
function resolveIso2FromTeam(team) {
  if (!team || typeof team !== 'object') return null;

  const areaCode = team.area?.code;
  const fromArea = codeToIso2(areaCode);
  if (fromArea) return fromArea;

  const fromTla = iso2FromTla(team.tla);
  if (fromTla) return fromTla;

  return iso2FromName(team.name) || iso2FromName(team.shortName);
}

/**
 * @returns {boolean}
 */
function useMockTeamIcons() {
  return Boolean(config.predictionMockApi);
}

/**
 * @param {string} teamName
 * @param {{ mockApi?: boolean, iso2?: string|null, tla?: string|null }} [options]
 * @returns {string}
 */
function formatTeamWithFlag(teamName, options = {}) {
  const name = String(teamName || '').trim() || 'Team';
  const mockApi = options.mockApi ?? useMockTeamIcons();

  const iso2 = mockApi
    ? options.iso2 || mockIso2ForTeamName(name)
    : options.iso2 ||
      iso2FromTla(options.tla) ||
      iso2FromName(name);
  const flag = iso2 ? iso2ToFlagEmoji(iso2) : null;
  return flag ? `${flag} ${name}` : name;
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @param {'home'|'away'} side
 * @returns {string}
 */
function formatFixtureTeam(fixture, side) {
  if (side === 'home') {
    return formatTeamWithFlag(fixture.home, {
      iso2: fixture.homeIso2,
      tla: fixture.homeTla
    });
  }
  return formatTeamWithFlag(fixture.away, {
    iso2: fixture.awayIso2,
    tla: fixture.awayTla
  });
}

module.exports = {
  getMockIso2Pool,
  mockIso2ForTeamName,
  TLA_TO_ISO2,
  NAME_TO_ISO2,
  iso2ToFlagEmoji,
  iso2FromTla,
  iso2FromName,
  resolveIso2FromTeam,
  useMockTeamIcons,
  formatTeamWithFlag,
  formatFixtureTeam
};
