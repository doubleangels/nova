describe('httpClient', () => {
  afterEach(() => {
    jest.resetModules();
    const axios = require('axios');
    delete axios.defaults.timeout;
  });

  it('should set default timeout when not already configured', () => {
    jest.isolateModules(() => {
      const axios = require('axios');
      delete axios.defaults.timeout;
      const httpClient = require('../../utils/httpClient');
      expect(httpClient.defaults.timeout).toBe(10000);
    });
  });

  it('should preserve existing timeout when already set', () => {
    jest.isolateModules(() => {
      const axios = require('axios');
      axios.defaults.timeout = 5000;
      const httpClient = require('../../utils/httpClient');
      expect(httpClient.defaults.timeout).toBe(5000);
    });
  });
});
