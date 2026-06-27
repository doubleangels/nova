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
      handleWorldCupPickSelect: jest.fn().mockResolvedValue(),
      isWorldCupPickSelect: jest.fn((id) => id?.startsWith('worldcup:pick:')),
      BUTTON_PREFIX: 'worldcup:predict:'
    };
    jest.doMock('../../utils/worldCupInteractions', () => mockWorldCupInteractions);

    jest.doMock('../../utils/footballInteractions', () => ({
      handleFootballPredictButton: jest.fn().mockResolvedValue(),
      handleFootballPickSelect: jest.fn().mockResolvedValue(),
      isFootballPickSelect: jest.fn(id => id?.startsWith('football:pick:')),
      BUTTON_PREFIX: 'football:predict:'
    }));

    jest.doMock('../../commands/football', () => ({
      handlePromptSelect: jest.fn().mockResolvedValue(),
      handleRepostScoreSelect: jest.fn().mockResolvedValue()
    }));
    jest.doMock('../../commands/worldCup', () => ({
      handlePromptSelect: jest.fn().mockResolvedValue(),
      handleRepostScoreSelect: jest.fn().mockResolvedValue()
    }));

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

  it('should handle World Cup prediction select menus', async () => {
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:pick:home:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockWorldCupInteractions.handleWorldCupPickSelect).toHaveBeenCalledWith(mockInteraction);
  });

  it('should capture errors from World Cup pick select handler', async () => {
    mockWorldCupInteractions.handleWorldCupPickSelect.mockRejectedValue(new Error('select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not reply on World Cup select errors when already replied', async () => {
    mockWorldCupInteractions.handleWorldCupPickSelect.mockRejectedValue(new Error('select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = true;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.editReply).not.toHaveBeenCalled();
  });

  it('should editReply on World Cup select errors when deferred', async () => {
    mockWorldCupInteractions.handleWorldCupPickSelect.mockRejectedValue(new Error('select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: '⚠️ Something went wrong saving your prediction.',
      components: []
    });
  });

  it('should swallow reply failures after World Cup select errors', async () => {
    mockWorldCupInteractions.handleWorldCupPickSelect.mockRejectedValue(new Error('select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should swallow editReply failures after World Cup select errors when deferred', async () => {
    mockWorldCupInteractions.handleWorldCupPickSelect.mockRejectedValue(new Error('select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;
    mockInteraction.editReply = jest.fn().mockRejectedValue(new Error('edit fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should handle Football predict buttons', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    const mockInteraction = createMockInteraction({
      customId: 'football:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(footballInteractions.handleFootballPredictButton).toHaveBeenCalledWith(mockInteraction);
  });

  it('should capture errors from Football predict button handler', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPredictButton.mockRejectedValue(new Error('football btn fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not reply on Football button errors when already replied', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPredictButton.mockRejectedValue(new Error('football btn fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.replied = true;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should swallow reply failures after Football button errors', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPredictButton.mockRejectedValue(new Error('football btn fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:predict:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should handle Football prediction select menus', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    const mockInteraction = createMockInteraction({
      customId: 'football:pick:home:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(footballInteractions.handleFootballPickSelect).toHaveBeenCalledWith(mockInteraction);
  });

  it('should capture errors from Football pick select handler', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPickSelect.mockRejectedValue(new Error('football select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not reply on Football select errors when already replied', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPickSelect.mockRejectedValue(new Error('football select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = true;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.editReply).not.toHaveBeenCalled();
  });

  it('should editReply on Football select errors when deferred', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPickSelect.mockRejectedValue(new Error('football select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: '⚠️ Something went wrong saving your prediction.',
      components: []
    });
  });

  it('should swallow reply failures after Football select errors', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPickSelect.mockRejectedValue(new Error('football select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should swallow editReply failures after Football select errors when deferred', async () => {
    const footballInteractions = require('../../utils/footballInteractions');
    footballInteractions.handleFootballPickSelect.mockRejectedValue(new Error('football select fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:pick:winner:99'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;
    mockInteraction.editReply = jest.fn().mockRejectedValue(new Error('edit fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should handle World Cup prompt select menus', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(worldCupCommand.handlePromptSelect).toHaveBeenCalledWith(mockInteraction);
  });

  it('should handle Football prompt select menus', async () => {
    const footballCommand = require('../../commands/football');
    const mockInteraction = createMockInteraction({
      customId: 'football:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(footballCommand.handlePromptSelect).toHaveBeenCalledWith(mockInteraction);
  });

  it('should handle World Cup repost score select menus', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(worldCupCommand.handleRepostScoreSelect).toHaveBeenCalledWith(mockInteraction);
  });

  it('should handle Football repost score select menus', async () => {
    const footballCommand = require('../../commands/football');
    const mockInteraction = createMockInteraction({
      customId: 'football:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);

    await interactionCreateEvent.execute(mockInteraction);

    expect(footballCommand.handleRepostScoreSelect).toHaveBeenCalledWith(mockInteraction);
  });

  it('should capture errors from World Cup prompt select handler', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    worldCupCommand.handlePromptSelect.mockRejectedValue(new Error('prompt fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should capture errors from Football prompt select handler', async () => {
    const footballCommand = require('../../commands/football');
    footballCommand.handlePromptSelect.mockRejectedValue(new Error('prompt fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should capture errors from World Cup repost score select handler', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    worldCupCommand.handleRepostScoreSelect.mockRejectedValue(new Error('repost fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should capture errors from Football repost score select handler', async () => {
    const footballCommand = require('../../commands/football');
    footballCommand.handleRepostScoreSelect.mockRejectedValue(new Error('repost fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not reply again when World Cup repost score select fails after defer', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    worldCupCommand.handleRepostScoreSelect.mockRejectedValue(new Error('repost fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should not reply again when Football repost score select fails after reply', async () => {
    const footballCommand = require('../../commands/football');
    footballCommand.handleRepostScoreSelect.mockRejectedValue(new Error('repost fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = true;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should swallow reply failures after World Cup repost score select errors', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    worldCupCommand.handleRepostScoreSelect.mockRejectedValue(new Error('repost fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should swallow reply failures after Football repost score select errors', async () => {
    const footballCommand = require('../../commands/football');
    footballCommand.handleRepostScoreSelect.mockRejectedValue(new Error('repost fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:repostscore:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should not reply again when World Cup prompt select fails after defer', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    worldCupCommand.handlePromptSelect.mockRejectedValue(new Error('prompt fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = true;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should not reply again when Football prompt select fails after reply', async () => {
    const footballCommand = require('../../commands/football');
    footballCommand.handlePromptSelect.mockRejectedValue(new Error('prompt fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = true;
    mockInteraction.deferred = false;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should swallow reply failures after World Cup prompt select errors', async () => {
    const worldCupCommand = require('../../commands/worldCup');
    worldCupCommand.handlePromptSelect.mockRejectedValue(new Error('prompt fail'));
    const mockInteraction = createMockInteraction({
      customId: 'worldcup:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
  });

  it('should swallow reply failures after Football prompt select errors', async () => {
    const footballCommand = require('../../commands/football');
    footballCommand.handlePromptSelect.mockRejectedValue(new Error('prompt fail'));
    const mockInteraction = createMockInteraction({
      customId: 'football:prompt:select'
    });
    mockInteraction.isButton = jest.fn().mockReturnValue(false);
    mockInteraction.isStringSelectMenu = jest.fn().mockReturnValue(true);
    mockInteraction.replied = false;
    mockInteraction.deferred = false;
    mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));

    await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
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

    it('should reply ephemerally when a disabled command is invoked', async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../instrument', () => mockInstrument);
      jest.doMock('../../utils/spamModeUtils', () => mockSpamModeUtils);
      jest.doMock('../../utils/worldCupInteractions', () => mockWorldCupInteractions);
      jest.doMock('../../utils/footballInteractions', () => ({
        handleFootballPredictButton: jest.fn().mockResolvedValue(),
        handleFootballPickSelect: jest.fn().mockResolvedValue(),
        isFootballPickSelect: jest.fn(),
        BUTTON_PREFIX: 'football:predict:'
      }));
      jest.doMock('../../config', () => ({
        settings: { disabledCommands: ['disabledCmd'] }
      }));
      interactionCreateEvent = require('../../events/interactionCreate');

      const mockInteraction = createMockInteraction({
        commandName: 'disabledCmd'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
      mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
      mockInteraction.reply = jest.fn().mockResolvedValue();
      mockInteraction.client = {
        commands: new Collection()
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '⚠️ This command is currently disabled.',
        flags: expect.any(Number)
      });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should swallow reply errors for disabled commands', async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../instrument', () => mockInstrument);
      jest.doMock('../../utils/spamModeUtils', () => mockSpamModeUtils);
      jest.doMock('../../utils/worldCupInteractions', () => mockWorldCupInteractions);
      jest.doMock('../../utils/footballInteractions', () => ({
        handleFootballPredictButton: jest.fn().mockResolvedValue(),
        handleFootballPickSelect: jest.fn().mockResolvedValue(),
        isFootballPickSelect: jest.fn(),
        BUTTON_PREFIX: 'football:predict:'
      }));
      jest.doMock('../../config', () => ({
        settings: { disabledCommands: ['disabledCmd'] }
      }));
      interactionCreateEvent = require('../../events/interactionCreate');

      const mockInteraction = createMockInteraction({
        commandName: 'disabledCmd'
      });
      mockInteraction.isButton = jest.fn().mockReturnValue(false);
      mockInteraction.isAutocomplete = jest.fn().mockReturnValue(false);
      mockInteraction.isChatInputCommand = jest.fn().mockReturnValue(true);
      mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));
      mockInteraction.client = {
        commands: new Collection()
      };

      await expect(interactionCreateEvent.execute(mockInteraction)).resolves.toBeUndefined();
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
