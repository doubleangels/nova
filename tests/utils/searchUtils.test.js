const { ButtonStyle } = require('discord.js');

describe('searchUtils', () => {
  let searchUtils;
  let mockLogger;
  let mockInteraction;
  let mockMessage;
  let collectorEmitter;

  beforeEach(() => {
    jest.resetModules();
    
    // Mock config before requiring anything else
    jest.doMock('../../config', () => ({}));
    
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    collectorEmitter = {
      on: jest.fn(),
      listeners: {}
    };
    collectorEmitter.on.mockImplementation((event, callback) => {
      collectorEmitter.listeners[event] = callback;
    });

    mockMessage = {
      createMessageComponentCollector: jest.fn().mockReturnValue(collectorEmitter)
    };

    mockInteraction = {
      user: { id: 'user-123' },
      editReply: jest.fn().mockResolvedValue(mockMessage)
    };

    searchUtils = require('../../utils/searchUtils');
  });

  describe('normalizeSearchParams', () => {
    it('should return error for empty query', () => {
      const result = searchUtils.normalizeSearchParams('', 5, 5, 1, 10);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Empty query');
    });

    it('should clamp results count', () => {
      const result = searchUtils.normalizeSearchParams('test', 20, 5, 1, 10);
      expect(result.valid).toBe(true);
      expect(result.count).toBe(10);
      expect(result.query).toBe('test');
    });

    it('should use default count if not provided', () => {
      const result = searchUtils.normalizeSearchParams('test', undefined, 5, 1, 10);
      expect(result.valid).toBe(true);
      expect(result.count).toBe(5);
    });
  });

  describe('formatApiError', () => {
    it('should format error with status and message', () => {
      const err = { response: { status: 403, data: { error: { message: 'Forbidden' } } } };
      expect(searchUtils.formatApiError(err)).toBe('⚠️ Google API error (403): Forbidden');
    });

    it('should fallback to error message', () => {
      const err = { message: 'Network Error' };
      expect(searchUtils.formatApiError(err)).toBe('⚠️ Google API error (unknown): Network Error');
    });
  });

  describe('createPaginatedResults', () => {
    let items;
    let generateEmbed;

    beforeEach(() => {
      items = ['item1', 'item2', 'item3'];
      generateEmbed = jest.fn((index) => ({ title: `Page ${index}` }));
    });

    it('should create initial message with buttons', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [{ title: 'Page 0' }],
        components: expect.any(Array)
      }));
      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalled();
    });

    it('should handle prev and next buttons with underscore prefixes', async () => {
      await searchUtils.createPaginatedResults(
        mockInteraction,
        items,
        generateEmbed,
        'football_predictions',
        60000,
        mockLogger
      );

      const mockButtonInteraction = {
        customId: 'football_predictions_next_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockResolvedValue(true),
        editReply: jest.fn().mockResolvedValue(true)
      };

      await collectorEmitter.listeners['collect'](mockButtonInteraction);

      expect(mockButtonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [{ title: 'Page 1' }]
      }));

      mockButtonInteraction.customId = 'football_predictions_prev_user-123_123';
      await collectorEmitter.listeners['collect'](mockButtonInteraction);

      expect(mockButtonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [{ title: 'Page 0' }]
      }));
    });

    it('should handle prev and next buttons', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      const mockButtonInteraction = {
        customId: 'test_next_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockResolvedValue(true),
        editReply: jest.fn().mockResolvedValue(true)
      };

      // Trigger 'collect' for 'next'
      await collectorEmitter.listeners['collect'](mockButtonInteraction);
      
      expect(mockButtonInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockButtonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [{ title: 'Page 1' }]
      }));

      // Trigger 'collect' for 'prev'
      mockButtonInteraction.customId = 'test_prev_user-123_123';
      await collectorEmitter.listeners['collect'](mockButtonInteraction);

      expect(mockButtonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [{ title: 'Page 0' }]
      }));
    });

    it('should handle collector end', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);

      // Trigger 'end'
      await collectorEmitter.listeners['end']({ size: 1 });

      expect(mockInteraction.editReply).toHaveBeenCalledTimes(2); // Initial + End
      const callArgs = mockInteraction.editReply.mock.calls[1][0];
      expect(callArgs.components[0].components[0].data.disabled).toBe(true);
    });

    it('should handle custom button labels and emojis in options', async () => {
      const options = {
        prevEmoji: '👈',
        nextEmoji: '👉',
        prevLabel: 'Custom Prev',
        nextLabel: 'Custom Next',
        buttonStyle: ButtonStyle.Danger
      };
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger, options);
      
      expect(mockInteraction.editReply).toHaveBeenCalled();
      const callArgs = mockInteraction.editReply.mock.calls[0][0];
      expect(callArgs.components[0].components[0].data.emoji.name).toBe('👈');
      expect(callArgs.components[0].components[0].data.label).toBe('Custom Prev');
      expect(callArgs.components[0].components[0].data.style).toBe(ButtonStyle.Danger);

      // Trigger 'end' to cover disable path with emoji/label options too
      await collectorEmitter.listeners['end']({ size: 0 });
      expect(mockInteraction.editReply).toHaveBeenCalledTimes(2);
      const endCallArgs = mockInteraction.editReply.mock.calls[1][0];
      expect(endCallArgs.components[0].components[0].data.emoji.name).toBe('👈');
      expect(endCallArgs.components[0].components[0].data.label).toBe('Custom Prev');
    });

    it('should handle custom emojis with default labels in options', async () => {
      const options = {
        prevEmoji: '👈',
        nextEmoji: '👉'
      };
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger, options);
      
      const callArgs = mockInteraction.editReply.mock.calls[0][0];
      expect(callArgs.components[0].components[0].data.emoji.name).toBe('👈');
      expect(callArgs.components[0].components[0].data.label).toBeUndefined(); // skipped label setting because label is default ◀

      await collectorEmitter.listeners['end']({ size: 0 });
      const endCallArgs = mockInteraction.editReply.mock.calls[1][0];
      expect(endCallArgs.components[0].components[0].data.emoji.name).toBe('👈');
      expect(endCallArgs.components[0].components[0].data.label).toBeUndefined();
    });

    it('should ignore unknown button click types', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      const mockButtonInteraction = {
        customId: 'test_other_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockResolvedValue(true),
        editReply: jest.fn().mockResolvedValue(true)
      };

      await collectorEmitter.listeners['collect'](mockButtonInteraction);
      expect(mockButtonInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockButtonInteraction.editReply).toHaveBeenCalled();
    });

    it('should filter correct interactions', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      const collectorOptions = mockMessage.createMessageComponentCollector.mock.calls[0][0];
      const filter = collectorOptions.filter;
      
      expect(filter({ customId: 'test_prev_user-123_123' })).toBe(true);
      expect(filter({ customId: 'test_next_user-123_123' })).toBe(true);
      expect(filter({ customId: 'other_prev_user-123_123' })).toBe(false);
      expect(filter({ customId: 'test_prev_other-456_123' })).toBe(false);
    });

    it('should defer update before slow embed generation on button press', async () => {
      const slowEmbed = jest.fn(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve({ title: 'Page 1' }), 50);
          })
      );

      await searchUtils.createPaginatedResults(
        mockInteraction,
        items,
        slowEmbed,
        'test',
        60000,
        mockLogger
      );

      const mockButtonInteraction = {
        customId: 'test_next_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockResolvedValue(true),
        editReply: jest.fn().mockResolvedValue(true)
      };

      await collectorEmitter.listeners['collect'](mockButtonInteraction);

      expect(mockButtonInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockButtonInteraction.editReply).toHaveBeenCalled();
      expect(mockButtonInteraction.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        mockButtonInteraction.editReply.mock.invocationCallOrder[0]
      );
    });

    it('should catch and log error if editReply fails on collector end', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      mockInteraction.editReply.mockRejectedValueOnce(new Error('Discord API Error'));
      
      // Trigger 'end'
      await collectorEmitter.listeners['end']({ size: 1 });
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to update timed out message.',
        expect.any(Object)
      );
    });

    it('should ignore collect event if pageUpdateInFlight is true (lines 87-88)', async () => {
      const slowEmbed = jest.fn(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve({ title: 'Page 1' }), 50);
          })
      );
      await searchUtils.createPaginatedResults(mockInteraction, items, slowEmbed, 'test', 60000, mockLogger);
      
      const mockButtonInteraction1 = {
        customId: 'test_next_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockResolvedValue(true),
        editReply: jest.fn().mockResolvedValue(true)
      };
      
      const mockButtonInteraction2 = {
        customId: 'test_next_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockRejectedValue(new Error('defer error')),
        editReply: jest.fn().mockResolvedValue(true)
      };

      const p1 = collectorEmitter.listeners['collect'](mockButtonInteraction1);
      const p2 = collectorEmitter.listeners['collect'](mockButtonInteraction2);
      
      await Promise.all([p1, p2]);
      
      expect(mockButtonInteraction1.editReply).toHaveBeenCalled();
      expect(mockButtonInteraction2.editReply).not.toHaveBeenCalled();
      expect(mockButtonInteraction2.deferUpdate).toHaveBeenCalled();
    });

    it('should log error if editing reply fails during collect (line 118)', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      const mockButtonInteraction = {
        customId: 'test_next_user-123_123',
        user: { id: 'user-123' },
        deferUpdate: jest.fn().mockResolvedValue(true),
        editReply: jest.fn().mockRejectedValue(new Error('Edit Failed'))
      };
      
      await collectorEmitter.listeners['collect'](mockButtonInteraction);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to update paginated result.',
        expect.any(Object)
      );
    });
  });
});
