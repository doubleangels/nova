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

    it('should handle prev and next buttons', async () => {
      await searchUtils.createPaginatedResults(mockInteraction, items, generateEmbed, 'test', 60000, mockLogger);
      
      const mockButtonInteraction = {
        customId: 'test_next_user-123_123',
        user: { id: 'user-123' },
        update: jest.fn().mockResolvedValue(true)
      };

      // Trigger 'collect' for 'next'
      await collectorEmitter.listeners['collect'](mockButtonInteraction);
      
      expect(mockButtonInteraction.update).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [{ title: 'Page 1' }]
      }));

      // Trigger 'collect' for 'prev'
      mockButtonInteraction.customId = 'test_prev_user-123_123';
      await collectorEmitter.listeners['collect'](mockButtonInteraction);

      expect(mockButtonInteraction.update).toHaveBeenCalledWith(expect.objectContaining({
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
  });
});
