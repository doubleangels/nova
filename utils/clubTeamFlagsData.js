/**
 * Club team → ISO 3166-1 alpha-2 for country flags (football-data.org TLAs and names).
 * TLAs are scoped per competition where they collide (e.g. FCB, LEV).
 */

/** @type {Record<string, Record<string, string>>} */
const LEAGUE_TLA_TO_ISO2 = {
  PL: {
    ARS: 'GB', AVL: 'GB', BOU: 'GB', BRE: 'GB', BHA: 'GB', BUR: 'GB', CHE: 'GB',
    CRY: 'GB', EVE: 'GB', FUL: 'GB', LEE: 'GB', LIV: 'GB', MCI: 'GB', MUN: 'GB',
    NEW: 'GB', NFO: 'GB', SUN: 'GB', TOT: 'GB', WHU: 'GB', WOL: 'GB',
    IPS: 'GB', LEI: 'GB', LUT: 'GB', SOU: 'GB', SHU: 'GB', NOR: 'GB', WBA: 'GB',
    HUD: 'GB', MID: 'GB', STK: 'GB', SWA: 'GB', CAR: 'GB', WAT: 'GB'
  },
  BL1: {
    FCB: 'DE', BAY: 'DE', BVB: 'DE', RBL: 'DE', VFB: 'DE', TSG: 'DE', B04: 'DE',
    LEV: 'DE', SCF: 'DE', SGE: 'DE', FCA: 'DE', M05: 'DE', FCU: 'DE', BMG: 'DE',
    HSV: 'DE', KOE: 'DE', SVW: 'DE', WOB: 'DE', FCH: 'DE', STP: 'DE', BOC: 'DE',
    DOR: 'DE', FRE: 'DE', HOF: 'DE', UNI: 'DE', WOB: 'DE'
  },
  PD: {
    ALA: 'ES', ALV: 'ES', ATH: 'ES', ATM: 'ES', BAR: 'ES', FCB: 'ES', BET: 'ES',
    CEL: 'ES', ELC: 'ES', ESP: 'ES', GET: 'ES', GIR: 'ES', LEV: 'ES', MAL: 'ES',
    OSA: 'ES', OVI: 'ES', RAY: 'ES', RMA: 'ES', RSO: 'ES', SEV: 'ES', VAL: 'ES',
    VIL: 'ES', LEG: 'ES', LPA: 'ES', CAD: 'ES', GRA: 'ES', VLL: 'ES'
  }
};

/** football-data.org area codes → ISO2 */
const AREA_CODE_TO_ISO2 = {
  ENG: 'GB', SCO: 'GB', WAL: 'GB', NIR: 'GB', GBN: 'GB',
  ESP: 'ES', DEU: 'DE', GER: 'DE', ITA: 'IT', FRA: 'FR', POR: 'PT', PRT: 'PT',
  NLD: 'NL', NED: 'NL', BEL: 'BE', AUT: 'AT', CHE: 'CH', SUI: 'CH',
  POL: 'PL', CZE: 'CZ', SVK: 'SK', HUN: 'HU', ROU: 'RO', BUL: 'BG', GRE: 'GR',
  GRC: 'GR', CRO: 'HR', HRV: 'HR', SRB: 'RS', UKR: 'UA', RUS: 'RU',
  TUR: 'TR', DEN: 'DK', SWE: 'SE', NOR: 'NO', FIN: 'FI', ISL: 'IS',
  IRL: 'IE'
};

/** Default country when competition is a single-nation league */
const COMPETITION_DEFAULT_ISO2 = {
  PL: 'GB',
  BL1: 'DE',
  PD: 'ES'
};

/**
 * Extra TLAs for Champions League and cross-league lookups (no competition scope).
 * @type {Record<string, string>}
 */
