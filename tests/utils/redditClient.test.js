const dayjs = require('dayjs');

describe('redditClient', () => {
  let redditClient;
  let mockAxios;
  let mockLogger;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();
    
    mockConfig = {
      redditClientId: 'client123',
      redditClientSecret: 'secret123',
      redditUsername: 'user123',
      redditPassword: 'password123'
    };
    jest.doMock('../../config', () => mockConfig);

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockAxios = jest.fn();
    mockAxios.post = jest.fn();
    jest.doMock('axios', () => mockAxios);

    redditClient = require('../../utils/redditClient');
  });

  describe('isRedditConfigured', () => {
    it('should return true if all config is present', () => {
      expect(redditClient.isRedditConfigured()).toBe(true);
    });

    it('should return false if any config is missing', () => {
      mockConfig.redditClientId = null;
      expect(redditClient.isRedditConfigured()).toBe(false);
    });
  });

  describe('redditApiRequest', () => {
    it('should fetch access token and make request', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123', expires_in: 3600 }
      });
      mockAxios.mockResolvedValueOnce({
        data: { success: true }
      });

      const result = await redditClient.redditApiRequest('GET', '/api/test');
      
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      expect(mockAxios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'GET',
        url: 'https://oauth.reddit.com/api/test',
        headers: expect.objectContaining({
          Authorization: 'Bearer token123'
        })
      }));
      expect(result).toEqual({ success: true });
    });

    it('should reuse unexpired token', async () => {
      // First call fetches token
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123', expires_in: 3600 }
      });
      mockAxios.mockResolvedValue({
        data: { success: true }
      });

      await redditClient.redditApiRequest('GET', '/api/test1');
      await redditClient.redditApiRequest('GET', '/api/test2');

      expect(mockAxios.post).toHaveBeenCalledTimes(1); // token reused
      expect(mockAxios).toHaveBeenCalledTimes(2);
    });

    it('should format data for POST requests', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123', expires_in: 3600 }
      });
      mockAxios.mockResolvedValueOnce({
        data: { success: true }
      });

      await redditClient.redditApiRequest('POST', '/api/test', { key: 'value' });
      
      expect(mockAxios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded'
        }),
        data: 'key=value'
      }));
    });

    it('should retry on 401 error', async () => {
      mockAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'old_token', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: { access_token: 'new_token', expires_in: 3600 } });
        
      mockAxios
        .mockRejectedValueOnce({ response: { status: 401 } }) // First request fails
        .mockResolvedValueOnce({ data: { success: true } }); // Retry succeeds

      // To test the retry, we first need to seed the token cache, OR just let the first request fail
      // Wait, if we just call it once, it fetches a token, makes request, gets 401, clears token, fetches token again, retries.
      const result = await redditClient.redditApiRequest('GET', '/api/test');

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(mockAxios).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should throw error if token fetch fails', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Network error'));
      
      await expect(redditClient.redditApiRequest('GET', '/api/test')).rejects.toThrow('Failed to authenticate with Reddit API');
    });

    it('should throw error if request fails with non-401', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123', expires_in: 3600 }
      });
      mockAxios.mockRejectedValueOnce({ response: { status: 500 } });
      
      await expect(redditClient.redditApiRequest('GET', '/api/test')).rejects.toEqual({ response: { status: 500 } });
    });
  });
});
