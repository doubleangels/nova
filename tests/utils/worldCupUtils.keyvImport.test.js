describe('worldCupUtils keyv import', () => {
  it('should use Keyv default export when present', () => {
    jest.resetModules();
    const MockKeyv = jest.fn(function MockKeyv() {
      this.on = jest.fn();
      this.get = jest.fn().mockResolvedValue(undefined);
      this.set = jest.fn().mockResolvedValue(true);
      this.delete = jest.fn().mockResolvedValue(true);
    });
    jest.doMock('keyv', () => ({ default: MockKeyv }));
    jest.doMock('../../logger', () => () => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupReminderHours: 24,
      worldCupChannelId: '999999999999999999'
    }));
    jest.doMock('../../utils/sqliteStore', () => ({
      getSharedKeyvStore: jest.fn().mockReturnValue({})
    }));
    require('../../utils/worldCupUtils');
    expect(MockKeyv).toHaveBeenCalled();
  });

  it('should use Keyv module export when default export is absent', () => {
    jest.resetModules();
    const MockKeyv = jest.fn(function MockKeyv() {
      this.on = jest.fn();
      this.get = jest.fn().mockResolvedValue(undefined);
      this.set = jest.fn().mockResolvedValue(true);
      this.delete = jest.fn().mockResolvedValue(true);
    });
    jest.doMock('keyv', () => MockKeyv);
    jest.doMock('../../logger', () => () => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupReminderHours: 24,
      worldCupChannelId: '999999999999999999'
    }));
    jest.doMock('../../utils/sqliteStore', () => ({
      getSharedKeyvStore: jest.fn().mockReturnValue({})
    }));
    require('../../utils/worldCupUtils');
    expect(MockKeyv).toHaveBeenCalled();
  });
});
