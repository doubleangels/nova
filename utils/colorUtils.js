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
            logger.debug("Expanded 3-digit hex color.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
    }
    
    if (/^[0-9A-Fa-f]{6}$/.test(normalizedColorHex)) {
        normalizedColorHex = `#${normalizedColorHex}`;
        if (logger) {
            logger.debug("Color format normalized.", { 
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

/**
 * Converts a hex color string to its RGB components
 * @param {string} hexColor - The hex color string to convert
 * @throws {Error} If the color format is invalid
 * @returns {{r: number, g: number, b: number}} Object containing RGB components
 */
function hexToRgb(hexColor) {
    const validation = validateAndNormalizeColor(hexColor);
    if (!validation.success) {
        throw new Error("⚠️ Invalid color format provided.");
    }

    const hex = validation.normalizedColor.slice(1);
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

/**
 * Converts RGB components to a hex color string
 * @param {number} r - Red component (0-255)
 * @param {number} g - Green component (0-255)
 * @param {number} b - Blue component (0-255)
 * @throws {Error} If any RGB component is invalid
 * @returns {string} The hex color string
 */
function rgbToHex(r, g, b) {
    if (!Number.isInteger(r) || r < 0 || r > 255 ||
        !Number.isInteger(g) || g < 0 || g > 255 ||
        !Number.isInteger(b) || b < 0 || b > 255) {
        throw new Error("⚠️ Invalid RGB values provided.");
    }

    return '#' + 
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0');
}

module.exports = {
    validateAndNormalizeColor,
    hexToDecimal,
    hexToRgb,
    rgbToHex
};