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
    it('should share in-flight token refresh across concurrent requests', async () => {
      let resolveToken;
      const tokenPromise = new Promise((resolve) => {
        resolveToken = resolve;
      });
      mockAxios.post.mockReturnValueOnce(tokenPromise);
      mockAxios.mockResolvedValue({ data: { ok: true } });

      const req1 = redditClient.redditApiRequest('GET', '/api/one');
      const req2 = redditClient.redditApiRequest('GET', '/api/two');

      resolveToken({ data: { access_token: 'shared-token', expires_in: 3600 } });
      await Promise.all([req1, req2]);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

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

    it('should format data for PUT requests', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123', expires_in: 3600 }
      });
      mockAxios.mockResolvedValueOnce({
        data: { success: true }
      });

      await redditClient.redditApiRequest('PUT', '/api/test', { key: 'value' });
      
      expect(mockAxios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded'
        }),
        data: 'key=value'
      }));
    });

    it('should NOT format data for GET requests even if data is provided', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123', expires_in: 3600 }
      });
      mockAxios.mockResolvedValueOnce({
        data: { success: true }
      });

      await redditClient.redditApiRequest('GET', '/api/test', { key: 'value' });
      
      expect(mockAxios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token123'
        })
      }));
      // Verify Content-Type is not present
      const callArg = mockAxios.mock.calls[0][0];
      expect(callArg.headers['Content-Type']).toBeUndefined();
    });

    it('should fallback to default expiry if expires_in is missing in token response', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token123' } // expires_in is missing
      });
      mockAxios.mockResolvedValueOnce({
        data: { success: true }
      });

      await redditClient.redditApiRequest('GET', '/api/test');
      
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
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

    it('should throw error if token fetch response does not contain access token', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {} // no access_token
      });

      await expect(redditClient.redditApiRequest('GET', '/api/test')).rejects.toThrow('Failed to authenticate with Reddit API');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get Reddit OAuth token',
        expect.objectContaining({
          err: expect.any(Error)
        })
      );
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
