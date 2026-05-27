const { createMockInteraction } = require('../testUtils');
const { Collection } = require('discord.js');

describe('interactionCreate event', () => {
  let interactionCreateEvent;
  let mockLogger;
  let mockInstrument;
  let mockSpamModeUtils;
  let mockWorldCupInteractions;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockInstrument = {
      captureError: jest.fn()
    };
    jest.doMock('../../instrument', () => mockInstrument);

    mockSpamModeUtils = {
      handleSpamWarningButton: jest.fn()
    };
    jest.doMock('../../utils/spamModeUtils', () => mockSpamModeUtils);

    mockWorldCupInteractions = {
      handleWorldCupPredictButton: jest.fn().mockResolvedValue(),
      handleWorldCupPredictModal: jest.fn().mockResolvedValue(),
      BUTTON_PREFIX: 'worldcup:predict:',
      MODAL_PREFIX: 'worldcup:predict:'
    };
    jest.doMock('../../utils/worldCupInteractions', () => mockWorldCupInteractions);

    interactionCreateEvent = require('../../events/interactionCreate');
  });

  it('should handle spam warning buttons', async () => {
    const mockInteraction = createMockInteraction({
      customId: 'spamWarn:someId'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockSpamModeUtils.handleSpamWarningButton).toHaveBeenCalledWith(mockInteraction);
  });

  it('should handle World Cup predict buttons', async () => {
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.isModalSubmit = jest.fn().mockReturnValue(false);

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockWorldCupInteractions.handleWorldCupPredictButton).toHaveBeenCalledWith(mockInteraction);
  });

  it('should capture errors from World Cup button handler', async () => {
    mockWorldCupInteractions.handleWorldCupPredictButton.mockRejectedValue(new Error('btn fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.isModalSubmit = jest.fn().mockReturnValue(false);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not reply on World Cup button errors when already replied', async () => {
    mockWorldCupInteractions.handleWorldCupPredictButton.mockRejectedValue(new Error('btn fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.replied = true;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should swallow reply failures after World Cup button errors', async () => {
    mockWorldCupInteractions.handleWorldCupPredictButton.mockRejectedValue(new Error('btn fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should capture errors from World Cup modal handler', async () => {
    mockWorldCupInteractions.handleWorldCupPredictModal.mockRejectedValue(new Error('modal fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isModalSubmit = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not reply on World Cup modal errors when already deferred', async () => {
    mockWorldCupInteractions.handleWorldCupPredictModal.mockRejectedValue(new Error('modal fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isModalSubmit = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should swallow reply failures after World Cup modal errors', async () => {
    mockWorldCupInteractions.handleWorldCupPredictModal.mockRejectedValue(new Error('modal fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isModalSubmit = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should skip World Cup modal handling when isModalSubmit is missing', async () => {
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
    mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(false);
    mockInteraction.isMessageContextMenuCommand = jest.fn().mockReturnValue(false);
    mockInteraction.isUserContextMenuCommand = jest.fn().mockReturnValue(false);
    delete mockInteraction.isModalSubmit;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockWorldCupInteractions.handleWorldCupPredictModal).not.toHaveBeenCalled();
  });

  it('should handle World Cup predict modal submits', async () => {
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isModalSubmit = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockWorldCupInteractions.handleWorldCupPredictModal).toHaveBeenCalledWith(mockInteraction);
  });

  describe('autocomplete interactions', () => {
    it('should log warning if no matching command is found', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'unknownCommand'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(true);
      mockInteraction.client = {
        commands: new Collection()
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No command matching the requested command name was found for autocomplete.'),
        expect.any(Object)
      );
    });

    it('should call command autocomplete if present', async () => {
      const mockCommand = {
        autocomplete: jest.fn().mockResolvedValue()
      };
      const mockInteraction = createMockInteraction({
        commandName: 'myCommand'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(true);
      mockInteraction.client = {
        commands: new Collection([['myCommand', mockCommand]])
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockCommand.autocomplete).toHaveBeenCalledWith(mockInteraction);
    });

    it('should capture errors if command autocomplete throws', async () => {
      const mockCommand = {
        autocomplete: jest.fn().mockRejectedValue(new Error('Autocomplete error'))
      };
      const mockInteraction = createMockInteraction({
        commandName: 'myCommand'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(true);
      mockInteraction.client = {
        commands: new Collection([['myCommand', mockCommand]])
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should do nothing if command does not have autocomplete method', async () => {
      const mockCommand = {};
      const mockInteraction = createMockInteraction({
        commandName: 'myCommand'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(true);
      mockInteraction.client = {
        commands: new Collection([['myCommand', mockCommand]])
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockInstrument.captureError).not.toHaveBeenCalled();
    });
  });

  describe('command execution', () => {
    it('should ignore interactions that are not chat inputs or context menus', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
      mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(false);
      mockInteraction.isMessageContextMenuCommand = jest.fn().mockReturnValue(false);
      mockInteraction.isUserContextMenuCommand = jest.fn().mockReturnValue(false);

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should log warning if matching command is not found', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'unknownCommand'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
      mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
      mockInteraction.client = {
        commands: new Collection()
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No command matching the requested command name was found.'),
        expect.any(Object)
      );
    });

    it('should execute command successfully', async () => {
      const mockCommand = {
        execute: jest.fn().mockResolvedValue()
      };
      const mockInteraction = createMockInteraction({
        commandName: 'myCommand'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
      mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
      mockInteraction.client = {
        commands: new Collection([['myCommand', mockCommand]])
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockCommand.execute).toHaveBeenCalledWith(mockInteraction);
    });

    describe('error handling during execute', () => {
      it('should capture errors and skip if already replied', async () => {
        const mockCommand = {
          execute: jest.fn().mockRejectedValue(new Error('Exec fail'))
        };
        const mockInteraction = createMockInteraction({
          commandName: 'myCommand',
          replied: true
        });
        mockInteraction.isButton = jest.fn().mockReturnValue(false);
        mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
        mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
        mockInteraction.client = {
          commands: new Collection([['myCommand', mockCommand]])
        };

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInstrument.captureError).toHaveBeenCalled();
        expect(mockInteraction.reply).not.toHaveBeenCalled();
        expect(mockInteraction.followUp).not.toHaveBeenCalled();
      });

      it('should reply with generic error if not replied and not deferred', async () => {
        const mockCommand = {
          execute: jest.fn().mockRejectedValue(new Error('Exec fail'))
        };
        const mockInteraction = createMockInteraction({
          commandName: 'myCommand',
          replied: false,
          deferred: false
        });
        mockInteraction.isButton = jest.fn().mockReturnValue(false);
        mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
        mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
        mockInteraction.client = {
          commands: new Collection([['myCommand', mockCommand]])
        };

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: 'There was an error executing this command!',
          flags: 64
        });
      });

      it('should followUp with generic error if not replied but deferred', async () => {
        const mockCommand = {
          execute: jest.fn().mockRejectedValue(new Error('Exec fail'))
        };
        const mockInteraction = createMockInteraction({
          commandName: 'myCommand',
          replied: false,
          deferred: true
        });
        mockInteraction.isButton = jest.fn().mockReturnValue(false);
        mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
        mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
        mockInteraction.client = {
          commands: new Collection([['myCommand', mockCommand]])
        };

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockInteraction.followUp).toHaveBeenCalledWith({
          content: 'There was an error executing this command!',
          flags: 64
        });
      });

      it('should catch secondary errors if reply/followUp rejects', async () => {
        const mockCommand = {
          execute: jest.fn().mockRejectedValue(new Error('Exec fail'))
        };
        const mockInteraction = createMockInteraction({
          commandName: 'myCommand',
          replied: false,
          deferred: false
        });
        mockInteraction.reply = jest.fn().mockRejectedValue(new Error('Reply fail'));
        mockInteraction.isButton = jest.fn().mockReturnValue(false);
        mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
        mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
        mockInteraction.client = {
          commands: new Collection([['myCommand', mockCommand]])
        };

        await interactionCreateEvent.execute(mockInteraction);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error occurred while sending error response.',
          expect.any(Object)
        );
      });
    });
  });
});
