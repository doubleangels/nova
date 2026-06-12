const {
  truncateForEmbed,
  truncateEmbedTitle,
  truncateEmbedDescription,
  truncateEmbedField,
  truncateEmbedAuthor,
  sanitizeEmbedField,
  EMBED_TITLE_MAX,
  EMBED_DESCRIPTION_MAX,
  EMBED_FIELD_MAX
} = require('../../utils/embedUtils');

describe('embedUtils', () => {
  it('should pass short text through truncateForEmbed unchanged', () => {
    expect(truncateForEmbed('hello', 10)).toBe('hello');
  });

  it('should truncate long text with ellipsis', () => {
    expect(truncateForEmbed('abcdefghij', 5)).toBe('abcd…');
  });

  it('should handle empty and nullish text', () => {
    expect(truncateForEmbed(null, 10)).toBe('');
    expect(truncateForEmbed('   ', 10)).toBe('');
  });

  it('should truncate embed title and description', () => {
    expect(truncateEmbedTitle('x'.repeat(EMBED_TITLE_MAX))).toHaveLength(EMBED_TITLE_MAX);
    expect(truncateEmbedTitle('')).toBe('Untitled');
    expect(truncateEmbedDescription('y'.repeat(EMBED_DESCRIPTION_MAX))).toHaveLength(EMBED_DESCRIPTION_MAX);
    expect(truncateEmbedDescription('')).toBe('No description.');
  });

  it('should truncate embed fields with fallback', () => {
    expect(truncateEmbedField('value')).toBe('value');
    expect(truncateEmbedField('')).toBe('None');
    expect(truncateEmbedField(null)).toBe('None');
    expect(truncateEmbedField(undefined, 'N/A')).toBe('N/A');
    expect(truncateEmbedField('z'.repeat(EMBED_FIELD_MAX))).toHaveLength(EMBED_FIELD_MAX);
    expect(truncateEmbedField('', 'N/A')).toBe('N/A');
  });

  it('should truncate embed author names', () => {
    expect(truncateEmbedAuthor('Alice')).toBe('Alice');
    expect(truncateEmbedAuthor('')).toBe('Unknown');
  });

  it('should sanitize embed field name and value', () => {
    expect(sanitizeEmbedField({ name: 'Title', value: 'Body', inline: true })).toEqual({
      name: 'Title',
      value: 'Body',
      inline: true
    });
    expect(sanitizeEmbedField({ name: '', value: '' }, 'Empty')).toEqual({
      name: 'Field',
      value: 'Empty'
    });
    expect(sanitizeEmbedField({ name: 'n'.repeat(300), value: 'ok' }).name).toHaveLength(256);
  });
});
