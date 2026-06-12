const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

const mockCreatePaginatedResults = jest.fn();
jest.mock('../../utils/searchUtils', () => ({
  createPaginatedResults: mockCreatePaginatedResults
}));

describe('youtube command', () => {
  let youtubeCommand;
  let mockConfig;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      googleApiKey: 'mock-google-key'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    mockCreatePaginatedResults.mockReset();
    jest.doMock('../../utils/searchUtils', () => ({
      createPaginatedResults: mockCreatePaginatedResults
    }));

    youtubeCommand = require('../../commands/youtube');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should reply with error if validateConfiguration returns false', async () => {
      mockConfig.googleApiKey = null;
      const mockInteraction = createMockInteraction();

      await youtubeCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
    });

    it('should reply with error if no search results are returned', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'query') return 'nonexistentqueryxyz';
            return null;
          })
        }
      });

      jest.spyOn(youtubeCommand, 'searchYouTube').mockResolvedValueOnce([]);

      await youtubeCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No results found for your search.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('No search results found for query.', expect.any(Object));
    });

    it('should successfully search for videos and start paginated results (with all fields present)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'query') return 'tutorial';
            if (name === 'type') return 'video';
            return null;
          })
        }
      });

      const mockVideoResults = [
        {
          id: { videoId: 'vid1' },
          snippet: {
            title: 'JS Tutorial',
            description: 'Learn javascript',
            publishedAt: '2026-05-18T20:00:00Z',
            channelTitle: 'JSChannel',
            channelId: 'chan1',
            thumbnails: {
              high: { url: 'http://img-high.jpg' }
            }
          },
          statistics: {
            viewCount: '1000',
            likeCount: '50'
          }
        }
      ];

      jest.spyOn(youtubeCommand, 'searchYouTube').mockResolvedValueOnce(mockVideoResults);

      await youtubeCommand.execute(mockInteraction);

      expect(mockCreatePaginatedResults).toHaveBeenCalled();
      
      const embedGenerator = mockCreatePaginatedResults.mock.calls[0][2];
      const embed = embedGenerator(0);

      expect(embed.data.title).toBe('📺 JS Tutorial');
      expect(embed.data.url).toBe('https://www.youtube.com/watch?v=vid1');
      expect(embed.data.description).toContain('Learn javascript');
      expect(embed.data.description).toContain('👁️ 1,000 views');
      expect(embed.data.description).toContain('👍 50 likes');
      expect(embed.data.description).toContain('📅 05/18/2026');
      expect(embed.data.image.url).toBe('http://img-high.jpg');
      expect(embed.data.author.name).toBe('JSChannel');
      expect(embed.data.author.url).toBe('https://www.youtube.com/channel/chan1');
    });

    it('should successfully search for channels with medium thumbnail, missing stats and long description', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'query') return 'tutorial';
            if (name === 'type') return 'channel';
            return null;
          })
        }
      });

      const mockChannelResults = [
        {
          id: { channelId: 'chan1' },
          snippet: {
            title: 'JS Channel',
            description: 'a'.repeat(4100),
            thumbnails: {
              medium: { url: 'http://img-med.jpg' }
            }
          },
          statistics: {}
        }
      ];

      jest.spyOn(youtubeCommand, 'searchYouTube').mockResolvedValueOnce(mockChannelResults);

      await youtubeCommand.execute(mockInteraction);

      expect(mockCreatePaginatedResults).toHaveBeenCalled();
      
      const embedGenerator = mockCreatePaginatedResults.mock.calls[0][2];
      const embed = embedGenerator(0);

      expect(embed.data.title).toBe('📺 JS Channel');
      expect(embed.data.url).toBe('https://www.youtube.com/channel/chan1');
      expect(embed.data.description).toContain('…');
      expect(embed.data.thumbnail.url).toBe('http://img-med.jpg');
    });

    it('should successfully search for playlists with default thumbnail, missing contentDetails', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'query') return 'tutorial';
            if (name === 'type') return 'playlist';
            return null;
          })
        }
      });

      const mockPlaylistResults = [
        {
          id: { playlistId: 'play1' },
          snippet: {
            title: 'JS Playlist',
            channelTitle: 'JSChannel',
            channelId: 'chan1',
            thumbnails: {
              default: { url: 'http://img-def.jpg' }
            }
          }
        }
      ];

      jest.spyOn(youtubeCommand, 'searchYouTube').mockResolvedValueOnce(mockPlaylistResults);

      await youtubeCommand.execute(mockInteraction);

      expect(mockCreatePaginatedResults).toHaveBeenCalled();
      
      const embedGenerator = mockCreatePaginatedResults.mock.calls[0][2];
      const embed = embedGenerator(0);

      expect(embed.data.title).toBe('📺 JS Playlist');
      expect(embed.data.url).toBe('https://www.youtube.com/playlist?list=play1');
      expect(embed.data.thumbnail.url).toBe('http://img-def.jpg');
    });

    it('should handle unknown content type in createContentEmbed fallback', () => {
      const item = { snippet: { title: 'Unknown' } };
      const embed = youtubeCommand.createContentEmbed(item, 'unknown', 0, 1);
      expect(embed.data.description).toBe('Unknown content type');
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('tutorial')
        }
      });

      jest.spyOn(youtubeCommand, 'searchYouTube').mockRejectedValueOnce(new Error('YouTube API failed'));

      await youtubeCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in youtube command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching YouTube. Please try again later.'
      }));
    });
  });

  describe('searchYouTube & enrichment', () => {
    it('should return empty array if YouTube API returns no items', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: { items: [] }
      });

      const results = await youtubeCommand.searchYouTube('query', 'video');
      expect(results).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalledWith('YouTube API returned no results.', expect.any(Object));
    });

    it('should return early on empty input for enrichment functions', async () => {
      await expect(youtubeCommand.enrichVideoResults(null)).resolves.toEqual([]);
      await expect(youtubeCommand.enrichVideoResults([])).resolves.toEqual([]);

      await expect(youtubeCommand.enrichChannelResults(null)).resolves.toEqual([]);
      await expect(youtubeCommand.enrichChannelResults([])).resolves.toEqual([]);

      await expect(youtubeCommand.enrichPlaylistResults(null)).resolves.toEqual([]);
      await expect(youtubeCommand.enrichPlaylistResults([])).resolves.toEqual([]);
    });

    it('should successfully search and enrich video results (with detailed statistics)', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { videoId: 'vid1' }, snippet: { title: 'Video 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: 'vid1', statistics: { viewCount: '100' }, contentDetails: { duration: 'PT1M' } }
            ]
          }
        });

      const results = await youtubeCommand.searchYouTube('query', 'video');
      expect(results).toHaveLength(1);
      expect(results[0].statistics).toEqual({ viewCount: '100' });
      expect(results[0].contentDetails).toEqual({ duration: 'PT1M' });
    });

    it('should return search results unenriched if detailedVideos missing or detailedInfo missing', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { videoId: 'vid1' }, snippet: { title: 'Video 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: { items: [] } // detailedVideos is empty
        });

      const results = await youtubeCommand.searchYouTube('query', 'video');
      expect(results).toHaveLength(1);
      expect(results[0].statistics).toBeUndefined();
    });

    it('should return search results unenriched if detailedVideos lookup throws an error', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { videoId: 'vid1' }, snippet: { title: 'Video 1' } }
            ]
          }
        })
        .mockRejectedValueOnce(new Error('Enrichment API fails'));

      const results = await youtubeCommand.searchYouTube('query', 'video');
      expect(results).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to enrich video results.', expect.any(Object));
    });

    it('should successfully search and enrich channel results', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { channelId: 'chan1' }, snippet: { title: 'Channel 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: 'chan1', statistics: { subscriberCount: '500' } }
            ]
          }
        });

      const results = await youtubeCommand.searchYouTube('query', 'channel');
      expect(results).toHaveLength(1);
      expect(results[0].statistics).toEqual({ subscriberCount: '500' });
    });

    it('should return search results unenriched if channel enrichment API fails', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { channelId: 'chan1' }, snippet: { title: 'Channel 1' } }
            ]
          }
        })
        .mockRejectedValueOnce(new Error('Enrichment API fails'));

      const results = await youtubeCommand.searchYouTube('query', 'channel');
      expect(results).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to enrich channel results.', expect.any(Object));
    });

    it('should successfully search and enrich playlist results', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { playlistId: 'play1' }, snippet: { title: 'Playlist 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: 'play1', contentDetails: { itemCount: 10 } }
            ]
          }
        });

      const results = await youtubeCommand.searchYouTube('query', 'playlist');
      expect(results).toHaveLength(1);
      expect(results[0].contentDetails).toEqual({ itemCount: 10 });
    });

    it('should return search results unenriched if playlist enrichment API fails', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { playlistId: 'play1' }, snippet: { title: 'Playlist 1' } }
            ]
          }
        })
        .mockRejectedValueOnce(new Error('Enrichment API fails'));

      const results = await youtubeCommand.searchYouTube('query', 'playlist');
      expect(results).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to enrich playlist results.', expect.any(Object));
    });

    it('should return search results unenriched if enrichment API returns empty response objects', async () => {
      // Test video enrichment empty response
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { videoId: 'vid1' }, snippet: { title: 'Video 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({}); // missing data / items

      const videoResults = await youtubeCommand.searchYouTube('query', 'video');
      expect(videoResults).toHaveLength(1);

      // Test channel enrichment empty response
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { channelId: 'chan1' }, snippet: { title: 'Channel 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({});

      const channelResults = await youtubeCommand.searchYouTube('query', 'channel');
      expect(channelResults).toHaveLength(1);

      // Test playlist enrichment empty response
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { playlistId: 'play1' }, snippet: { title: 'Playlist 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({});

      const playlistResults = await youtubeCommand.searchYouTube('query', 'playlist');
      expect(playlistResults).toHaveLength(1);
    });

    it('should throw error if searchYouTube request itself fails', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Network crash'));
      await expect(youtubeCommand.searchYouTube('query', 'video')).rejects.toThrow('Network crash');
      expect(mockLogger.error).toHaveBeenCalledWith('YouTube API search failed.', expect.any(Object));
    });
  });

  describe('Embed Edge Cases', () => {
    it('should cover long video description, no thumbnails, and empty stats/publishedAt', () => {
      const item = {
        id: { videoId: 'vid1' },
        snippet: {
          title: 'Long Video',
          description: 'a'.repeat(4100),
          thumbnails: {},
          channelTitle: 'DummyChannel',
          channelId: 'chan1'
        }
      };

      const embed = youtubeCommand.createContentEmbed(item, 'video', 0, 1);
      expect(embed.data.title).toBe('📺 Long Video');
      expect(embed.data.description).toContain('…');
      expect(embed.data.image).toBeUndefined();
    });

    it('should cover long playlist description and no thumbnails', () => {
      const item = {
        id: { playlistId: 'play1' },
        snippet: {
          title: 'Long Playlist',
          description: 'a'.repeat(4100),
          thumbnails: {},
          channelTitle: 'DummyChannel',
          channelId: 'chan1'
        }
      };

      const embed = youtubeCommand.createContentEmbed(item, 'playlist', 0, 1);
      expect(embed.data.title).toBe('📺 Long Playlist');
      expect(embed.data.description).toContain('…');
      expect(embed.data.thumbnail).toBeUndefined();
    });

    it('should cover channel with no thumbnails and empty description', () => {
      const item = {
        id: { channelId: 'chan1' },
        snippet: {
          title: 'Empty Channel',
          thumbnails: {}
        }
      };

      const embed = youtubeCommand.createContentEmbed(item, 'channel', 0, 1);
      expect(embed.data.title).toBe('📺 Empty Channel');
      expect(embed.data.description).toContain('No description available');
      expect(embed.data.thumbnail).toBeUndefined();
    });

    it('should cover all remaining edge case branches (falsy description, stats, item counts, and unknown content types)', () => {
      const { EmbedBuilder } = require('discord.js');

      // 1. Falsy description for video embed
      const videoItem = {
        id: { videoId: 'vid1' },
        snippet: {
          title: 'Title',
          thumbnails: {},
          channelTitle: 'Chan',
          channelId: 'chan1'
        }
      };
      const embed1 = youtubeCommand.createVideoEmbed(videoItem, new EmbedBuilder(), 0, 1);
      expect(embed1.data.description).toContain('No description available');

      // 2. Falsy stats/itemCounts for channel/playlist embeds
      const channelItem = {
        id: { channelId: 'chan1' },
        snippet: {
          title: 'Title',
          thumbnails: {}
        },
        statistics: {
          subscriberCount: null,
          videoCount: null
        }
      };
      const embed2 = youtubeCommand.createChannelEmbed(channelItem, new EmbedBuilder(), 0, 1);
      expect(embed2.data.description).toContain('No description available');

      const playlistItem = {
        id: { playlistId: 'play1' },
        snippet: {
          title: 'Title',
          thumbnails: {},
          channelTitle: 'Chan',
          channelId: 'chan1'
        },
        contentDetails: {
          itemCount: null
        }
      };
      const embed3 = youtubeCommand.createPlaylistEmbed(playlistItem, new EmbedBuilder(), 0, 1);
      expect(embed3.data.description).toContain('No description available');

      // 3. searchYouTube with unknown contentType fallback branch
      mockAxios.get.mockResolvedValueOnce({
        data: { items: [{ id: {} }] }
      });
      return youtubeCommand.searchYouTube('query', 'unknown').then(res => {
        expect(res).toHaveLength(1);
      });
    });

    it('should cover unenriched playlist detailedInfo missing branch', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { playlistId: 'play1' }, snippet: { title: 'Playlist 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: 'play-different', contentDetails: { itemCount: 10 } }
            ]
          }
        });

      const results = await youtubeCommand.searchYouTube('query', 'playlist');
      expect(results).toHaveLength(1);
      expect(results[0].contentDetails).toBeUndefined();
    });

    it('should cover truthy statistics for channel and playlist embeds', () => {
      const { EmbedBuilder } = require('discord.js');

      // 1. Channel truthy/falsy combinations
      const channelItem1 = {
        id: { channelId: 'chan1' },
        snippet: { title: 'Chan', thumbnails: {} },
        statistics: { subscriberCount: '1000', videoCount: '50' }
      };
      const embed1 = youtubeCommand.createChannelEmbed(channelItem1, new EmbedBuilder(), 0, 1);
      expect(embed1.data.description).toContain('1,000 subscribers');
      expect(embed1.data.description).toContain('50 videos');

      const channelItem2 = {
        id: { channelId: 'chan1' },
        snippet: { title: 'Chan', thumbnails: {} },
        statistics: { subscriberCount: null, videoCount: '50' }
      };
      const embed2 = youtubeCommand.createChannelEmbed(channelItem2, new EmbedBuilder(), 0, 1);
      expect(embed2.data.description).not.toContain('subscribers');
      expect(embed2.data.description).toContain('50 videos');

      // 2. Playlist truthy itemCount
      const playlistItem = {
        id: { playlistId: 'play1' },
        snippet: { title: 'Play', thumbnails: {}, channelTitle: 'Chan', channelId: 'chan1' },
        contentDetails: { itemCount: 25 }
      };
      const embed3 = youtubeCommand.createPlaylistEmbed(playlistItem, new EmbedBuilder(), 0, 1);
      expect(embed3.data.description).toContain('25 videos');
    });

    it('should cover unenriched channel detailedInfo missing branch', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: { channelId: 'chan1' }, snippet: { title: 'Channel 1' } }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              { id: 'chan-different', statistics: { subscriberCount: '500' } }
            ]
          }
        });

      const results = await youtubeCommand.searchYouTube('query', 'channel');
      expect(results).toHaveLength(1);
      expect(results[0].statistics).toBeUndefined();
    });
  });

  describe('handleError', () => {
    it('should handle all custom error types correctly', async () => {
      const errorCases = [
        {
          error: new Error('API_ERROR'),
          expected: '⚠️ Failed to search YouTube. Please try again later.'
        },
        {
          error: new Error('API_RATE_LIMIT'),
          expected: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
        },
        {
          error: new Error('API_NETWORK_ERROR'),
          expected: '⚠️ Network error occurred. Please check your internet connection.'
        },
        {
          error: new Error('NO_RESULTS'),
          expected: '⚠️ No results found for your search query.'
        },
        {
          error: new Error('INVALID_QUERY'),
          expected: '⚠️ Please provide a valid search query.'
        },
        {
          error: new Error('INVALID_CONTENT_TYPE'),
          expected: '⚠️ Invalid content type specified.'
        },
        {
          error: new Error('INVALID_SORT_METHOD'),
          expected: '⚠️ Invalid sort method specified.'
        },
        {
          error: new Error('INVALID_DURATION'),
          expected: '⚠️ Invalid duration specified.'
        },
        {
          error: new Error('CONFIG_MISSING'),
          expected: '⚠️ This command is not properly configured. Please contact an administrator.'
        },
        {
          error: new Error('SOME_UNEXPECTED_ERROR'),
          expected: '⚠️ An unexpected error occurred while searching YouTube. Please try again later.'
        }
      ];

      for (const errCase of errorCases) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction();

        await youtubeCommand.handleError(mockInteraction, errCase.error);

        expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in youtube command.', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errCase.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await youtubeCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for youtube command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to search YouTube. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(youtubeCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
