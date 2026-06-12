describe('messageReactionAdd event', () => {
  let messageReactionAddEvent;
  let mockLogger;
  let mockInstrument;
  let mockLanguageUtils;
  let mockConfig;
  let mockAxios;

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

    mockLanguageUtils = {
      getLanguageInfo: jest.fn(),
      isValidTranslationFlag: jest.fn()
    };
    jest.doMock('../../utils/languageUtils', () => mockLanguageUtils);

    mockConfig = {
      deeplApiKey: 'deepl-key-123'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      post: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    messageReactionAddEvent = require('../../events/messageReactionAdd');
  });

  it('should ignore reaction if user is a bot', async () => {
    const mockReaction = {};
    const mockUser = { bot: true };

    await messageReactionAddEvent.execute(mockReaction, mockUser);

    expect(mockLogger.debug).toHaveBeenCalledWith('Bot reaction received, ignoring.');
  });

  it('should skip translation when DEEPL_API_KEY is not configured', async () => {
    mockConfig.deeplApiKey = undefined;

    const mockReaction = {
      partial: false,
      emoji: { name: '🇺🇸' },
      message: { id: 'msg-1', content: 'hello' }
    };
    const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

    mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);

    await messageReactionAddEvent.execute(mockReaction, mockUser);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Translation was skipped because DEEPL_API_KEY is not configured.'
    );
    expect(mockLanguageUtils.getLanguageInfo).not.toHaveBeenCalled();
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  it('should fetch reaction data if it is partial', async () => {
    const mockReaction = {
      partial: true,
      fetch: jest.fn().mockResolvedValue(),
      emoji: { name: '🇺🇸' },
      message: { id: 'msg-1' }
    };
    const mockUser = { bot: false, id: 'user-1' };

    mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);

    await messageReactionAddEvent.execute(mockReaction, mockUser);

    expect(mockReaction.fetch).toHaveBeenCalled();
  });

  it('should log error and throw/log if reaction fetch fails', async () => {
    const mockReaction = {
      partial: true,
      fetch: jest.fn().mockRejectedValue(new Error('Fetch fail')),
      emoji: { name: '🇺🇸' },
      message: { id: 'msg-1' }
    };
    const mockUser = { bot: false, id: 'user-1' };

    mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);

    await messageReactionAddEvent.execute(mockReaction, mockUser);

    expect(mockLogger.error).toHaveBeenCalledWith('Error occurred while fetching reaction.', expect.any(Object));
  });

  it('should log when execute throws before translation handler completes', async () => {
    const mockReaction = {
      partial: false,
      emoji: { name: '🇺🇸' },
      message: { id: 'msg-1' }
    };
    const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

    mockLanguageUtils.isValidTranslationFlag.mockImplementation(() => {
      throw new Error('flag check exploded');
    });

    await messageReactionAddEvent.execute(mockReaction, mockUser);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error occurred while processing reaction.',
      expect.objectContaining({ errorMessage: expect.any(String) })
    );
  });

  it('should log outer catch when reaction message is missing', async () => {
    const mockReaction = {
      partial: false,
      emoji: { name: '🇺🇸' }
    };
    const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

    mockLanguageUtils.isValidTranslationFlag.mockImplementation(() => {
      throw new Error('flag check exploded');
    });

    await messageReactionAddEvent.execute(mockReaction, mockUser);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error occurred while processing reaction.',
      expect.objectContaining({ messageId: undefined })
    );
  });

  describe('handleTranslationRequest', () => {
    it('should ignore if reaction emoji is not a valid translation flag', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '😊' },
        message: { id: 'msg-1' }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(false);

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should warn and skip if flag is valid but language info is not found', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: { id: 'msg-1', reply: jest.fn().mockResolvedValue() }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue(null);

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid translation flag provided.', expect.any(Object));
      expect(mockReaction.message.reply).not.toHaveBeenCalled();
    });

    it('should warn and skip if message is null/undefined', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: null
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.warn).toHaveBeenCalledWith('Message not found for translation.', expect.any(Object));
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'Error occurred in translation request.',
        expect.any(Object)
      );
    });

    it('should warn and skip if message content is empty', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: { id: 'msg-1', content: '', reply: jest.fn().mockResolvedValue() }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.warn).toHaveBeenCalledWith('Empty message content found for translation.', expect.any(Object));
      expect(mockReaction.message.reply).not.toHaveBeenCalled();
    });

    it('should translate successfully and reply with the embed (guild member highest role color)', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: {
          id: 'msg-1',
          content: 'Hola',
          reply: jest.fn().mockResolvedValue(),
          guild: {
            members: {
              cache: {
                get: jest.fn().mockReturnValue({
                  roles: {
                    highest: { color: 0xff0000 }
                  }
                })
              }
            }
          }
        }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });

      mockAxios.post.mockResolvedValue({
        data: {
          translations: [
            { text: 'Hello' }
          ]
        }
      });

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api-free.deepl.com/v2/translate',
        expect.any(URLSearchParams),
        {
          timeout: 10000,
          headers: {
            Authorization: 'DeepL-Auth-Key deepl-key-123'
          }
        }
      );
      const requestBody = mockAxios.post.mock.calls[0][1];
      expect(requestBody.get('text')).toBe('Hola');
      expect(requestBody.get('target_lang')).toBe('EN');
      expect(mockReaction.message.reply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          color: 0xff0000,
          title: 'Translation to English 🇺🇸',
          description: 'Hello',
          footer: { text: 'Translation requested by: User#1234' }
        })]
      });
    });

    it('should translate successfully with default color if message has no guild, no member, or highest role has color 0', async () => {
      const testCases = [
        { guild: null }, // no guild
        { guild: { members: { cache: { get: () => null } } } }, // no member
        { guild: { members: { cache: { get: () => ({ roles: { highest: { color: 0 } } }) } } } } // highest role color 0
      ];

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });

      mockAxios.post.mockResolvedValue({
        data: {
          translations: [
            { text: 'Hello' }
          ]
        }
      });

      for (const testCase of testCases) {
        const mockReaction = {
          partial: false,
          emoji: { name: '🇺🇸' },
          message: {
            id: 'msg-1',
            content: 'Hola',
            reply: jest.fn().mockResolvedValue(),
            guild: testCase.guild
          }
        };
        const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

        await messageReactionAddEvent.execute(mockReaction, mockUser);

        // Check if embed color is 0x0099ff (default color)
        expect(mockReaction.message.reply).toHaveBeenCalledWith({
          embeds: [expect.objectContaining({
            color: 0x0099ff,
            title: 'Translation to English 🇺🇸',
            description: 'Hello'
          })]
        });
      }
    });

    it('should fetch partial message before translating', async () => {
      const fetchedMessage = {
        id: 'msg-1',
        content: 'Hola',
        partial: false,
        reply: jest.fn().mockResolvedValue(),
        guild: { members: { cache: { get: () => ({ roles: { highest: { color: 0xff0000 } } }) } } }
      };

      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: {
          partial: true,
          fetch: jest.fn().mockResolvedValue(fetchedMessage)
        }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });
      mockAxios.post.mockResolvedValue({
        data: { translations: [{ text: 'Hello' }] }
      });

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockReaction.message.fetch).toHaveBeenCalled();
      expect(fetchedMessage.reply).toHaveBeenCalled();
    });

    it('should warn and return when DeepL returns no translation text', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: {
          id: 'msg-1',
          content: 'Hola',
          reply: jest.fn().mockResolvedValue(),
          guild: { members: { cache: { get: () => ({ roles: { highest: { color: 0xff0000 } } }) } } }
        }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });
      mockAxios.post.mockResolvedValue({ data: { translations: [] } });

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'DeepL returned no translation.',
        expect.objectContaining({ messageId: 'msg-1', userId: 'user-1' })
      );
      expect(mockReaction.message.reply).not.toHaveBeenCalled();
    });

    it('should handle Google translation API 403 error specifically', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: {
          id: 'msg-1',
          content: 'Hola',
          reply: jest.fn().mockResolvedValue()
        }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });

      const apiError = new Error('Forbidden');
      apiError.response = { status: 403, statusText: 'Forbidden', data: {} };
      mockAxios.post.mockRejectedValue(apiError);

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockReaction.message.reply).toHaveBeenCalledWith({
        content: '⚠️ Translation API error occurred.',
        allowedMentions: { repliedUser: false }
      });
    });

    it('should skip error reply when translation fails without a message reference', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: {
          id: 'msg-1',
          content: 'Hola',
          reply: jest.fn().mockResolvedValue()
        }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });
      mockAxios.post.mockImplementation(() => {
        mockReaction.message = undefined;
        throw new Error('api fail');
      });

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred in translation request.',
        expect.any(Object)
      );
    });

    it('should catch secondary errors if reply rejects', async () => {
      const mockReaction = {
        partial: false,
        emoji: { name: '🇺🇸' },
        message: {
          id: 'msg-1',
          content: 'Hola',
          reply: jest.fn().mockRejectedValue(new Error('Reply fail'))
        }
      };
      const mockUser = { bot: false, id: 'user-1', tag: 'User#1234' };

      mockLanguageUtils.isValidTranslationFlag.mockReturnValue(true);
      mockLanguageUtils.getLanguageInfo.mockReturnValue({ code: 'en', name: 'English' });

      mockAxios.post.mockRejectedValue(new Error('API fail'));

      await messageReactionAddEvent.execute(mockReaction, mockUser);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error message.', expect.any(Object));
    });
  });
});