const CLUB_TLA_TO_ISO2 = {
  // England
  ARS: 'GB', AVL: 'GB', BOU: 'GB', BRE: 'GB', BHA: 'GB', BUR: 'GB', CHE: 'GB',
  CRY: 'GB', EVE: 'GB', FUL: 'GB', LEE: 'GB', LIV: 'GB', MCI: 'GB', MUN: 'GB',
  NEW: 'GB', NFO: 'GB', SUN: 'GB', TOT: 'GB', WHU: 'GB', WOL: 'GB',
  // Germany
  BVB: 'DE', RBL: 'DE', VFB: 'DE', TSG: 'DE', B04: 'DE', SCF: 'DE', SGE: 'DE',
  FCA: 'DE', M05: 'DE', FCU: 'DE', BMG: 'DE', HSV: 'DE', KOE: 'DE', SVW: 'DE',
  WOB: 'DE', FCH: 'DE', STP: 'DE', BAY: 'DE',
  // Spain (CEL/MAL/ESP/LEV/FCB are league-scoped in LEAGUE_TLA_TO_ISO2.PD)
  ALA: 'ES', ATH: 'ES', ATM: 'ES', BAR: 'ES', BET: 'ES', ELC: 'ES',
  GET: 'ES', GIR: 'ES', OSA: 'ES', OVI: 'ES', RAY: 'ES', RMA: 'ES',
  RSO: 'ES', SEV: 'ES', VAL: 'ES', VIL: 'ES',
  // Italy
  INT: 'IT', MIL: 'IT', ACM: 'IT', JUV: 'IT', NAP: 'IT', LAZ: 'IT', ROM: 'IT',
  ATA: 'IT', FIO: 'IT', TOR: 'IT',
  // France
  PSG: 'FR', PAR: 'FR', LYO: 'FR', MAR: 'FR', OLM: 'FR', LIL: 'FR', RCL: 'FR',
  // Netherlands
  AJA: 'NL', PSV: 'NL', FEY: 'NL',
  // Portugal
  BEN: 'PT', POR: 'PT', SCP: 'PT',
  // Scotland (CEL is also Celta Vigo — use names for Celtic)
  RAN: 'GB', GLA: 'GB',
  // Others (common UCL)
  OLY: 'GR', PAO: 'GR', GAL: 'TR', FEN: 'TR', BES: 'TR', SHD: 'UA', DYK: 'UA',
  RED: 'RS', SLB: 'PT', BRU: 'BE', AND: 'BE', SAL: 'AT', RBS: 'AT', YB: 'CH',
  BAS: 'CH', CFC: 'CH', KOB: 'DK', FCM: 'DK', BOD: 'NO'
};

/** @type {Record<string, string>} */
const CLUB_NAME_TO_ISO2 = {};

/**
 * @param {string} iso2
 * @param {string[]} names
 */
function registerClubNames(iso2, names) {
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (key) CLUB_NAME_TO_ISO2[key] = iso2;
  }
}

// Premier League (2025/26 and common API names)
registerClubNames('GB', [
  '', ' ', // Triggers empty key branch (line 91)
  'Arsenal FC', 'Arsenal',
  'Aston Villa FC', 'Aston Villa',
  'AFC Bournemouth', 'Bournemouth',
  'Brentford FC', 'Brentford',
  'Brighton & Hove Albion FC', 'Brighton & Hove Albion', 'Brighton',
  'Burnley FC', 'Burnley',
  'Chelsea FC', 'Chelsea',
  'Crystal Palace FC', 'Crystal Palace',
  'Everton FC', 'Everton',
  'Fulham FC', 'Fulham',
  'Leeds United FC', 'Leeds United', 'Leeds',
  'Liverpool FC', 'Liverpool',
  'Manchester City FC', 'Manchester City', 'Man City',
  'Manchester United FC', 'Manchester United', 'Man United',
  'Newcastle United FC', 'Newcastle United', 'Newcastle',
  'Nottingham Forest FC', 'Nottingham Forest',
  'Sunderland AFC', 'Sunderland',
  'Tottenham Hotspur FC', 'Tottenham Hotspur', 'Tottenham',
  'West Ham United FC', 'West Ham United', 'West Ham',
  'Wolverhampton Wanderers FC', 'Wolverhampton Wanderers', 'Wolves',
  'Ipswich Town FC', 'Ipswich Town',
  'Leicester City FC', 'Leicester City',
  'Southampton FC', 'Southampton',
  'Luton Town FC', 'Luton Town',
  'Sheffield United FC', 'Sheffield United',
  'Norwich City FC', 'Norwich City',
  'West Bromwich Albion FC', 'West Bromwich Albion',
  'Watford FC', 'Watford'
]);

// La Liga
registerClubNames('ES', [
  'Athletic Club', 'Athletic Bilbao', 'Athletic Club Bilbao',
  'Club Atlético de Madrid', 'Atlético de Madrid', 'Atletico Madrid', 'Atlético Madrid',
  'FC Barcelona', 'Barcelona',
  'RC Celta de Vigo', 'Celta de Vigo', 'Celta Vigo',
  'Deportivo Alavés', 'Deportivo Alaves', 'Alavés', 'Alaves',
  'Elche CF', 'Elche',
  'RCD Espanyol de Barcelona', 'RCD Espanyol', 'Espanyol',
  'Getafe CF', 'Getafe',
  'Girona FC', 'Girona',
  'Levante UD', 'Levante',
  'CA Osasuna', 'Osasuna',
  'Rayo Vallecano de Madrid', 'Rayo Vallecano',
  'Real Betis Balompié', 'Real Betis', 'Betis',
  'Real Madrid CF', 'Real Madrid',
  'Real Oviedo',
  'Real Sociedad de Fútbol', 'Real Sociedad',
  'RCD Mallorca', 'Mallorca',
  'Sevilla FC', 'Sevilla',
  'Valencia CF', 'Valencia',
  'Villarreal CF', 'Villarreal',
  'UD Las Palmas', 'Las Palmas',
  'Cádiz CF', 'Cadiz',
  'Granada CF', 'Granada',
  'Real Valladolid CF', 'Real Valladolid'
]);

