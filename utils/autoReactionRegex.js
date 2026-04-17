/**
 * Escape a string for safe use inside a RegExp source (keyword mode).
 * @param {string} str
 * @returns {string}
 */
function escapeRegexMeta(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive "whole token" pattern from a plain keyword.
 * Uses padded boundaries instead of \\b so symbols like C++ still match.
 * @param {string} keyword
 * @returns {{ regex: string, flags: string }}
 */
function keywordToWordBoundaryPattern(keyword) {
  const esc = escapeRegexMeta(String(keyword ?? '').trim());
  if (!esc) return { regex: '(?!.)', flags: 'i' };
  return { regex: `(^|[^\\w])${esc}($|[^\\w])`, flags: 'i' };
}

/**
 * Normalizes dashboard regex input so `/word/flags` JS literal notation works.
 * Without this, `new RegExp('/dubz/i', 'i')` matches the literal text "/dubz/i", not "dubz".
 *
 * @param {string} raw
 * @returns {{ pattern: string, flags: string }}
 */
function normalizeAutoReactionRegex(raw) {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('/')) {
    return { pattern: s, flags: 'i' };
  }
  let i = s.length - 1;
  let flags = '';
  while (i > 0 && 'gimsuy'.includes(s[i])) {
    flags = s[i] + flags;
    i--;
  }
  if (s[i] !== '/') {
    return { pattern: s.slice(1), flags: 'i' };
  }
  const pattern = s.slice(1, i);
  return { pattern, flags: flags || 'i' };
}

module.exports = {
  normalizeAutoReactionRegex,
  escapeRegexMeta,
  keywordToWordBoundaryPattern
};
