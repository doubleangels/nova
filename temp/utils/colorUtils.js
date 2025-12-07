/**
 * Validates and normalizes a hex color string to a standard 6-digit format
 * @param {string} colorHex - The hex color string to validate and normalize
 * @param {Object} [logger=null] - Optional logger instance for debug logging
 * @throws {Error} If the color format is invalid or empty
 * @returns {{success: boolean, normalizedColor?: string}} Object containing success status and normalized color if successful
 */
function validateAndNormalizeColor(colorHex, logger = null) {
    if (typeof colorHex !== 'string') {
        throw new Error("⚠️ Invalid color format provided.");
    }
    if (!colorHex.trim()) {
        throw new Error("⚠️ Empty color value provided.");
    }

    let normalizedColorHex = colorHex.trim();
    
    if (/^#[0-9A-Fa-f]{3}$/.test(normalizedColorHex)) {
        normalizedColorHex = '#' + 
            normalizedColorHex[1] + normalizedColorHex[1] +
            normalizedColorHex[2] + normalizedColorHex[2] +
            normalizedColorHex[3] + normalizedColorHex[3];
        if (logger) {
            logger.debug("Expanded 3-digit hex color:", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
    }
    
    if (/^[0-9A-Fa-f]{6}$/.test(normalizedColorHex)) {
        normalizedColorHex = `#${normalizedColorHex}`;
        if (logger) {
            logger.debug("Color format normalized:", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
        return { success: true, normalizedColor: normalizedColorHex };
    } else if (/^#[0-9A-Fa-f]{6}$/.test(normalizedColorHex)) {
        return { success: true, normalizedColor: normalizedColorHex };
    }
    
    return { success: false };
}

/**
 * Converts a hex color string to its decimal representation
 * @param {string} hexColor - The hex color string to convert
 * @throws {Error} If the color format is invalid or out of range
 * @returns {number} The decimal representation of the hex color
 */
function hexToDecimal(hexColor) {
    const validation = validateAndNormalizeColor(hexColor);
    if (!validation.success) {
        throw new Error("⚠️ Invalid color format provided.");
    }

    const hex = validation.normalizedColor.slice(1);
    const decimal = parseInt(hex, 16);

    if (decimal > 0xFFFFFF) {
        throw new Error("⚠️ Color value is out of valid range.");
    }

    return decimal;
}

module.exports = {
    validateAndNormalizeColor,
    hexToDecimal
};
