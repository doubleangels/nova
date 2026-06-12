const EMBED_TITLE_MAX = 256;
const EMBED_DESCRIPTION_MAX = 4096;
const EMBED_FIELD_MAX = 1024;
const EMBED_FIELD_NAME_MAX = 256;
const EMBED_AUTHOR_MAX = 256;

/**
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateForEmbed(text, maxLength) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  if (s.length <= maxLength) return s;
  return `${s.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncateEmbedTitle(text) {
  return truncateForEmbed(text, EMBED_TITLE_MAX) || 'Untitled';
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncateEmbedDescription(text) {
  return truncateForEmbed(text, EMBED_DESCRIPTION_MAX) || 'No description.';
}

/**
 * @param {string} text
 * @param {string} [fallback]
 * @returns {string}
 */
function truncateEmbedField(text, fallback = 'None') {
  const s = String(text ?? '').trim();
  if (!s) return fallback;
  return truncateForEmbed(s, EMBED_FIELD_MAX);
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncateEmbedAuthor(text) {
  return truncateForEmbed(text, EMBED_AUTHOR_MAX) || 'Unknown';
}

/**
 * @param {{ name: string, value: string, inline?: boolean }} field
 * @param {string} [fallback]
 * @returns {{ name: string, value: string, inline?: boolean }}
 */
function sanitizeEmbedField(field, fallback = 'None') {
  return {
    ...field,
    name: truncateForEmbed(field.name, EMBED_FIELD_NAME_MAX) || 'Field',
    value: truncateEmbedField(field.value, fallback)
  };
}

module.exports = {
  EMBED_TITLE_MAX,
  EMBED_DESCRIPTION_MAX,
  EMBED_FIELD_MAX,
  EMBED_FIELD_NAME_MAX,
  EMBED_AUTHOR_MAX,
  truncateForEmbed,
  truncateEmbedTitle,
  truncateEmbedDescription,
  truncateEmbedField,
  truncateEmbedAuthor,
  sanitizeEmbedField
};
