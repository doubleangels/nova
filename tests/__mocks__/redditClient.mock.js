module.exports = {
  redditApiRequest: jest.fn(),
  isRedditConfigured: jest.fn(() => true),
  authenticateReddit: jest.fn(),
  getRedditToken: jest.fn(),
};