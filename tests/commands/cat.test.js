const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('cat command', () => {
  let catCommand;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    catCommand = require('../../commands/cat');
    jest.clearAllMocks();
  });

  it('should successfully fetch and display a random cat image', async () => {
    const mockInteraction = createMockInteraction();
    
    mockAxios.get.mockResolvedValueOnce({
      data: [{ url: 'https://cdn.cat.com/meow.jpg' }]
    });

    await catCommand.execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockAxios.get).toHaveBeenCalledWith('https://api.thecatapi.com/v1/images/search');
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
    
    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.title).toBe('Random Cat');
    expect(sentEmbed.data.image.url).toBe('https://cdn.cat.com/meow.jpg');
    
    expect(mockLogger.info).toHaveBeenCalledWith('/cat command completed successfully.', expect.any(Object));
  });

  it('should handle all custom error types in error catch block', async () => {
    const errorTypes = [
      { msg: 'API_ERROR', expected: "⚠️ Couldn't fetch a cat picture due to an API error. Try again later." },
      { msg: 'INVALID_RESPONSE', expected: "⚠️ The cat service didn't send a proper image. Please try again." },
      { msg: 'NETWORK_ERROR', expected: "⚠️ Couldn't connect to the cat image service. Please check your internet connection." },
      { msg: 'SOME_GENERIC_ERROR', expected: "⚠️ An unexpected error occurred. Please try again later." }
    ];

    for (const errType of errorTypes) {
      jest.clearAllMocks();
      const mockInteraction = createMockInteraction();

      mockAxios.get.mockRejectedValueOnce(new Error(errType.msg));

      await catCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in cat command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: errType.expected
      }));
    }
  });

  it('should fallback to reply if editReply fails inside error catch block', async () => {
    const mockInteraction = createMockInteraction();

    mockAxios.get.mockRejectedValueOnce(new Error('API_ERROR'));
    mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

    await catCommand.execute(mockInteraction);

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for cat command.', expect.any(Object));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: "⚠️ Couldn't fetch a cat picture due to an API error. Try again later."
    }));
  });

  it('should silently catch errors if fallback reply also fails inside catch block', async () => {
    const mockInteraction = createMockInteraction();

    mockAxios.get.mockRejectedValueOnce(new Error('API_ERROR'));
    mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
    mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

    await expect(catCommand.execute(mockInteraction)).resolves.not.toThrow();
  });
});
