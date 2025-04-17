// We define these patterns to validate different formats of hex color codes.
const COLOR_PATTERN_HEX_WITH_HASH = /^#[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_WITHOUT_HASH = /^[0-9A-Fa-f]{6}$/;

/**
 * Validates and normalizes a hex color code.
 * We check if the provided string is a valid hex color and standardize its format.
 * 
 * @param {string} colorHex - The color hex code to validate.
 * @param {object} logger - Optional logger instance for debug information.
 * @returns {Object} An object with success status and normalized color.
 */
function validateAndNormalizeColor(colorHex, logger = null) {
    let normalizedColorHex = colorHex;
    
    if (COLOR_PATTERN_HEX_WITHOUT_HASH.test(colorHex)) {
        // If it's just RRGGBB without #, we add the # prefix for consistency.
        normalizedColorHex = `#${colorHex}`;
        if (logger) {
            logger.debug("Color format normalized.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
        return { success: true, normalizedColor: normalizedColorHex };
    } else if (COLOR_PATTERN_HEX_WITH_HASH.test(colorHex)) {
        // If it already has the correct format with #, we use it as is.
        return { success: true, normalizedColor: normalizedColorHex };
    }
    
    // If it doesn't match either format, we consider it invalid.
    return { success: false };
}

/**
 * Converts a hex color to a decimal value for Discord's color system.
 * We transform the hex string to the numeric format that Discord's API expects.
 * 
 * @param {string} hexColor - The hex color code (with or without #).
 * @returns {number} The decimal color value.
 */
function hexToDecimal(hexColor) {
    // We remove # if present before converting to a decimal number.
    const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
    return parseInt(hex, 16);
}

module.exports = {
    validateAndNormalizeColor,
    hexToDecimal
};