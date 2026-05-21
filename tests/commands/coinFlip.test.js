const { createMockInteraction } = require('../testUtils');

describe('coinFlip command', () => {
  let coinFlipCommand;
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
    jest.doMock('../../config', () => ({}));

    coinFlipCommand = require('../../commands/coinFlip');
  });

  describe('execute', () => {
    it('should flip coin and reply with Heads', async () => {
      const mockInteraction = createMockInteraction();
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.4);

      await coinFlipCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.reply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('Heads');

      randomSpy.mockRestore();
    });

    it('should flip coin and reply with Tails', async () => {
      const mockInteraction = createMockInteraction();
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.6);

      await coinFlipCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.reply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('Tails');

      randomSpy.mockRestore();
    });

    it('should handle errors during execute and call handleError', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.reply.mockRejectedValue(new Error('RESULT_FAILED'));

      await coinFlipCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Failed to generate coin flip result')
      }));
    });
  });

  describe('handleError', () => {
    it('should handle RESPONSE_FAILED error', async () => {
      const mockInteraction = createMockInteraction();
      await coinFlipCommand.handleError(mockInteraction, new Error('RESPONSE_FAILED'));

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Failed to send coin flip result')
      }));
    });

    it('should fallback to reply if editReply throws', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('edit failed'));
      mockInteraction.reply = jest.fn().mockResolvedValue({});

      await coinFlipCommand.handleError(mockInteraction, new Error('RESPONSE_FAILED'));

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Failed to send coin flip result')
      }));
    });

    it('should catch error if fallback reply also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('edit failed'));
      mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply failed'));

      await expect(coinFlipCommand.handleError(mockInteraction, new Error('UNKNOWN'))).resolves.not.toThrow();
    });
  });
});
