const {
  sanitizeLogMeta,
  serializeError,
  safeAttachmentLabel,
  stripUrlQuery,
  sanitizeValue,
  isSecretKey,
  isUrlKey,
  REDACTED
} = require('../utils/logSanitize');

describe('logSanitize', () => {
  it('should sanitizeLogMeta redact secret keys', () => {
    const result = sanitizeLogMeta({
      userId: '1',
      token: 'secret-token',
      openaiApiKey: 'sk-test',
      content: 'hello world'
    });
    expect(result.userId).toBe('1');
    expect(result.token).toBe(REDACTED);
    expect(result.openaiApiKey).toBe(REDACTED);
    expect(result.content).toBe(REDACTED);
  });

  it('should sanitizeLogMeta redact Nova-specific secret keys', () => {
    const result = sanitizeLogMeta({
      pirateWeatherApiKey: 'pw-key',
      deeplApiKey: 'deepl-key',
      redditClientSecret: 'reddit-secret',
      responseData: { error: 'bad key' },
      errorDetails: { reason: 'invalid' }
    });
    expect(result.pirateWeatherApiKey).toBe(REDACTED);
    expect(result.deeplApiKey).toBe(REDACTED);
    expect(result.redditClientSecret).toBe(REDACTED);
    expect(result.responseData).toBe(REDACTED);
    expect(result.errorDetails).toBe(REDACTED);
  });

  it('should sanitizeLogMeta preserve display names', () => {
    const result = sanitizeLogMeta({
      user: 'User#0001',
      channelName: 'general',
      guildName: 'Test Guild'
    });
    expect(result.user).toBe('User#0001');
    expect(result.channelName).toBe('general');
    expect(result.guildName).toBe('Test Guild');
  });

  it('should sanitizeLogMeta strip URL query strings', () => {
    const result = sanitizeLogMeta({
      requestUrl: 'https://example.com/search?q=secret&key=abc123'
    });
    expect(result.requestUrl).toBe('https://example.com/search');
  });

  it('should sanitizeLogMeta handle nested objects', () => {
    const result = sanitizeLogMeta({
      outer: {
        token: 'nested-secret',
        safe: 'value'
      }
    });
    expect(result.outer.token).toBe(REDACTED);
    expect(result.outer.safe).toBe('value');
  });

  it('should serializeError return safe fields', () => {
    const err = new Error('boom');
    err.status = 403;
    err.config = { headers: { Authorization: 'Bearer secret' }, url: 'https://api.example.com?key=abc' };
    const result = serializeError(err);
    expect(result.errorName).toBe('Error');
    expect(result.errorMessage).toBe('boom');
    expect(result.httpStatus).toBe(403);
    expect(result.config).toBeUndefined();
    expect(result.headers).toBeUndefined();
  });

  it('should serializeError include truncated stack when requested', () => {
    const err = new Error('stack test');
    err.stack = ['Error: stack test', '  at line 1', '  at line 2', '  at line 3', '  at line 4', '  at line 5', '  at line 6', '  at line 7', '  at line 8', '  at line 9'].join('\n');
    const result = serializeError(err, { includeStack: true });
    expect(result.stack).toContain('Error: stack test');
    expect(result.stack.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('should sanitizeLogMeta serialize error key with truncated stack', () => {
    const err = new Error('handler failed');
    err.config = { headers: { Authorization: 'secret' } };
    const result = sanitizeLogMeta({ error: err, userId: '1' });
    expect(result.userId).toBe('1');
    expect(result.error.errorMessage).toBe('handler failed');
    expect(result.error.stack).toBeDefined();
    expect(result.error.config).toBeUndefined();
  });

  it('should sanitizeLogMeta serialize err key with truncated stack', () => {
    const err = new Error('handler failed');
    err.config = { headers: { Authorization: 'secret' } };
    const result = sanitizeLogMeta({ err, userId: '1' });
    expect(result.userId).toBe('1');
    expect(result.err.errorMessage).toBe('handler failed');
    expect(result.err.stack).toBeDefined();
    expect(result.err.config).toBeUndefined();
  });

  it('should sanitizeLogMeta omit stack for non-error meta keys', () => {
    const err = new Error('wrapped');
    expect(sanitizeLogMeta({ failure: err }).failure.stack).toBeUndefined();
  });

  it('should stripUrlQuery remove query string', () => {
    expect(stripUrlQuery('https://example.com/path?key=secret')).toBe('https://example.com/path');
  });

  it('should safeAttachmentLabel prefer attachment id', () => {
    expect(safeAttachmentLabel({ id: '123', url: 'https://cdn.example.com/file.png' })).toBe('attachment:123');
    expect(safeAttachmentLabel({ filename: 'photo.png' })).toBe('file:photo.png');
    expect(safeAttachmentLabel({ name: 'clip.gif' })).toBe('file:clip.gif');
    expect(safeAttachmentLabel({ contentType: 'image/png' })).toBe('media:image/png');
    expect(safeAttachmentLabel({})).toBe('attachment');
    expect(safeAttachmentLabel(null)).toBe('attachment');
  });

  it('should stripUrlQuery handle invalid URLs without protocol', () => {
    expect(stripUrlQuery('/relative/path?secret=1')).toBe('/relative/path');
  });

  it('should sanitizeLogMeta handle arrays and deep nesting', () => {
    const result = sanitizeLogMeta([
      { token: 'secret' },
      'safe'
    ]);
    expect(result[0].token).toBe(REDACTED);
    expect(result[1]).toBe('safe');

    function buildDeep(levels) {
      let node = { leaf: true };
      for (let i = 0; i < levels; i += 1) {
        node = { nested: node };
      }
      return node;
    }

    expect(sanitizeLogMeta({ items: [{ token: 'nested' }, 'plain'] }).items[0].token).toBe(REDACTED);
    expect(JSON.stringify(sanitizeLogMeta(buildDeep(9)))).toContain(REDACTED);
    expect(sanitizeLogMeta({ leaf: true }, 9)).toEqual({ truncated: true });

    expect(sanitizeLogMeta(null)).toBeNull();
    expect(sanitizeLogMeta(undefined)).toBeUndefined();
    expect(sanitizeLogMeta('plain')).toBe('plain');
  });

  it('should serializeError omit stack when unavailable', () => {
    const err = new Error('no stack');
    delete err.stack;
    expect(serializeError(err, { includeStack: true }).stack).toBeUndefined();
  });

  it('should serializeError read statusCode and httpStatus fallbacks', () => {
    const fromStatusCode = new Error('from statusCode');
    fromStatusCode.statusCode = 418;
    expect(serializeError(fromStatusCode).httpStatus).toBe(418);

    const fromHttpStatus = new Error('from httpStatus');
    fromHttpStatus.httpStatus = 503;
    expect(serializeError(fromHttpStatus).httpStatus).toBe(503);
  });

  it('should not treat partial error shapes as errors in sanitizeLogMeta', () => {
    expect(sanitizeLogMeta({ weird: { stack: 'Error: x\n  at y' } }).weird.stack).toBe('Error: x\n  at y');
  });

  it('should serializeError handle non-Error values', () => {
    expect(serializeError(null)).toEqual({});
    expect(serializeError('plain failure')).toEqual({
      errorName: 'Error',
      errorMessage: 'plain failure'
    });
  });

  it('should serializeError include response status from axios errors', () => {
    const err = new Error('api failed');
    err.response = { status: 502 };
    expect(serializeError(err).httpStatus).toBe(502);
  });

  it('should isSecretKey ignore non-string keys', () => {
    expect(isSecretKey(123)).toBe(false);
    expect(isUrlKey(123)).toBe(false);
    expect(sanitizeValue('token', 'secret', 9)).toBe(REDACTED);
    expect(sanitizeValue('safeKey', 'visible', 9)).toBe(REDACTED);
    expect(sanitizeValue('safeKey', 'visible', 0)).toBe('visible');
    expect(sanitizeValue('safeKey', 'visible')).toBe('visible');
    expect(sanitizeValue('count', 42, 0)).toBe(42);
    expect(sanitizeValue('url', 123, 0)).toBe(123);
    expect(sanitizeValue('items', ['a', 'b'], 0)).toEqual(['a', 'b']);
    expect(sanitizeValue('image_url', 'https://example.com/file.png?token=secret', 0)).toBe('https://example.com/file.png');
    expect(sanitizeValue('key', null, 0)).toBeNull();
    expect(sanitizeValue('key', undefined, 0)).toBeUndefined();
    expect(stripUrlQuery('')).toBe('');
    expect(sanitizeLogMeta({ searchUrl: '/api/path' }).searchUrl).toBe('/api/path');
  });
});
