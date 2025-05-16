const { EmbedBuilder } = require('discord.js');

// Regular expression patterns for validating different hex color formats
const COLOR_PATTERN_HEX_WITH_HASH = /^#[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_WITHOUT_HASH = /^[0-9A-Fa-f]{6}$/;
const COLOR_PATTERN_HEX_SHORT = /^#[0-9A-Fa-f]{3}$/;
const DISCORD_MAX_COLOR = 0xFFFFFF; // Maximum color value supported by Discord (16777215)

/**
 * Validates and normalizes a hex color string.
 * 
 * @param {string} colorHex - The hex color string to validate (with or without # prefix)
 * @param {Object} [logger=null] - Optional logger for debug information
 * @returns {Object} Result object with success flag and normalized color
 * @throws {Error} If the color is not a string or is empty
 */
function validateAndNormalizeColor(colorHex, logger = null) {
    if (typeof colorHex !== 'string') {
        throw new Error('Color must be a string');
    }
    if (!colorHex.trim()) {
        throw new Error('Color cannot be empty');
    }

    let normalizedColorHex = colorHex.trim();
    
    // Convert short hex format (#RGB) to full format (#RRGGBB)
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
    
    // Add # prefix if missing
    if (COLOR_PATTERN_HEX_WITHOUT_HASH.test(normalizedColorHex)) {
        normalizedColorHex = `#${normalizedColorHex}`;
        if (logger) {
            logger.debug("Color format normalized.", { 
                original: colorHex, 
                normalized: normalizedColorHex 
            });
        }
        return { success: true, normalizedColor: normalizedColorHex };
    } else if (COLOR_PATTERN_HEX_WITH_HASH.test(normalizedColorHex)) {
        return { success: true, normalizedColor: normalizedColorHex };
    }
    
    // Return failure if the color doesn't match any valid pattern
    return { success: false };
}

/**
 * Converts a hex color string to its decimal representation.
 * 
 * @param {string} hexColor - The hex color string to convert
 * @returns {number} The decimal value of the color
 * @throws {Error} If the hex color format is invalid or exceeds Discord's maximum
 */
function hexToDecimal(hexColor) {
    const validation = validateAndNormalizeColor(hexColor);
    if (!validation.success) {
        throw new Error('Invalid hex color format');
    }

    const hex = validation.normalizedColor.slice(1);
    const decimal = parseInt(hex, 16);

    // Check if the color exceeds Discord's maximum value
    if (decimal > DISCORD_MAX_COLOR) {
        throw new Error('Color value exceeds Discord\'s maximum (0xFFFFFF)');
    }

    return decimal;
}

/**
 * Converts a hex color string to its RGB components.
 * 
 * @param {string} hexColor - The hex color string to convert
 * @returns {Object} Object containing r, g, b values (0-255)
 * @throws {Error} If the hex color format is invalid
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
 * Converts RGB color components to a hex color string.
 * 
 * @param {number} r - Red component (0-255)
 * @param {number} g - Green component (0-255)
 * @param {number} b - Blue component (0-255)
 * @returns {string} Hex color string with # prefix
 * @throws {Error} If any RGB value is not an integer between 0 and 255
 */
function rgbToHex(r, g, b) {
    if (!Number.isInteger(r) || r < 0 || r > 255 ||
        !Number.isInteger(g) || g < 0 || g > 255 ||
        !Number.isInteger(b) || b < 0 || b > 255) {
        throw new Error('RGB values must be integers between 0 and 255');
    }

    // Convert each component to two-digit hex value
    return '#' + 
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0');
}

/**
 * Checks if a string is a valid hex color.
 * Supports #RGB and #RRGGBB formats, with or without # prefix.
 * 
 * @param {string} color - The color string to validate
 * @returns {boolean} True if the color is a valid hex color, false otherwise
 */
function isValidHexColor(color) {
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

/**
 * Normalizes a hex color string to the standard #RRGGBB format.
 * Handles #RGB format and adds the # prefix if missing.
 * 
 * @param {string} color - The color string to normalize
 * @returns {string|null} Normalized hex color or null if input is falsy
 */
function normalizeHexColor(color) {
  if (!color) return null;
  
  const hex = color.replace('#', '');
  // Convert short hex format (#RGB) to full format (#RRGGBB)
  if (hex.length === 3) {
    return '#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return '#' + hex;
}

/**
 * Creates a Discord embed displaying a color preview.
 * 
 * @param {string} color - The hex color to display
 * @returns {EmbedBuilder|null} Discord embed with color preview or null if color is invalid
 */
function createColorEmbed(color) {
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) return null;

  // Create embed with color preview image
  const embed = new EmbedBuilder()
    .setColor(normalizedColor)
    .setTitle('Color Preview')
    .setDescription(`Hex: ${normalizedColor}`)
    .setImage(`https://via.placeholder.com/150/${normalizedColor.slice(1)}/ffffff?text=+`);

  return embed;
}

module.exports = {
    validateAndNormalizeColor,
    hexToDecimal,
    hexToRgb,
    rgbToHex,
    isValidHexColor,
    normalizeHexColor,
    createColorEmbed
}; 