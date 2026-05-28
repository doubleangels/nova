const msgs = require('../../utils/geminiContextMessages');

describe('geminiContextMessages', () => {
  it('should truncate long context notes', () => {
    const long = 'a'.repeat(300);
    expect(msgs.truncateContext(long).length).toBeLessThanOrEqual(msgs.AI_CONTEXT_MAX_LENGTH);
  });

  it('should format AI context embed field', () => {
    const field = msgs.formatAiContextField('Stay hydrated.');
    expect(field).toEqual({
      name: 'AI Insight:',
      value: '_Stay hydrated._'
    });
  });

  it('should return null for empty note', () => {
    expect(msgs.formatAiContextField('   ')).toBeNull();
  });
});
