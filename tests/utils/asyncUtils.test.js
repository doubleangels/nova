const { runWithConcurrency } = require('../../utils/asyncUtils');

describe('asyncUtils', () => {
  it('returns empty array for no tasks', async () => {
    const result = await runWithConcurrency([]);
    expect(result).toEqual([]);
  });

  it('runs all tasks with default concurrency limit', async () => {
    const order = [];
    const tasks = [
      () => Promise.resolve(order.push(1)),
      () => Promise.resolve(order.push(2)),
      () => Promise.resolve(order.push(3))
    ];
    await runWithConcurrency(tasks);
    expect(order).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit smaller than task count', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 5 }, () => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return true;
    });
    await runWithConcurrency(tasks, 2);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('uses limit capped to task count when limit exceeds tasks', async () => {
    const results = await runWithConcurrency([() => Promise.resolve('a')], 10);
    expect(results).toEqual(['a']);
  });
});
