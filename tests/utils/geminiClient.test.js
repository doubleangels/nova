describe('geminiClient', () => {
  let mockAxios;
  let client;

  beforeEach(() => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextModel: undefined,
      geminiContextCacheTtlSeconds: 3600
    }));
    client = require('../../utils/geminiClient');
  });

  it('should parse JSON from plain text and fenced blocks', () => {
    expect(client.parseJsonFromModelText('{"note":"hi"}')).toEqual({ note: 'hi' });
    expect(
      client.parseJsonFromModelText('```json\n{"note":"ok"}\n```')
    ).toEqual({ note: 'ok' });
  });

  it('should build generate content body with google search', () => {
    const body = client.buildGenerateContentBody(
      'user prompt',
      'system text',
      { responseMimeType: 'application/json' },
      undefined,
      true
    );
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.systemInstruction.parts[0].text).toBe('system text');
  });

  it('should return null from generateStructuredJson when not configured', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ geminiApiKey: '' }));
    const disabled = require('../../utils/geminiClient');
    const result = await disabled.generateStructuredJson({
      userPrompt: 'test',
      systemInstruction: 'sys',
      responseSchema: { type: 'object', properties: { note: { type: 'string' } } }
    });
    expect(result).toBeNull();
  });
});
