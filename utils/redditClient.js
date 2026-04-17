const path = require('path');
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_OAUTH_BASE = 'https://www.reddit.com/api/v1';
const USER_AGENT = 'Discord Bot Server Promoter (Node.js)';

function envInt(name, def) {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

/** Max entries for GET response cache (oldest keys evicted first). */
const redditGetCacheMaxKeys = envInt('REDDIT_GET_CACHE_MAX_KEYS', 300);

let accessToken = null;
let tokenExpiry = null;
/** @type {Map<string, { expires: number, data: any }>} */
const getResponseCache = new Map();
/** @type {Map<string, Promise<any>>} */
const inflightGetRequests = new Map();

/**
 * @returns {Promise<string>}
 */
async function getRedditAccessToken() {
  if (accessToken && tokenExpiry && dayjs().valueOf() < tokenExpiry - 300000) {
    return accessToken;
  }

  try {
    const auth = Buffer.from(`${config.redditClientId}:${config.redditClientSecret}`).toString('base64');

    const response = await axios.post(
      `${REDDIT_OAUTH_BASE}/access_token`,
      new URLSearchParams({
        grant_type: 'password',
        username: config.redditUsername,
        password: config.redditPassword
      }),
      {
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
      logger.debug('Successfully obtained Reddit OAuth token');
      return accessToken;
    }
    throw new Error('No access token in Reddit OAuth response');
  } catch (error) {
    logger.error('Failed to get Reddit OAuth token', {
      err: error,
      status: error.response?.status,
      data: error.response?.data
    });
    throw new Error('Failed to authenticate with Reddit API');
  }
}

/**
 * @param {string} method
 * @param {string} endpoint - path starting with /
 * @param {Record<string, string | number | boolean | undefined> | null} data - form body for POST/PUT
 * @returns {Promise<object>}
 */
async function redditApiRequest(method, endpoint, data = null, options = {}) {
  const upperMethod = String(method || 'GET').toUpperCase();
  const cacheTtlMs = Number(options.cacheTtlMs || 0);
  const cacheKey = String(options.cacheKey || `${upperMethod}:${endpoint}`);
  if (upperMethod === 'GET' && cacheTtlMs > 0) {
    const now = Date.now();
    const cached = getResponseCache.get(cacheKey);
    if (cached && cached.expires > now) {
      return cached.data;
    }
    const inflight = inflightGetRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }
  }

  const runRequest = async () => {
  const token = await getRedditAccessToken();

  const requestConfig = {
    method: upperMethod,
    url: `${REDDIT_API_BASE}${endpoint}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT
    }
  };

  if (data && (upperMethod === 'POST' || upperMethod === 'PUT')) {
    requestConfig.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestConfig.data = new URLSearchParams(data).toString();
  }

  try {
    const response = await axios(requestConfig);
    const responseData = response.data;
    if (upperMethod === 'GET' && cacheTtlMs > 0) {
      getResponseCache.set(cacheKey, {
        expires: Date.now() + cacheTtlMs,
        data: responseData
      });
      while (getResponseCache.size > redditGetCacheMaxKeys) {
        const oldest = getResponseCache.keys().next().value;
        if (oldest === undefined) break;
        getResponseCache.delete(oldest);
      }
    }
    return responseData;
  } catch (error) {
    logger.error('Reddit API request failed', {
      err: error,
      method: upperMethod,
      endpoint,
      status: error.response?.status,
      data: error.response?.data
    });

    if (error.response?.status === 401 && accessToken) {
      logger.debug('Token expired, clearing cache and retrying');
      accessToken = null;
      tokenExpiry = null;
      return redditApiRequest(upperMethod, endpoint, data, options);
    }

    throw error;
  }
  };

  if (upperMethod !== 'GET' || cacheTtlMs <= 0) {
    return runRequest();
  }
  const promise = runRequest().finally(() => {
    if (inflightGetRequests.get(cacheKey) === promise) {
      inflightGetRequests.delete(cacheKey);
    }
  });
  inflightGetRequests.set(cacheKey, promise);
  return promise;
}

function isRedditConfigured() {
  return !!(config.redditClientId && config.redditClientSecret && config.redditUsername && config.redditPassword);
}

module.exports = {
  redditApiRequest,
  isRedditConfigured
};
