// Configuration constants.
const COLOR_PATTERN_HEX_WITH_HASH = /^#[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_WITHOUT_HASH = /^[0-9A-Fa-f]{6}$/;

/**
 * Validates and normalizes a hex color code.
 * @param {string} colorHex - The color hex code to validate.
 * @param {object} logger - Optional logger instance for debug information.
 * @returns {Object} An object with success status and normalized color.
 */
function validateAndNormalizeColor(colorHex, logger = null) {
    let normalizedColorHex = colorHex;
    
    if (COLOR_PATTERN_HEX_WITHOUT_HASH.test(colorHex)) {
        // If it's just RRGGBB without #, add the #.
        normalizedColorHex = `#${colorHex}`;
        if (logger) {
            logger.debug("Color format normalized.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
        return { success: true, normalizedColor: normalizedColorHex };
    } else if (COLOR_PATTERN_HEX_WITH_HASH.test(colorHex)) {
        // If it already has the correct format with #, use it as is.
        return { success: true, normalizedColor: normalizedColorHex };
    }
    
    // If it doesn't match either format, it's invalid.
    return { success: false };
}

/**
 * Converts a hex color to a decimal value for Discord's color system.
 * @param {string} hexColor - The hex color code (with or without #).
 * @returns {number} The decimal color value.
 */
function hexToDecimal(hexColor) {
    // Remove # if present
    const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
    return parseInt(hex, 16);
}

module.exports = {
    validateAndNormalizeColor,
    hexToDecimal
};