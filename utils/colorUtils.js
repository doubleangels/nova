// We define these patterns to validate different formats of hex color codes for consistent color handling.
const COLOR_PATTERN_HEX_WITH_HASH = /^#[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_WITHOUT_HASH = /^[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_SHORT = /^#[0-9A-Fa-f]{3}$/;

// We define Discord's maximum color value to ensure colors stay within valid range.
const DISCORD_MAX_COLOR = 0xFFFFFF;

/**
 * We validate and normalize a hex color code to ensure consistent color handling.
 * This function standardizes color formats and handles various input patterns.
 * 
 * @param {string} colorHex - The color hex code to validate
 * @param {object} logger - Optional logger instance for debug information
 * @returns {Object} An object with success status and normalized color
 * @throws {Error} If colorHex is not a string or is empty
 */
function validateAndNormalizeColor(colorHex, logger = null) {
    // We validate the input to ensure proper color handling.
    if (typeof colorHex !== 'string') {
        throw new Error('Color must be a string');
    }
    if (!colorHex.trim()) {
        throw new Error('Color cannot be empty');
    }

    let normalizedColorHex = colorHex.trim();
    
    // We handle 3-digit hex colors by expanding them to 6 digits.
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
        // We add the # prefix for consistency when it's missing.
        normalizedColorHex = `#${normalizedColorHex}`;
        if (logger) {
            logger.debug("Color format normalized.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
        return { success: true, normalizedColor: normalizedColorHex };
    } else if (COLOR_PATTERN_HEX_WITH_HASH.test(normalizedColorHex)) {
        // We use the color as is when it's already in the correct format.
        return { success: true, normalizedColor: normalizedColorHex };
    }
    
    // We return failure for invalid color formats.
    return { success: false };
}

/**
 * We convert a hex color to a decimal value for Discord's color system.
 * This function ensures colors are in the format required by Discord's API.
 * 
 * @param {string} hexColor - The hex color code (with or without #)
 * @returns {number} The decimal color value
 * @throws {Error} If the color is invalid or out of Discord's range
 */
function hexToDecimal(hexColor) {
    const validation = validateAndNormalizeColor(hexColor);
    if (!validation.success) {
        throw new Error('Invalid hex color format');
    }

    // We convert the hex string to a decimal number for Discord.
    const hex = validation.normalizedColor.slice(1);
    const decimal = parseInt(hex, 16);

    // We validate that the color is within Discord's allowed range.
    if (decimal > DISCORD_MAX_COLOR) {
        throw new Error('Color value exceeds Discord\'s maximum (0xFFFFFF)');
    }

    return decimal;
}

/**
 * We convert a hex color to RGB values for color manipulation.
 * This function breaks down the hex color into its RGB components.
 * 
 * @param {string} hexColor - The hex color code (with or without #)
 * @returns {Object} Object containing r, g, b values (0-255)
 * @throws {Error} If the color is invalid
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
 * We convert RGB values to a hex color code for consistent color representation.
 * This function ensures RGB values are properly formatted as hex colors.
 * 
 * @param {number} r - Red value (0-255)
 * @param {number} g - Green value (0-255)
 * @param {number} b - Blue value (0-255)
 * @returns {string} Hex color code with # prefix
 * @throws {Error} If any RGB value is invalid
 */
function rgbToHex(r, g, b) {
    // We validate RGB values to ensure they are within the valid range.
    if (!Number.isInteger(r) || r < 0 || r > 255 ||
        !Number.isInteger(g) || g < 0 || g > 255 ||
        !Number.isInteger(b) || b < 0 || b > 255) {
        throw new Error('RGB values must be integers between 0 and 255');
    }

    // We convert RGB values to a hex string with proper padding.
    return '#' + 
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0');
}

/**
 * We export the color utility functions for use throughout the application.
 * This module provides consistent color handling and conversion capabilities.
 */
module.exports = {
    validateAndNormalizeColor,
    hexToDecimal,
    hexToRgb,
    rgbToHex
};