const { validateAndNormalizeColor, hexToDecimal } = require('../../utils/colorUtils');

describe('colorUtils', () => {
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('validateAndNormalizeColor', () => {
    it('should normalize a 3-digit hex color', () => {
      const result = validateAndNormalizeColor('#fff', mockLogger);
      expect(result).toEqual({ success: true, normalizedColor: '#ffffff' });
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should normalize a 6-digit hex color without hash', () => {
      const result = validateAndNormalizeColor('ff0000', mockLogger);
      expect(result).toEqual({ success: true, normalizedColor: '#ff0000' });
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should normalize a 6-digit hex color with hash', () => {
      const result = validateAndNormalizeColor('#00ff00', mockLogger);
      expect(result).toEqual({ success: true, normalizedColor: '#00ff00' });
    });

    it('should return success: false for invalid colors', () => {
      expect(validateAndNormalizeColor('red').success).toBe(false);
      expect(validateAndNormalizeColor('#12345').success).toBe(false);
      expect(validateAndNormalizeColor('#1234567').success).toBe(false);
    });

    it('should throw error for non-string input', () => {
      expect(() => validateAndNormalizeColor(123)).toThrow('⚠️ Invalid color format provided.');
    });

    it('should throw error for empty string input', () => {
      expect(() => validateAndNormalizeColor('   ')).toThrow('⚠️ Empty color value provided.');
    });
  });

  describe('hexToDecimal', () => {
    it('should convert valid hex to decimal', () => {
      expect(hexToDecimal('#000000')).toBe(0);
      expect(hexToDecimal('#ffffff')).toBe(16777215);
      expect(hexToDecimal('#ff0000')).toBe(16711680);
      expect(hexToDecimal('00ff00')).toBe(65280);
      expect(hexToDecimal('#00f')).toBe(255);
    });

    it('should throw error for invalid hex color format', () => {
      expect(() => hexToDecimal('invalid')).toThrow('⚠️ Invalid color format provided.');
    });

    it('should throw error if color value is out of valid range', () => {
      const colorUtils = require('../../utils/colorUtils');
      const spy = jest.spyOn(colorUtils, 'validateAndNormalizeColor').mockReturnValue({
        success: true,
        normalizedColor: '#1000000' // 7 digits, parsed value is 0x1000000 > 0xFFFFFF
      });

      expect(() => colorUtils.hexToDecimal('#1000000')).toThrow('⚠️ Color value is out of valid range.');
      spy.mockRestore();
    });
  });
});
