const { createMockInteraction } = require('../testUtils');

describe('quote command', () => {
  let quoteCommand;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({ baseEmbedColor: 0x432109 }));

    quoteCommand = require('../../commands/quote');
  });

  describe('execute', () => {
    it('should quote message content successfully with embed', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-1',
        content: '   This is a message to quote.   ',
        createdAt: new Date('2026-05-18T12:00:00Z'),
        author: {
          tag: 'QuotedAuthor#4321',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/quoted')
        }
      };

      await quoteCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toBe('This is a message to quote.');
      expect(embed.data.color).toBe(0x432109);
      expect(embed.data.author.name).toBe('QuotedAuthor#4321');
      expect(embed.data.author.icon_url).toBe('http://avatar.url/quoted');
      expect(embed.data.footer.text).toBe(`Quoted by ${mockInteraction.user.tag}`);
    });

    it('should use default embed color 0 if baseEmbedColor is missing', async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => ({ baseEmbedColor: undefined }));
      const newQuoteCommand = require('../../commands/quote');

      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-2',
        content: 'Fallback Color Test',
        createdAt: new Date(),
        author: {
          tag: 'QuotedAuthor#4321',
          displayAvatarURL: jest.fn().mockReturnValue('http://avatar.url/quoted')
        }
      };

      await newQuoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should return warning if message content is empty or null', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-3',
        content: null
      };

      await quoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The selected message has no text content to quote.'
      }));
    });

    it('should return warning if message content is too long', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-4',
        content: 'A'.repeat(4097)
      };

      await quoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The message is too long to quote.'
      }));
    });

    it('should catch errors and call editReply with unexpected error message', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-5',
        content: 'Error simulation'
      };
      mockInteraction.deferReply.mockRejectedValue(new Error('Simulation error'));

      await quoteCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should trigger inline catch handler on editReply rejection', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-8',
        content: 'Error simulation'
      };
      mockInteraction.deferReply.mockRejectedValue(new Error('Simulation error'));
      mockInteraction.editReply.mockRejectedValue(new Error('editReply error'));

      await quoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should fall back to reply if editReply is not a function inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-6',
        content: 'Error simulation'
      };
      mockInteraction.deferReply.mockRejectedValue(new Error('Simulation error'));
      mockInteraction.editReply = null; // triggers synchronous TypeError in outer try block
      mockInteraction.reply = jest.fn().mockResolvedValue({});

      await quoteCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should catch errors gracefully if fallback reply also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-quote-7',
        content: 'Error simulation'
      };
      mockInteraction.deferReply.mockRejectedValue(new Error('Simulation error'));
      mockInteraction.editReply = null; // triggers TypeError
      mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply failed'));

      await expect(quoteCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