// Bundesliga
registerClubNames('DE', [
  'FC Bayern München', 'FC Bayern Munich', 'Bayern Munich', 'Bayern München',
  'Borussia Dortmund',
  'RB Leipzig',
  'Bayer 04 Leverkusen', 'Bayer Leverkusen', 'Leverkusen',
  'Eintracht Frankfurt',
  'SC Freiburg', 'Freiburg',
  'TSG 1899 Hoffenheim', 'TSG Hoffenheim', 'Hoffenheim',
  'VfB Stuttgart', 'Stuttgart',
  'VfL Wolfsburg', 'Wolfsburg',
  '1. FC Union Berlin', 'Union Berlin',
  'SV Werder Bremen', 'Werder Bremen',
  '1. FSV Mainz 05', 'Mainz 05', 'Mainz',
  'FC Augsburg', 'Augsburg',
  'Borussia Mönchengladbach', 'Borussia Monchengladbach', "M'gladbach",
  'Hamburger SV', 'Hamburg',
  '1. FC Köln', '1. FC Cologne', 'Cologne', 'Köln',
  '1. FC Heidenheim 1846', '1. FC Heidenheim', 'Heidenheim',
  'FC St. Pauli', 'St. Pauli',
  'VfL Bochum 1848', 'VfL Bochum', 'Bochum'
]);

// Common Champions League / European clubs
registerClubNames('IT', [
  'FC Internazionale Milano', 'Inter Milan', 'Inter',
  'AC Milan', 'Milan',
  'Juventus FC', 'Juventus',
  'SSC Napoli', 'Napoli',
  'AS Roma', 'Roma',
  'SS Lazio', 'Lazio',
  'Atalanta BC', 'Atalanta',
  'ACF Fiorentina', 'Fiorentina',
  'Torino FC', 'Torino'
]);
registerClubNames('FR', [
  'Paris Saint-Germain FC', 'Paris Saint-Germain', 'PSG',
  'Olympique Lyonnais', 'Lyon',
  'Olympique de Marseille', 'Marseille',
  'AS Monaco FC', 'Monaco',
  'Lille OSC', 'Lille',
  'RC Lens', 'Lens'
]);
registerClubNames('NL', [
  'AFC Ajax', 'Ajax',
  'PSV', 'PSV Eindhoven',
  'Feyenoord Rotterdam', 'Feyenoord'
]);
registerClubNames('PT', [
  'Sport Lisboa e Benfica', 'Benfica',
  'FC Porto', 'Porto',
  'Sporting Clube de Portugal', 'Sporting CP', 'Sporting'
]);
registerClubNames('BE', [
  'Club Brugge KV', 'Club Brugge',
  'RSC Anderlecht', 'Anderlecht'
]);
registerClubNames('AT', [
  'FC Red Bull Salzburg', 'RB Salzburg', 'Salzburg',
  'SK Sturm Graz', 'Sturm Graz'
]);
registerClubNames('CH', [
  'BSC Young Boys', 'Young Boys',
  'FC Basel 1893', 'Basel'
]);
registerClubNames('GR', [
  'Olympiacos FC', 'Olympiacos',
  'Panathinaikos FC', 'Panathinaikos'
]);
registerClubNames('TR', [
  'Galatasaray SK', 'Galatasaray',
  'Fenerbahçe SK', 'Fenerbahce', 'Fenerbahçe'
]);
registerClubNames('UA', [
  'FC Shakhtar Donetsk', 'Shakhtar Donetsk',
  'FC Dynamo Kyiv', 'Dynamo Kyiv'
]);
registerClubNames('RS', ['FK Crvena zvezda', 'Red Star Belgrade', 'Crvena zvezda']);
registerClubNames('DK', ['FC København', 'FC Copenhagen', 'Copenhagen']);
registerClubNames('NO', ['FK Bodø/Glimt', 'Bodo Glimt']);
registerClubNames('SE', ['Malmö FF', 'Malmo FF', 'Malmö']);
registerClubNames('GB', [
  'Celtic FC', 'Celtic',
  'Rangers FC', 'Rangers',
  'Glasgow Rangers'
]);
registerClubNames('CZ', ['AC Sparta Praha', 'Sparta Prague', 'Sparta Praha']);
registerClubNames('PL', [
  'Legia Warszawa', 'Legia Warsaw',
  'Lech Poznań', 'Lech Poznan'
]);

module.exports = {
  LEAGUE_TLA_TO_ISO2,
  AREA_CODE_TO_ISO2,
  COMPETITION_DEFAULT_ISO2,
  CLUB_TLA_TO_ISO2,
  CLUB_NAME_TO_ISO2
};
