describe('languageUtils', () => {
  let languageUtils;
  let mockLogger;

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
    
    languageUtils = require('../../utils/languageUtils');
  });

  describe('getLanguageInfo', () => {
    it('should return language info for valid flag', () => {
      const info = languageUtils.getLanguageInfo('🇺🇸');
      expect(info).toEqual({ code: 'en', name: 'English' });
    });

    it('should return null for invalid flag emoji that is a string', () => {
      const info = languageUtils.getLanguageInfo('👽');
      expect(info).toBeNull();
    });

    it('should throw error for invalid input types', () => {
      expect(() => languageUtils.getLanguageInfo(null)).toThrow('⚠️ Invalid flag emoji provided for translation.');
      expect(() => languageUtils.getLanguageInfo(123)).toThrow('⚠️ Invalid flag emoji provided for translation.');
    });
  });

  describe('isValidTranslationFlag', () => {
    it('should return true for valid flag', () => {
      expect(languageUtils.isValidTranslationFlag('🇫🇷')).toBe(true);
    });

    it('should return false for invalid string', () => {
      expect(languageUtils.isValidTranslationFlag('not-a-flag')).toBe(false);
    });

    it('should throw error for invalid input types', () => {
      expect(() => languageUtils.isValidTranslationFlag(undefined)).toThrow('⚠️ Invalid flag emoji provided for translation.');
      expect(() => languageUtils.isValidTranslationFlag({})).toThrow('⚠️ Invalid flag emoji provided for translation.');
    });
  });
});
