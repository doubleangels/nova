const { runWithConcurrency, getBotMember } = require('../../utils/asyncUtils');

describe('asyncUtils', () => {
  it('should return empty array for no tasks', async () => {
    const result = await runWithConcurrency([]);
    expect(result).toEqual([]);
  });

  it('should run all tasks with default concurrency limit', async () => {
    const order = [];
    const tasks = [
      () => Promise.resolve(order.push(1)),
      () => Promise.resolve(order.push(2)),
      () => Promise.resolve(order.push(3))
    ];
    await runWithConcurrency(tasks);
    expect(order).toEqual([1, 2, 3]);
  });

  it('should respect concurrency limit smaller than task count', async () => {
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

  it('should use limit capped to task count when limit exceeds tasks', async () => {
    const results = await runWithConcurrency([() => Promise.resolve('a')], 10);
    expect(results).toEqual(['a']);
  });

  describe('getBotMember', () => {
    it('should return null if interaction is missing guild or members', async () => {
      expect(await getBotMember(null)).toBeNull();
      expect(await getBotMember({})).toBeNull();
      expect(await getBotMember({ guild: {} })).toBeNull();
    });

    it('should return cached me if it exists', async () => {
      const mockMe = { id: 'bot-id' };
      const interaction = {
        guild: {
          members: {
            me: mockMe,
            fetchMe: jest.fn()
          }
        }
      };
      const result = await getBotMember(interaction);
      expect(result).toBe(mockMe);
      expect(interaction.guild.members.fetchMe).not.toHaveBeenCalled();
    });

    it('should call fetchMe if me is null', async () => {
      const mockMe = { id: 'bot-id' };
      const interaction = {
        guild: {
          members: {
            me: null,
            fetchMe: jest.fn().mockResolvedValue(mockMe)
          }
        }
      };
      const result = await getBotMember(interaction);
      expect(result).toBe(mockMe);
      expect(interaction.guild.members.fetchMe).toHaveBeenCalled();
    });
  });
});
