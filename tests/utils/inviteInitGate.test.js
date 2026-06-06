describe('inviteInitGate', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should resolve waitForInviteInit after markInviteInitComplete', async () => {
    const gate = require('../../utils/inviteInitGate');
    gate.resetInviteInitGate();
    const pending = gate.waitForInviteInit();
    gate.markInviteInitComplete();
    await expect(pending).resolves.toBeUndefined();
  });

  it('should return the init promise from waitForInviteInit', () => {
    const gate = require('../../utils/inviteInitGate');
    gate.resetInviteInitGate();
    expect(gate.waitForInviteInit()).toBeInstanceOf(Promise);
    gate.markInviteInitComplete();
  });

  it('should no-op when markInviteInitComplete is called twice', () => {
    const gate = require('../../utils/inviteInitGate');
    gate.resetInviteInitGate();
    gate.markInviteInitComplete();
    expect(() => gate.markInviteInitComplete()).not.toThrow();
  });
});
