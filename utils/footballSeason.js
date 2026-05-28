/**
 * football-data.org `season` is the starting calendar year of the competition
 * (e.g. 2025/26 Premier League uses season=2025, not 2026).
 */

/**
 * European club seasons typically run Aug-Jul. Before August, the active
 * season started in the previous calendar year.
 *
 * @param {Date} [date]
 * @returns {number}
 */
function getDefaultFootballSeasonYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 8 ? year : year - 1;
}

/**
 * Season years to try when fetching competition matches (newest first).
 *
 * @param {number} [primarySeason]
 * @returns {number[]}
 */
function getFootballSeasonCandidates(primarySeason) {
  const primary =
    primarySeason != null ? primarySeason : getDefaultFootballSeasonYear();
  const candidates = [primary];
  if (primary > 2000) {
    candidates.push(primary - 1);
  }
  return [...new Set(candidates)];
}

module.exports = {
  getDefaultFootballSeasonYear,
  getFootballSeasonCandidates
};
