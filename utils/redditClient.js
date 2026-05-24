const path = require('path');
const httpClient = require('./httpClient');
const dayjs = require('dayjs');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_OAUTH_BASE = 'https://www.reddit.com/api/v1';
const USER_AGENT = 'Discord Bot Server Promoter (Node.js)';
const HTTP_TIMEOUT_MS = 10000;

let accessToken = null;
let tokenExpiry = null;
/** @type {Promise<string>|null} */
let tokenRefreshPromise = null;

/**
 * @returns {Promise<string>}
 */
async function getRedditAccessToken() {
  if (accessToken && tokenExpiry && dayjs().valueOf() < tokenExpiry - 300000) {
    return accessToken;
  }

  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    try {
      const auth = Buffer.from(`${config.redditClientId}:${config.redditClientSecret}`).toString('base64');

      const response = await httpClient.post(
        `${REDDIT_OAUTH_BASE}/access_token`,
        new URLSearchParams({
          grant_type: 'password',
          username: config.redditUsername,
          password: config.redditPassword
        }),
        {
          timeout: HTTP_TIMEOUT_MS,
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
          }
        }
      );

      if (response.data?.access_token) {
        accessToken = response.data.access_token;
        tokenExpiry = dayjs().valueOf() + (response.data.expires_in * 1000 || 3600000);
        logger.debug('Successfully obtained Reddit OAuth token.');
        return accessToken;
      }
      throw new Error('No access token in Reddit OAuth response');
    } catch (error) {
      logger.error('Failed to get Reddit OAuth token.', {
        err: error,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error('Failed to authenticate with Reddit API');
    } finally {
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}

/**
 * @param {string} method
 * @param {string} endpoint - path starting with /
 * @param {Record<string, string | number | boolean | undefined> | null} data - form body for POST/PUT
 * @param {boolean} [isRetry]
 * @returns {Promise<object>}
 */
async function redditApiRequest(method, endpoint, data = null, isRetry = false) {
  const token = await getRedditAccessToken();

  const requestConfig = {
    method,
    url: `${REDDIT_API_BASE}${endpoint}`,
    timeout: HTTP_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT
    }
  };

  if (data && (method === 'POST' || method === 'PUT')) {
    requestConfig.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestConfig.data = new URLSearchParams(data).toString();
  }

  try {
    const response = await httpClient(requestConfig);
    return response.data;
  } catch (error) {
    logger.error('Reddit API request failed.', {
      err: error,
      method,
      endpoint,
      status: error.response?.status,
      data: error.response?.data
    });

    if (!isRetry && error.response?.status === 401 && accessToken) {
      logger.debug('Token expired; clearing cache and retrying once.');
      accessToken = null;
      tokenExpiry = null;
      return redditApiRequest(method, endpoint, data, true);
    }

    throw error;
  }
}

function isRedditConfigured() {
  return !!(config.redditClientId && config.redditClientSecret && config.redditUsername && config.redditPassword);
}

module.exports = {
  redditApiRequest,
  isRedditConfigured
};
