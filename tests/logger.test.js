describe('logger', () => {
  let getLogger;
  let mockChildLogger;

  beforeEach(() => {
    jest.resetModules();
    mockChildLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    jest.doMock('pino', () => {
      const base = {
        child: jest.fn(() => mockChildLogger)
      };
      const pinoFn = () => base;
      pinoFn.stdTimeFunctions = { isoTime: jest.fn() };
      return pinoFn;
    });
    jest.doMock('../config', () => ({ logLevel: 'info' }));
    getLogger = require('../logger');
  });

  it('should use default log level in pino config when logLevel is missing', () => {
    let capturedOptions;
    jest.resetModules();
    jest.doMock('pino', () => {
      const base = { child: jest.fn(() => mockChildLogger) };
      const pinoFn = (options) => {
        capturedOptions = options;
        return base;
      };
      pinoFn.stdTimeFunctions = { isoTime: jest.fn() };
      return pinoFn;
    });
    jest.doMock('../config', () => ({}));
    require('../logger')('test.js');
    expect(capturedOptions.level).toBe('info');
  });

  it('should configure pino level formatter', () => {
    let capturedOptions;
    jest.resetModules();
    jest.doMock('pino', () => {
      const base = { child: jest.fn(() => mockChildLogger) };
      const pinoFn = (options) => {
        capturedOptions = options;
        return base;
      };
      pinoFn.stdTimeFunctions = { isoTime: jest.fn() };
      return pinoFn;
    });
    jest.doMock('../config', () => ({ logLevel: 'info' }));
    require('../logger')('test.js');
    expect(capturedOptions.formatters.level('debug')).toEqual({ level: 'DEBUG' });
  });

  it('should throw for invalid label', () => {
    expect(() => getLogger()).toThrow('Invalid logger label provided.');
    expect(() => getLogger(123)).toThrow('Invalid logger label provided.');
  });

  it('should log message only when no meta object', () => {
    const log = getLogger('test.js');
    log.info('hello');
    log.error('err');
    log.warn('warn');
    log.debug('dbg');
    expect(mockChildLogger.info).toHaveBeenCalledWith('hello');
    expect(mockChildLogger.error).toHaveBeenCalledWith('err');
    expect(mockChildLogger.warn).toHaveBeenCalledWith('warn');
    expect(mockChildLogger.debug).toHaveBeenCalledWith('dbg');
  });

  it('should log with meta object as first arg to pino', () => {
    const log = getLogger('test.js');
    const meta = { userId: '1' };
    log.info('hello', meta);
    log.error('err', meta);
    log.warn('warn', meta);
    log.debug('dbg', meta);
    expect(mockChildLogger.info).toHaveBeenCalledWith(meta, 'hello');
    expect(mockChildLogger.error).toHaveBeenCalledWith(meta, 'err');
  });

  it('should redact secret fields from log metadata', () => {
    const log = getLogger('test.js');
    log.info('hello', { userId: '1', token: 'secret-token' });
    log.warn('warn', { apiKey: 'secret-key' });
    log.debug('dbg', { password: 'secret-password' });
    expect(mockChildLogger.info).toHaveBeenCalledWith(
      { userId: '1', token: '[REDACTED]' },
      'hello'
    );
    expect(mockChildLogger.warn).toHaveBeenCalledWith(
      { apiKey: '[REDACTED]' },
      'warn'
    );
    expect(mockChildLogger.debug).toHaveBeenCalledWith(
      { password: '[REDACTED]' },
      'dbg'
    );
  });

  it('should expose sanitizeLogMeta helper', () => {
    expect(getLogger.sanitizeLogMeta({ token: 'x' })).toEqual({ token: '[REDACTED]' });
  });

  it('should expose raw pino child logger', () => {
    const log = getLogger('test.js');
    expect(log._pino).toBe(mockChildLogger);
  });

  it('should throw when child logger creation fails', () => {
    jest.resetModules();
    jest.doMock('pino', () => {
      const base = {
        child: jest.fn(() => {
          throw new Error('pino fail');
        })
      };
      const pinoFn = () => base;
      pinoFn.stdTimeFunctions = { isoTime: jest.fn() };
      return pinoFn;
    });
    jest.doMock('../config', () => ({ logLevel: 'info' }));
    const getLoggerFail = require('../logger');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => getLoggerFail('test.js')).toThrow('Failed to create logger instance.');
    consoleSpy.mockRestore();
  });
});
