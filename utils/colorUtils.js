// We define these patterns to validate different formats of hex color codes.
const COLOR_PATTERN_HEX_WITH_HASH = /^#[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_WITHOUT_HASH = /^[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_SHORT = /^#[0-9A-Fa-f]{3}$/;

// Discord's color range is 0-16777215 (0xFFFFFF)
const DISCORD_MAX_COLOR = 0xFFFFFF;

/**
 * Validates and normalizes a hex color code.
 * We check if the provided string is a valid hex color and standardize its format.
 * If it's just RRGGBB without #, we add the # prefix for consistency.
 * If it already has the correct format with #, we use it as is.
 * If it's a 3-digit hex, we expand it to 6 digits.
 * If it doesn't match any valid format, we consider it invalid.
 *
 * @param {string} colorHex - The color hex code to validate.
 * @param {object} logger - Optional logger instance for debug information.
 * @returns {Object} An object with success status and normalized color.
 * @throws {Error} If colorHex is not a string or is empty.
 */
function validateAndNormalizeColor(colorHex, logger = null) {
    // Input validation
    if (typeof colorHex !== 'string') {
        throw new Error('Color must be a string');
    }
    if (!colorHex.trim()) {
        throw new Error('Color cannot be empty');
    }

    let normalizedColorHex = colorHex.trim();
    
    // Handle 3-digit hex colors (e.g., #RGB)
    if (COLOR_PATTERN_HEX_SHORT.test(normalizedColorHex)) {
        normalizedColorHex = '#' + 
            normalizedColorHex[1] + normalizedColorHex[1] +
            normalizedColorHex[2] + normalizedColorHex[2] +
            normalizedColorHex[3] + normalizedColorHex[3];
        if (logger) {
            logger.debug("Expanded 3-digit hex color.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
    }
    
    if (COLOR_PATTERN_HEX_WITHOUT_HASH.test(normalizedColorHex)) {
        // If it's just RRGGBB without #, we add the # prefix for consistency.
        normalizedColorHex = `#${normalizedColorHex}`;
        if (logger) {
            logger.debug("Color format normalized.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
        return { success: true, normalizedColor: normalizedColorHex };
    } else if (COLOR_PATTERN_HEX_WITH_HASH.test(normalizedColorHex)) {
        // If it already has the correct format with #, we use it as is.
        return { success: true, normalizedColor: normalizedColorHex };
    }
    
    // If it doesn't match any valid format, we consider it invalid.
    return { success: false };
}

/**
 * Converts a hex color to a decimal value for Discord's color system.
 * We transform the hex string to the numeric format that Discord's API expects.
 * We remove # if present before converting to a decimal number.
 * We validate that the color is within Discord's valid range.
 *
 * @param {string} hexColor - The hex color code (with or without #).
 * @returns {number} The decimal color value.
 * @throws {Error} If the color is invalid or out of Discord's range.
 */
function hexToDecimal(hexColor) {
    const validation = validateAndNormalizeColor(hexColor);
    if (!validation.success) {
        throw new Error('Invalid hex color format');
    }

    // We remove # if present before converting to a decimal number.
    const hex = validation.normalizedColor.slice(1);
    const decimal = parseInt(hex, 16);

    // Validate Discord's color range
    if (decimal > DISCORD_MAX_COLOR) {
        throw new Error('Color value exceeds Discord\'s maximum (0xFFFFFF)');
    }

    return decimal;
}

/**
 * Converts a hex color to RGB values.
 * 
 * @param {string} hexColor - The hex color code (with or without #).
 * @returns {Object} Object containing r, g, b values (0-255).
 * @throws {Error} If the color is invalid.
 */
function hexToRgb(hexColor) {
    const validation = validateAndNormalizeColor(hexColor);
    if (!validation.success) {
        throw new Error('Invalid hex color format');
    }

    const hex = validation.normalizedColor.slice(1);
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

/**
 * Converts RGB values to a hex color code.
 * 
 * @param {number} r - Red value (0-255).
 * @param {number} g - Green value (0-255).
 * @param {number} b - Blue value (0-255).
 * @returns {string} Hex color code with # prefix.
 * @throws {Error} If any RGB value is invalid.
 */
function rgbToHex(r, g, b) {
    // Validate RGB values
    if (!Number.isInteger(r) || r < 0 || r > 255 ||
        !Number.isInteger(g) || g < 0 || g > 255 ||
        !Number.isInteger(b) || b < 0 || b > 255) {
        throw new Error('RGB values must be integers between 0 and 255');
    }

    return '#' + 
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0');
}

/**
 * @module colorUtils
 * @description Utility functions for handling and converting Discord colors.
 * @exports {Object} Object containing color utility functions.
 */
module.exports = {
    validateAndNormalizeColor,
    hexToDecimal,
    hexToRgb,
    rgbToHex
};