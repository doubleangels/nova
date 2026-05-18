const { createMockInteraction } = require('../testUtils');

describe('mock command', () => {
  let mockCommand;
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
    jest.doMock('../../config', () => ({ baseEmbedColor: 0x990000 }));

    mockCommand = require('../../commands/mock');
  });

  describe('convertToMock', () => {
    it('should convert text to alternating case correctly', () => {
      const result = mockCommand.convertToMock('Hello World 123!');
      // H -> h, E -> I, L -> l, L -> O, O -> o (wait, let's verify alternating letters)
      // Array.from(text).map((ch) => {
      //   if (/[a-zA-Z]/.test(ch)) {
      //     const out = upper ? ch.toUpperCase() : ch.toLowerCase();
      //     upper = !upper;
      //     return out;
      //   }
      //   return ch;
      // })
      // 'H' (letter, upper=false) -> 'h' (upper becomes true)
      // 'e' (letter, upper=true) -> 'E' (upper becomes false)
      // 'l' (letter, upper=false) -> 'l' (upper becomes true)
      // 'l' (letter, upper=true) -> 'L' (upper becomes false)
      // 'o' (letter, upper=false) -> 'o' (upper becomes true)
      // ' ' (non-letter) -> ' ' (upper unchanged: true)
      // 'W' (letter, upper=true) -> 'W' (upper becomes false)
      // 'o' (letter, upper=false) -> 'o' (upper becomes true)
      // 'r' (letter, upper=true) -> 'R' (upper becomes false)
      // 'l' (letter, upper=false) -> 'l' (upper becomes true)
      // 'd' (letter, upper=true) -> 'D' (upper becomes false)
      // ' ' -> ' '
      // '1' -> '1'
      // '2' -> '2'
      // '3' -> '3'
      // '!' -> '!'
      // Output: hElLo WoRlD 123!
      expect(result).toBe('hElLo WoRlD 123!');
    });
  });

  describe('execute', () => {
    it('should mock message content successfully', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-999',
        content: 'Original Message Text',
        createdAt: new Date('2026-05-18T12:00:00Z'),
        author: { tag: 'User#1111' }
      };

      await mockCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('oRiGiNaL mEsSaGe TeXt');
      expect(embed.data.color).toBe(0x990000);
      expect(embed.data.footer.text).toBe('Mocked from User#1111');
    });

    it('should use default embed color 0 if not configured', async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => ({ baseEmbedColor: undefined }));
      const newMockCommand = require('../../commands/mock');

      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = {
        id: 'msg-999',
        content: 'Test Color Fallback',
        createdAt: new Date(),
        author: { tag: 'User#1111' }
      };

      await newMockCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0);
    });

    it('should return warning if message content is empty', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = { id: 'msg-999', content: '   ' };

      await mockCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The selected message has no text content to convert.'
      }));
    });

    it('should return warning if message content is too long', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.targetMessage = { id: 'msg-999', content: 'A'.repeat(2001) };

      await mockCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The message is too long to convert. Please select a shorter message.'
      }));
    });

    it('should call handleError if error occurs during execute', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.deferReply.mockRejectedValue(new Error('MESSAGE_NOT_FOUND'));

      await mockCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The selected message could not be found.'
      }));
    });
  });

  describe('handleError', () => {
    it.each([
      ['MESSAGE_NOT_FOUND', '⚠️ The selected message could not be found.'],
      ['NO_PERMISSION', "⚠️ You don't have permission to view this message."],
      ['MESSAGE_TOO_LONG', '⚠️ The message is too long to convert.'],
      ['NO_TEXT_CONTENT', '⚠️ The selected message has no text content to convert.'],
      ['SOME_OTHER_ERROR', '⚠️ An unexpected error occurred while converting the message. Please try again later.']
    ])('should display correct message for %s error', async (errorName, expectedText) => {
      const mockInteraction = createMockInteraction();
      await mockCommand.handleError(mockInteraction, new Error(errorName));

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expectedText
      }));
    });

    it('should fallback to reply if editReply fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));
      mockInteraction.reply = jest.fn().mockResolvedValue({});

      await mockCommand.handleError(mockInteraction, new Error('NO_PERMISSION'));

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ You don't have permission to view this message."
      }));
    });

    it('should catch error if fallback reply also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));
      mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply failed'));

      await expect(mockCommand.handleError(mockInteraction, new Error('NO_PERMISSION'))).resolves.not.toThrow();
    });
  });
});
