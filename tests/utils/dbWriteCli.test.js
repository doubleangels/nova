const {
  parseDbWriteFlags,
  resolveDbWriteMode,
  printDbWriteDryRunHint
} = require('../../utils/dbWriteCli');

describe('dbWriteCli', () => {
  it('should parse commit and force flags', () => {
    expect(parseDbWriteFlags(['--commit', '--force', 'key', 'value'])).toEqual({
      isCommit: true,
      isForce: true,
      positional: ['key', 'value']
    });
  });

  it('should default to dry run mode', () => {
    expect(resolveDbWriteMode({ isCommit: false, isForce: false }, { scriptName: 'set-value.js' }))
      .toEqual({ proceed: false, dryRun: true });
  });

  it('should exit when commit is requested without force', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    resolveDbWriteMode({ isCommit: true, isForce: false }, { scriptName: 'set-value.js' });

    expect(error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);

    exit.mockRestore();
    error.mockRestore();
  });

  it('should allow commit when force is provided', () => {
    expect(resolveDbWriteMode({ isCommit: true, isForce: true }, { scriptName: 'set-value.js' }))
      .toEqual({ proceed: true, dryRun: false });
  });

  it('should print dry-run guidance', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    printDbWriteDryRunHint('remove-value.js');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('--commit --force'));
    log.mockRestore();
  });
});
