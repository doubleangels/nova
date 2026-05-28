const config = require('../config');

/**
 * Mock-only: after every demo fixture has at least one prediction, expose all as
 * full-time with scripted goals so scoring can run in one batch.
 * @param {import('./predictionGameStore').PredictionStore} store
 * @param {number[]} mockPlayableIds
 * @param {{ isMockPlayableMatchId: (id: number) => boolean, getMockScriptedFullTimeGoals: (id: number) => { home: number, away: number }|null }} mockData
 * @param {Array<{ id: number, status: string, goals: { home: number|null, away: number|null } }>} fixtures
 * @returns {Promise<typeof fixtures>}
 */
async function applyMockInstantFinishToFixtures(store, mockPlayableIds, mockData, fixtures) {
  if (!config.predictionMockApi) return fixtures;
  if (!(await store.areAllMockPlayableFixturesPredicted(mockPlayableIds))) {
    return fixtures;
  }

  return fixtures.map(fixture => {
    if (!mockData.isMockPlayableMatchId(fixture.id)) return fixture;

    const goals = mockData.getMockScriptedFullTimeGoals(fixture.id);
    if (!goals) return fixture;

    return {
      ...fixture,
      status: 'FT',
      goals: { home: goals.home, away: goals.away }
    };
  });
}

module.exports = {
  applyMockInstantFinishToFixtures
};
