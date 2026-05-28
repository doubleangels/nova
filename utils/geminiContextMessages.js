const AI_CONTEXT_MAX_LENGTH = 280;
const AI_CONTEXT_FIELD_NAME = 'AI Insight:';

/**
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncateContext(text, maxLen = AI_CONTEXT_MAX_LENGTH) {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

/**
 * @param {string} note
 * @returns {{ name: string, value: string }|null}
 */
function formatAiContextField(note) {
  const value = truncateContext(note);
  if (!value) return null;
  return {
    name: AI_CONTEXT_FIELD_NAME,
    value: `_${value}_`
  };
}

module.exports = {
  AI_CONTEXT_MAX_LENGTH,
  AI_CONTEXT_FIELD_NAME,
  truncateContext,
  formatAiContextField
};
