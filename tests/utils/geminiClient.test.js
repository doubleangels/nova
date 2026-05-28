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

  it('should return null for invalid JSON inside a fenced block', () => {
    expect(client.parseJsonFromModelText('```json\nnot-json\n```')).toBeNull();
  });

  it('should extract JSON from raw text with surrounding content', () => {
    const result = client.parseJsonFromModelText('prefix {"key":"value"} suffix');
    expect(result).toEqual({ key: 'value' });
  });

  it('should return null for text with no JSON object', () => {
    expect(client.parseJsonFromModelText('no json here')).toBeNull();
    expect(client.parseJsonFromModelText(null)).toBeNull();
    expect(client.parseJsonFromModelText('')).toBeNull();
  });

  it('should return null for invalid JSON extracted from braces', () => {
    expect(client.parseJsonFromModelText('{ not valid json }')).toBeNull();
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

  it('should build body without google search when disabled', () => {
    const body = client.buildGenerateContentBody('prompt', 'sys', {}, undefined, false);
    expect(body.tools).toBeUndefined();
    expect(body.systemInstruction.parts[0].text).toBe('sys');
  });

  it('should use cachedContent instead of systemInstruction when cachedContentName is set (lines 102-105)', () => {
    const body = client.buildGenerateContentBody('prompt', 'sys', {}, 'cachedContents/abc', true);
    expect(body.cachedContent).toBe('cachedContents/abc');
    expect(body.systemInstruction).toBeUndefined();
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

  it('should return parsed JSON from generateStructuredJson with token usage logging (lines 218-225)', async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        usageMetadata: { prompt_token_count: 100, cached_content_token_count: 50 },
        candidates: [{ content: { parts: [{ text: '{"result":"ok"}' }] } }]
      }
    });
    const result = await client.generateStructuredJson({
      userPrompt: 'test', systemInstruction: 'sys',
      responseSchema: {}, logLabel: 'test-label'
    });
    expect(result).toEqual({ result: 'ok' });
  });

  it('should return null from generateStructuredJson when candidates has no parts (line 228)', async () => {
    mockAxios.post.mockResolvedValue({
      data: { candidates: [{ content: { parts: null } }] }
    });
    const result = await client.generateStructuredJson({
      userPrompt: 'test', systemInstruction: 'sys', responseSchema: {}
    });
    expect(result).toBeNull();
  });

  it('should return zero for readUsageMetadata when input is invalid', () => {
    expect(client.readUsageMetadata(null)).toEqual({ cachedTokens: 0, promptTokens: 0 });
    expect(client.readUsageMetadata('string')).toEqual({ cachedTokens: 0, promptTokens: 0 });
  });

  it('should read valid usageMetadata object (lines 71-72)', () => {
    expect(client.readUsageMetadata({
      prompt_token_count: 200,
      cached_content_token_count: 10
    })).toEqual({ cachedTokens: 10, promptTokens: 200 });
  });

  it('should use geminiContextModel when set (lines 23-26)', () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => ({ post: jest.fn() }));
    jest.doMock('../../config', () => ({
      geminiApiKey: 'k',
      geminiContextModel: 'my-context-model',
      geminiPredictionModel: 'other-model'
    }));
    const c = require('../../utils/geminiClient');
    expect(c.getGeminiModel()).toBe('my-context-model');
  });

  it('should fall back to DEFAULT_MODEL when no model configured (line 26)', () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => ({ post: jest.fn() }));
    jest.doMock('../../config', () => ({
      geminiApiKey: 'k',
      geminiContextModel: undefined,
      geminiPredictionModel: undefined
    }));
    const c = require('../../utils/geminiClient');
    expect(c.getGeminiModel()).toBe(c.DEFAULT_MODEL);
  });

  it('should reuse cached context and skip creation on second getOrCreate call', async () => {
    mockAxios.post.mockResolvedValue({ data: { name: 'cachedContents/ctx1' } });
    const mgr = new client.SystemContextCacheManager('test');
    const first = await mgr.getOrCreate('key', 'system text', 'display-name');
    const second = await mgr.getOrCreate('key', 'system text', 'display-name');
    expect(first).toBe('cachedContents/ctx1');
    expect(second).toBe('cachedContents/ctx1');
    expect(mockAxios.post).toHaveBeenCalledTimes(1);
  });

  it('should return null from getOrCreate when cache creation fails', async () => {
    mockAxios.post.mockRejectedValue(new Error('network'));
    const mgr = new client.SystemContextCacheManager('test');
    const result = await mgr.getOrCreate('key2', 'sys', 'display');
    expect(result).toBeNull();
  });

  it('should return null from createSystemContextCache when response has no name', async () => {
    mockAxios.post.mockResolvedValue({ data: {} });
    const result = await client.createSystemContextCache('sys', 'display');
    expect(result).toBeNull();
  });

  it('should clear entries in SystemContextCacheManager', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/c1' } })
      .mockResolvedValueOnce({ data: { name: 'cachedContents/c2' } });
    const mgr = new client.SystemContextCacheManager('ns');
    await mgr.getOrCreate('k', 'sys', 'disp');
    mgr.clear();
    await mgr.getOrCreate('k', 'sys', 'disp');
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
  });

  it('should store entry with expiry in getOrCreate (line 271)', async () => {
    mockAxios.post.mockResolvedValue({ data: { name: 'cachedContents/new' } });
    const mgr = new client.SystemContextCacheManager('ns2');
    const name = await mgr.getOrCreate('k2', 'sys', 'disp');
    expect(name).toBe('cachedContents/new');
    // Second call should reuse without hitting the API again
    const name2 = await mgr.getOrCreate('k2', 'sys', 'disp');
    expect(name2).toBe('cachedContents/new');
    expect(mockAxios.post).toHaveBeenCalledTimes(1);
  });

  it('should fall back to DEFAULT_MODEL when model string is whitespace (line 26)', () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => ({ post: jest.fn() }));
    jest.doMock('../../config', () => ({
      geminiApiKey: 'k',
      geminiContextModel: '   ',
      geminiPredictionModel: '   '
    }));
    const c = require('../../utils/geminiClient');
    expect(c.getGeminiModel()).toBe(c.DEFAULT_MODEL);
  });

  it('should fallback to 0 for usage tokens when missing or invalid (lines 71-72)', () => {
    expect(client.readUsageMetadata({
      prompt_token_count: 'invalid',
      cached_content_token_count: null
    })).toEqual({ cachedTokens: 0, promptTokens: 0 });
    expect(client.readUsageMetadata({})).toEqual({ cachedTokens: 0, promptTokens: 0 });
  });

  it('should build generate content body with no system instruction (lines 102-108)', () => {
    const body = client.buildGenerateContentBody('prompt', null, {}, null, false);
    expect(body.cachedContent).toBeUndefined();
    expect(body.systemInstruction).toBeUndefined();
  });

  it('should return null from createSystemContextCache when not configured (line 117)', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ geminiApiKey: '' }));
    const disabled = require('../../utils/geminiClient');
    const result = await disabled.createSystemContextCache('sys', 'display');
    expect(result).toBeNull();
  });

  it('should fallback to 3600 TTL when config TTL is missing in SystemContextCacheManager (line 271)', async () => {
    jest.resetModules();
    const mockPost = jest.fn().mockResolvedValue({ data: { name: 'cachedContents/abc' } });
    jest.doMock('../../utils/httpClient', () => ({ post: mockPost }));
    jest.doMock('../../config', () => ({
      geminiApiKey: 'k',
      geminiContextCacheTtlSeconds: 0 // falls back to 3600
    }));
    const c = require('../../utils/geminiClient');
    const mgr = new c.SystemContextCacheManager('ns3');
    await mgr.getOrCreate('k3', 'sys', 'disp');
    // We can't directly check the internal TTL easily without inspecting `mgr.entries`, so we inspect that.
    const entry = mgr.entries.get(mgr.fullKey('k3'));
    // 3600000 ms - buffer
    expect(entry.expiresAt).toBeGreaterThan(Date.now() + 3500000);
  });
});
