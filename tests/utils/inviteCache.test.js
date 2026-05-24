const {
  setInviteSnapshot,
  getInviteSnapshot,
  updateInviteSnapshotFromCollection,
  patchInviteUsage,
  removeInviteFromSnapshot
} = require('../../utils/inviteCache');

describe('inviteCache', () => {
  const guildId = 'guild-123';

  it('should set and gets invite snapshot', () => {
    setInviteSnapshot(guildId, { abc: 5 });
    expect(getInviteSnapshot(guildId)).toEqual({ abc: 5 });
  });

  it('should return null when no snapshot exists', () => {
    expect(getInviteSnapshot('unknown-guild')).toBeNull();
  });

  it('should update snapshot from invite collection', () => {
    const collection = {
      each: (fn) => {
        fn({ code: 'CODE1', uses: 3 });
        fn({ code: 'CODE2', uses: undefined });
      }
    };
    const usage = updateInviteSnapshotFromCollection(guildId, collection);
    expect(usage).toEqual({ CODE1: 3, CODE2: 0 });
    expect(getInviteSnapshot(guildId)).toEqual({ CODE1: 3, CODE2: 0 });
  });

  it('should patch invite usage for existing snapshot', () => {
    setInviteSnapshot(guildId, { abc: 1 });
    patchInviteUsage(guildId, 'abc', 10);
    expect(getInviteSnapshot(guildId)).toEqual({ abc: 10 });
  });

  it('should patch invite usage when no snapshot exists', () => {
    patchInviteUsage('guild-new', 'xyz', 2);
    expect(getInviteSnapshot('guild-new')).toEqual({ xyz: 2 });
  });

  it('should remove invite code case-insensitively', () => {
    setInviteSnapshot(guildId, { AbC: 5, other: 1 });
    removeInviteFromSnapshot(guildId, 'abc');
    expect(getInviteSnapshot(guildId)).toEqual({ other: 1 });
  });

  it('should do nothing when code is not found in snapshot', () => {
    setInviteSnapshot(guildId, { abc: 5 });
    removeInviteFromSnapshot(guildId, 'not-in-snapshot');
    expect(getInviteSnapshot(guildId)).toEqual({ abc: 5 });
  });

  it('should do nothing when removing from missing snapshot', () => {
    removeInviteFromSnapshot('no-snapshot', 'code');
    expect(getInviteSnapshot('no-snapshot')).toBeNull();
  });
});
