const {
  markPendingAgeKick,
  clearPendingAgeKick,
  consumePendingAgeKick,
  resetPendingAgeKicksForTests
} = require('../../utils/ageKickTracking');

describe('ageKickTracking', () => {
  beforeEach(() => {
    resetPendingAgeKicksForTests();
  });

  it('should mark and consume a pending age kick once', () => {
    markPendingAgeKick('user-1');
    expect(consumePendingAgeKick('user-1')).toBe(true);
    expect(consumePendingAgeKick('user-1')).toBe(false);
  });

  it('should clear a pending age kick without consuming', () => {
    markPendingAgeKick('user-1');
    clearPendingAgeKick('user-1');
    expect(consumePendingAgeKick('user-1')).toBe(false);
  });

  it('should return false when no pending age kick exists', () => {
    expect(consumePendingAgeKick('missing-user')).toBe(false);
  });
});
