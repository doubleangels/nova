const path = require('path');

describe('index bootstrap', () => {
  let mockClient;
  let captureError;
  let closeSentry;
  let closeDatabaseConnections;
  let deployCommands;
  let mockLogger;
  let processOnHandlers;
  let originalExit;

  function loadIndex(configOverrides = {}) {
    jest.resetModules();
    processOnHandlers = {};
    mockLogger = require('./__mocks__/logger.mock')();
    captureError = jest.fn();
    closeSentry = jest.fn().mockResolvedValue();
    closeDatabaseConnections = jest.fn();
    deployCommands = jest.fn().mockResolvedValue();

    jest.spyOn(process, 'on').mockImplementation((event, handler) => {
      processOnHandlers[event] = handler;
      return process;
    });

    mockClient = {
      commands: new Map(),
      on: jest.fn(),
      once: jest.fn(),
      login: jest.fn().mockResolvedValue(),
      destroy: jest.fn(),
      cleanupInterval: null
    };

    jest.doMock('../logger', () => () => mockLogger);
    jest.doMock('../instrument', () => ({ captureError, closeSentry }));
    jest.doMock('../utils/database', () => ({ closeDatabaseConnections }));
    jest.doMock('../deploy-commands', () => deployCommands);

    jest.doMock('../config', () => ({
      token: 'test-token',
      baseEmbedColor: 0xABCDEF,
      settings: { deployCommandsOnStart: true },
      ...configOverrides
    }));

    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => mockClient),
      Collection: Map,
      GatewayIntentBits: {
        Guilds: 1,
        GuildMessages: 2,
        MessageContent: 4,
        GuildMembers: 8,
        GuildMessageReactions: 16
      },
      Options: { cacheWithLimits: jest.fn(() => ({})) }
    }));

    jest.doMock('fs', () => ({
      readdirSync: jest.fn((dir) => {
        if (String(dir).includes('commands')) return ['okCmd.js'];
        if (String(dir).includes('events')) return ['okEvent.js'];
        return [];
      })
    }));

    jest.doMock(path.join(__dirname, '../commands/okCmd.js'), () => ({
      data: { name: 'okCmd' }
    }), { virtual: true });

    jest.doMock(path.join(__dirname, '../events/okEvent.js'), () => ({
      name: 'okEvent',
      once: false,
      execute: jest.fn().mockResolvedValue()
    }), { virtual: true });

    jest.isolateModules(() => {
      require('../index');
    });
  }

  beforeEach(() => {
    originalExit = process.exit;
    process.exit = jest.fn();
  });

  afterEach(() => {
    process.exit = originalExit;
    jest.restoreAllMocks();
  });

  it('should load commands and events and logs in', () => {
    loadIndex();
    expect(mockClient.login).toHaveBeenCalledWith('test-token');
    expect(mockClient.commands.get('okCmd')).toBeDefined();
    expect(mockClient.on).toHaveBeenCalledWith('okEvent', expect.any(Function));
    expect(deployCommands).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Base embed color'));
  });

  it('should warn when base embed color is missing', () => {
    loadIndex({ baseEmbedColor: undefined });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'BASE_EMBED_COLOR not set. Embed colors will use Discord defaults.'
    );
  });

  it('should skip deploy when deployCommandsOnStart is false', () => {
    loadIndex({ settings: { deployCommandsOnStart: false } });
    expect(deployCommands).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Skipping slash command deploy on startup (deployCommandsOnStart is false).'
    );
  });

  it('should log when deploy commands fails on startup', async () => {
    jest.resetModules();
    mockLogger = require('./__mocks__/logger.mock')();
    deployCommands = jest.fn().mockRejectedValue(new Error('deploy failed'));
    jest.doMock('../logger', () => () => mockLogger);
    jest.doMock('../instrument', () => ({ captureError: jest.fn(), closeSentry: jest.fn().mockResolvedValue() }));
    jest.doMock('../utils/database', () => ({ closeDatabaseConnections: jest.fn() }));
    jest.doMock('../deploy-commands', () => deployCommands);
    jest.doMock('../config', () => ({
      token: 't',
      baseEmbedColor: 1,
      settings: { deployCommandsOnStart: true }
    }));
    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => ({ commands: new Map(), on: jest.fn(), once: jest.fn(), login: jest.fn() })),
      Collection: Map,
      GatewayIntentBits: {},
      Options: { cacheWithLimits: jest.fn(() => ({})) }
    }));
    jest.doMock('fs', () => ({ readdirSync: jest.fn(() => []) }));
    jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.isolateModules(() => {
      require('../index');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to deploy slash commands on startup:',
      expect.any(Error)
    );
  });

  it('should capture command load errors', () => {
    jest.resetModules();
    processOnHandlers = {};
    mockLogger = require('./__mocks__/logger.mock')();
    captureError = jest.fn();
    jest.doMock('../logger', () => () => mockLogger);
    jest.doMock('../instrument', () => ({ captureError, closeSentry: jest.fn().mockResolvedValue() }));
    jest.doMock('../utils/database', () => ({ closeDatabaseConnections: jest.fn() }));
    jest.doMock('../deploy-commands', () => jest.fn().mockResolvedValue());
    jest.doMock('../config', () => ({
      token: 't',
      baseEmbedColor: 1,
      settings: { deployCommandsOnStart: false }
    }));
    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => ({ commands: new Map(), on: jest.fn(), once: jest.fn(), login: jest.fn() })),
      Collection: Map,
      GatewayIntentBits: {},
      Options: { cacheWithLimits: jest.fn(() => ({})) }
    }));
    jest.doMock('fs', () => ({
      readdirSync: jest.fn((dir) =>
        String(dir).includes('commands') ? ['broken.js'] : []
      )
    }));
    jest.spyOn(process, 'on').mockImplementation((e, h) => {
      processOnHandlers[e] = h;
      return process;
    });
    jest.isolateModules(() => {
      require('../index');
    });
    expect(captureError).toHaveBeenCalled();
    expect(captureError.mock.calls[0][0].message).toBeDefined();
    expect(captureError.mock.calls[0][1]).toMatchObject({ source: 'commandLoad' });
  });

  it('should register once events with client.once', () => {
    jest.resetModules();
    mockLogger = require('./__mocks__/logger.mock')();
    const client = { commands: new Map(), on: jest.fn(), once: jest.fn(), login: jest.fn() };
    jest.doMock('../logger', () => () => mockLogger);
    jest.doMock('../instrument', () => ({ captureError: jest.fn(), closeSentry: jest.fn().mockResolvedValue() }));
    jest.doMock('../utils/database', () => ({ closeDatabaseConnections: jest.fn() }));
    jest.doMock('../deploy-commands', () => jest.fn().mockResolvedValue());
    jest.doMock('../config', () => ({ token: 't', baseEmbedColor: 1, settings: { deployCommandsOnStart: false } }));
    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => client),
      Collection: Map,
      GatewayIntentBits: {},
      Options: { cacheWithLimits: jest.fn(() => ({})) }
    }));
    jest.doMock('fs', () => ({
      readdirSync: jest.fn((dir) => (String(dir).includes('events') ? ['onceEvt.js'] : []))
    }));
    jest.doMock(path.join(__dirname, '../events/onceEvt.js'), () => ({
      name: 'ready',
      once: true,
      execute: jest.fn()
    }), { virtual: true });
    jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.isolateModules(() => {
      require('../index');
    });
    expect(client.once).toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('should capture event load errors', () => {
    jest.resetModules();
    mockLogger = require('./__mocks__/logger.mock')();
    captureError = jest.fn();
    jest.doMock('../logger', () => () => mockLogger);
    jest.doMock('../instrument', () => ({ captureError, closeSentry: jest.fn().mockResolvedValue() }));
    jest.doMock('../utils/database', () => ({ closeDatabaseConnections: jest.fn() }));
    jest.doMock('../deploy-commands', () => jest.fn().mockResolvedValue());
    jest.doMock('../config', () => ({ token: 't', baseEmbedColor: 1, settings: { deployCommandsOnStart: false } }));
    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => ({ commands: new Map(), on: jest.fn(), once: jest.fn(), login: jest.fn() })),
      Collection: Map,
      GatewayIntentBits: {},
      Options: { cacheWithLimits: jest.fn(() => ({})) }
    }));
    jest.doMock('fs', () => ({
      readdirSync: jest.fn((dir) => (String(dir).includes('events') ? ['brokenEvt.js'] : []))
    }));
    jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.isolateModules(() => {
      require('../index');
    });
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Cannot find module') }),
      expect.objectContaining({ source: 'eventLoad' })
    );
  });

  it('should wrap event execute errors with captureError', async () => {
    jest.resetModules();
    const execute = jest.fn().mockRejectedValue(new Error('event failed'));
    mockLogger = require('./__mocks__/logger.mock')();
    captureError = jest.fn();
    const client = { commands: new Map(), on: jest.fn(), once: jest.fn(), login: jest.fn() };
    jest.doMock('../logger', () => () => mockLogger);
    jest.doMock('../instrument', () => ({ captureError, closeSentry: jest.fn().mockResolvedValue() }));
    jest.doMock('../utils/database', () => ({ closeDatabaseConnections: jest.fn() }));
    jest.doMock('../deploy-commands', () => jest.fn().mockResolvedValue());
    jest.doMock('../config', () => ({ token: 't', baseEmbedColor: 1, settings: { deployCommandsOnStart: false } }));
    jest.doMock('discord.js', () => ({
      Client: jest.fn(() => client),
      Collection: Map,
      GatewayIntentBits: {},
      Options: { cacheWithLimits: jest.fn(() => ({})) }
    }));
    jest.doMock('fs', () => ({
      readdirSync: jest.fn((dir) => (String(dir).includes('events') ? ['evt.js'] : []))
    }));
    jest.doMock(path.join(__dirname, '../events/evt.js'), () => ({
      name: 'evt',
      execute
    }), { virtual: true });
    jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.isolateModules(() => {
      require('../index');
    });
    const handler = client.on.mock.calls[0][1];
    await handler();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: 'eventExecute' }));
  });

  it('should handle uncaughtException and unhandledRejection', async () => {
    loadIndex({ settings: { deployCommandsOnStart: false } });
    await processOnHandlers.uncaughtException(new Error('uncaught'));
    expect(captureError).toHaveBeenCalled();
    await processOnHandlers.unhandledRejection('string reason');
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'string reason' }),
      expect.objectContaining({ handler: 'unhandledRejection' })
    );
  });

  it('should wrap Error unhandledRejection without converting', async () => {
    loadIndex({ settings: { deployCommandsOnStart: false } });
    const err = new Error('rejection');
    await processOnHandlers.unhandledRejection(err);
    expect(captureError).toHaveBeenCalledWith(err, expect.objectContaining({ handler: 'unhandledRejection' }));
  });

  it('should gracefully shuts down on SIGINT', async () => {
    loadIndex({ settings: { deployCommandsOnStart: false } });
    mockClient.cleanupInterval = setInterval(() => {}, 1000);
    await processOnHandlers.SIGINT();
    expect(mockClient.destroy).toHaveBeenCalled();
    expect(closeDatabaseConnections).toHaveBeenCalled();
    expect(closeSentry).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should log errors during graceful shutdown', async () => {
    loadIndex({ settings: { deployCommandsOnStart: false } });
    mockClient.destroy.mockImplementation(() => {
      throw new Error('destroy fail');
    });
    closeDatabaseConnections.mockImplementation(() => {
      throw new Error('db fail');
    });
    closeSentry.mockRejectedValue(new Error('sentry fail'));
    await processOnHandlers.SIGTERM();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
