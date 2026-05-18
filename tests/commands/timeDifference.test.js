const { createMockInteraction } = require('../testUtils');

describe('timeDifference command', () => {
  let timeDifferenceCommand;
  let mockLogger;
  let mockLocationUtils;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockConfig = {
      googleApiKey: 'mock-google-key',
      baseEmbedColor: 0x00aaff
    };
    jest.doMock('../../config', () => mockConfig);

    mockLocationUtils = {
      getUtcOffset: jest.fn(),
      formatPlaceName: jest.fn((p) => p),
      formatErrorMessage: jest.fn((p, type) => `Error for ${p}: ${type}`)
    };
    jest.doMock('../../utils/locationUtils', () => mockLocationUtils);

    timeDifferenceCommand = require('../../commands/timeDifference');
  });

  describe('execute', () => {
    it('should reply with configuration warning if Google API key is missing', async () => {
      mockConfig.googleApiKey = null;
      const mockInteraction = createMockInteraction();

      await timeDifferenceCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should calculate time difference successfully when first place is ahead (offset1 > offset2)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'Tokyo' : 'London';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 9, timeZoneName: 'JST', placeName: 'Tokyo, Japan' })
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'BST', placeName: 'London, UK' });

      await timeDifferenceCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Time Difference Information');
      expect(embed.data.description).toContain('The time difference is **8 hours**');
      expect(embed.data.description).toContain('**Tokyo, Japan** is ahead');
    });

    it('should calculate time difference successfully when second place is ahead (offset1 < offset2)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'London' : 'Tokyo';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'BST', placeName: 'London, UK' })
        .mockResolvedValueOnce({ error: false, offset: 9.5, timeZoneName: 'ACST', placeName: 'Darwin, Australia' });

      await timeDifferenceCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('8 hours and 30 minutes');
      expect(embed.data.description).toContain('**Darwin, Australia** is ahead');
    });

    it('should format singular hour and minute properly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'PlaceA' : 'PlaceB';
          })
        }
      });

      // 1 hour and 1 minute difference
      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 2.0167, timeZoneName: 'TZ1', placeName: 'PlaceA' })
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'TZ2', placeName: 'PlaceB' });

      await timeDifferenceCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('1 hour and 1 minute');
    });

    it('should calculate time difference when both places are in the same time zone', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'Berlin' : 'Paris';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 2, timeZoneName: 'CEST', placeName: 'Berlin' })
        .mockResolvedValueOnce({ error: false, offset: 2, timeZoneName: 'CEST', placeName: 'Paris' });

      await timeDifferenceCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('**Berlin** and **Paris** are in the same time zone.');
    });

    it('should format exactly 1 hour difference (line 210 false branch)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'Paris' : 'London';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 2, timeZoneName: 'CEST', placeName: 'Paris' })
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'BST', placeName: 'London' });

      await timeDifferenceCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('The time difference is **1 hour**.');
    });

    it('should fall back to original place names if placeName is missing in offset results (lines 138-139)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'PlaceA' : 'PlaceB';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 2, timeZoneName: 'TZ1', placeName: null })
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'TZ2', placeName: undefined });

      await timeDifferenceCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields[0].name).toBe('PlaceA');
      expect(embed.data.fields[1].name).toBe('PlaceB');
    });

    it('should return warning if first location offset fails to retrieve', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'InvalidPlace' : 'London';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: true, errorType: 'NOT_FOUND' })
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'BST', placeName: 'London' });

      await timeDifferenceCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Error for InvalidPlace: NOT_FOUND'
      }));
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should return warning if second location offset fails to retrieve', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'London' : 'InvalidPlace';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: 1, timeZoneName: 'BST', placeName: 'London' })
        .mockResolvedValueOnce({ error: true, errorType: 'API_ERROR' });

      await timeDifferenceCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Error for InvalidPlace: API_ERROR'
      }));
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should format negative timezone offsets properly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'NewYork' : 'London';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: -5, timeZoneName: 'EST', placeName: 'New York' })
        .mockResolvedValueOnce({ error: false, offset: 0, timeZoneName: 'GMT', placeName: 'London' });

      await timeDifferenceCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields[0].value).toBe('UTC-5 (EST)');
    });

    it('should format fractional negative timezone offsets properly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            return name === 'first-place' ? 'Caracas' : 'London';
          })
        }
      });

      mockLocationUtils.getUtcOffset
        .mockResolvedValueOnce({ error: false, offset: -4.5, timeZoneName: 'VET', placeName: 'Caracas' })
        .mockResolvedValueOnce({ error: false, offset: 0, timeZoneName: 'GMT', placeName: 'London' });

      await timeDifferenceCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.fields[0].value).toBe('UTC-4:30 (VET)');
    });

    it('should call handleError if an unexpected exception is thrown in calculateTimeDifference', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('place')
        }
      });

      mockLocationUtils.getUtcOffset.mockRejectedValue(new Error('Unexpected calculation failure'));

      await timeDifferenceCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while calculating time difference. Please try again later.'
      }));
    });
  });

  describe('handleError', () => {
    it.each([
      ['API_ERROR', '⚠️ Failed to retrieve timezone information. Please try again later.', null],
      ['ECONNABORTED', '⚠️ The request timed out. Please try again.', { code: 'ECONNABORTED' }],
      ['403_STATUS', '⚠️ API access denied. Please check API configuration.', { response: { status: 403 } }],
      ['429_STATUS', '⚠️ Too many requests. Please try again later.', { response: { status: 429 } }],
      ['500_STATUS', '⚠️ Failed to retrieve timezone information. Please try again later.', { response: { status: 500 } }],
      ['UNKNOWN_ERROR', '⚠️ An unexpected error occurred while calculating time difference. Please try again later.', new Error('generic')]
    ])('should reply with correct error for %s', async (name, expectedMessage, errorObj) => {
      const mockInteraction = createMockInteraction();
      let error = errorObj instanceof Error ? errorObj : new Error(name);
      if (errorObj && !(errorObj instanceof Error)) {
        Object.assign(error, errorObj);
      }

      await timeDifferenceCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expectedMessage
      }));
    });

    it('should fall back to reply if editReply is not a function inside handleError', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply = null;
      mockInteraction.reply = jest.fn().mockResolvedValue({});

      await timeDifferenceCommand.handleError(mockInteraction, new Error('API_ERROR'));

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve timezone information. Please try again later.'
      }));
    });

    it('should catch errors gracefully if fallback reply also fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply = null;
      mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply failed'));

      await expect(timeDifferenceCommand.handleError(mockInteraction, new Error('API_ERROR'))).resolves.not.toThrow();
    });
  });
});
