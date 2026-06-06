const {
  isKeyNeeded,
  isPredictionGameRestKeyValid,
  analyzeDatabaseKeys
} = require('../../utils/pruneDb');

describe('pruneDb', () => {
  it('should keep valid main config keys', () => {
    expect(isKeyNeeded('main:config:reminder_channel')).toBe(true);
    expect(isKeyNeeded('main:config:unknown_setting')).toBe(false);
  });

  it('should keep valid user and invite keys in main namespace', () => {
    expect(isKeyNeeded('main:mute_mode:123456789012345678')).toBe(true);
    expect(isKeyNeeded('main:spam_mode:123456789012345678')).toBe(true);
    expect(isKeyNeeded('main:former_member:123456789012345678')).toBe(true);
    expect(isKeyNeeded('main:message_count:123456789012345678')).toBe(true);
    expect(isKeyNeeded('main:invite_usage:123456789012345678')).toBe(true);
    expect(isKeyNeeded('main:invite_code_to_tag_map:123456789012345678')).toBe(true);
    expect(isKeyNeeded('main:mute_mode:not-an-id')).toBe(false);
  });

  it('should keep invite tag keys', () => {
    expect(isKeyNeeded('invites:tags:disboard')).toBe(true);
    expect(isKeyNeeded('invites:tags:')).toBe(false);
  });

  it('should keep prediction game keys for football and worldcup namespaces', () => {
    expect(isKeyNeeded('football:registered')).toBe(true);
    expect(isKeyNeeded('worldcup:all_participants')).toBe(true);
    expect(isKeyNeeded('football:prompting_paused')).toBe(true);
    expect(isKeyNeeded('worldcup:scoring_lock:42')).toBe(true);
    expect(isKeyNeeded('football:prediction:123456789012345678:99')).toBe(true);
    expect(isKeyNeeded('worldcup:points:123456789012345678')).toBe(true);
    expect(isKeyNeeded('football:predictions_by_fixture:1001')).toBe(true);
    expect(isKeyNeeded('worldcup:user_predictions:123456789012345678')).toBe(true);
    expect(isKeyNeeded('football:pending_prediction:123456789012345678:55')).toBe(true);
    expect(isKeyNeeded('football:scoring_lock:abc')).toBe(false);
  });

  it('should validate prediction rest keys directly', () => {
    expect(isPredictionGameRestKeyValid('registered')).toBe(true);
    expect(isPredictionGameRestKeyValid('obsolete_key')).toBe(false);
  });

  it('should keep reminder keys', () => {
    expect(isKeyNeeded('nova_reminders:reminders:bump:list')).toBe(true);
    expect(isKeyNeeded('nova_reminders:reminder:abc-123')).toBe(true);
    expect(isKeyNeeded('nova_reminders:reminder:')).toBe(false);
  });

  it('should reject unknown namespaces and malformed keys', () => {
    expect(isKeyNeeded('orphan')).toBe(false);
    expect(isKeyNeeded('unknown:foo')).toBe(false);
    expect(isKeyNeeded('main:invite_code_to_tag_map:not-an-id')).toBe(false);
    expect(isKeyNeeded('main:orphan_section:foo')).toBe(false);
    expect(isKeyNeeded('invites:legacy:tag')).toBe(false);
    expect(isKeyNeeded('football:prediction:123456789012345678')).toBe(false);
    expect(isKeyNeeded('worldcup:pending_prediction:123456789012345678')).toBe(false);
    expect(isKeyNeeded('nova_reminders:reminders:other:list')).toBe(false);
  });

  it('should analyze database keys into keep and delete lists', () => {
    const result = analyzeDatabaseKeys([
      'main:config:reminder_channel',
      'main:config:legacy_key',
      'football:all_participants'
    ]);

    expect(result.keepCount).toBe(2);
    expect(result.deleteKeys).toEqual(['main:config:legacy_key']);
  });
});
