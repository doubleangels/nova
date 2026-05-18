const { EmbedBuilder } = require('discord.js');

describe('Search Pagination Integration', () => {
  let createPaginatedResults;
  let mockLogger;
  let mockInteraction;
  let mockCollector;
  let mockMessage;
  let mockEmbedGenerator;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockConfig = {
      newUserBeenInServerBeforeRoleId: 'returning-role',
      noobiesRoleId: 'noobie-role',
      givePermsFrenRoleId: 'fren-role'
    };
    jest.doMock('../../config', () => mockConfig);

    mockCollector = {
      on: jest.fn()
    };

    mockMessage = {
      createMessageComponentCollector: jest.fn().mockReturnValue(mockCollector)
    };

    mockInteraction = {
      user: { id: 'user-123' },
      editReply: jest.fn().mockResolvedValue(mockMessage)
    };

    mockEmbedGenerator = jest.fn((index) => {
      return new EmbedBuilder()
        .setTitle(`Page ${index + 1}`)
        .setDescription(`Content for page ${index + 1}`);
    });

    createPaginatedResults = require('../../utils/searchUtils').createPaginatedResults;
  });

  it('should create paginated results, set up collectors, and transition page embeds upon collector trigger', async () => {
    const items = ['item1', 'item2', 'item3'];
    const prefix = 'myprefix';
    const timeout = 60000;

    // 1. Initiate pagination
    await createPaginatedResults(
      mockInteraction,
      items,
      mockEmbedGenerator,
      prefix,
      timeout,
      mockLogger
    );

    // Verify initial render
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: 'Page 1'
          })
        })]
      })
    );
    expect(mockMessage.createMessageComponentCollector).toHaveBeenCalled();

    // 2. Retrieve the collect callback and simulate a "next" page button click
    const collectCallback = mockCollector.on.mock.calls.find(call => call[0] === 'collect')[1];
    expect(collectCallback).toBeDefined();

    const mockButtonInteraction = {
      customId: 'myprefix_next_user-123_12345',
      user: { id: 'user-123' },
      update: jest.fn().mockResolvedValue()
    };

    await collectCallback(mockButtonInteraction);

    // Verify view updated to page 2
    expect(mockButtonInteraction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: 'Page 2'
          })
        })]
      })
    );

    // 3. Simulate a "prev" page button click
    const mockButtonInteractionPrev = {
      customId: 'myprefix_prev_user-123_12345',
      user: { id: 'user-123' },
      update: jest.fn().mockResolvedValue()
    };

    await collectCallback(mockButtonInteractionPrev);

    // Verify view updated back to page 1
    expect(mockButtonInteractionPrev.update).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: 'Page 1'
          })
        })]
      })
    );

    // 4. Simulate collector end event to verify disabled buttons are set
    const endCallback = mockCollector.on.mock.calls.find(call => call[0] === 'end')[1];
    expect(endCallback).toBeDefined();

    const mockCollected = { size: 2 };
    await endCallback(mockCollected);

    // Verify disabled buttons are rendered on end
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({
          components: [
            expect.objectContaining({
              data: expect.objectContaining({
                disabled: true
              })
            }),
            expect.objectContaining({
              data: expect.objectContaining({
                disabled: true
              })
            })
          ]
        })]
      })
    );
  });
});
