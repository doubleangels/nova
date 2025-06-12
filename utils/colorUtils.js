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