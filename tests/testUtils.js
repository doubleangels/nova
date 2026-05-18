const { Collection, PermissionFlagsBits } = require('discord.js');

function createMockInteraction(overrides = {}) {
  return {
    id: 'int-123',
    user: { id: 'user-123', username: 'test', tag: 'test#0001' },
    guild: createMockGuild({ ownerId: 'owner-123' }),
    member: createMockMember(),
    channel: { id: 'ch-123', name: 'test', send: jest.fn() },
    commandName: 'test',
    replied: false,
    deferred: false,
    options: {
      getString: jest.fn(() => ''),
      getUser: jest.fn(),
      getRole: jest.fn(),
      getInteger: jest.fn(() => 0),
      getBoolean: jest.fn(() => false),
    },
    reply: jest.fn().mockResolvedValue({}),
    deferReply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    isCommand: jest.fn(() => true),
    isButton: jest.fn(() => false),
    ...overrides,
  };
}

function createMockMember(overrides = {}) {
  return {
    id: 'mem-123',
    user: { id: 'user-123', username: 'test_user', tag: 'test_user#0001', bot: false },
    roles: {
      cache: new Collection(),
      add: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
      highest: createMockRole({ position: 1 }),
    },
    permissions: {
      has: jest.fn(() => false),
    },
    voice: { setMute: jest.fn().mockResolvedValue(true) },
    timeout: jest.fn().mockResolvedValue(true),
    send: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

function createMockRole(overrides = {}) {
  return {
    id: 'role-123',
    name: 'test_role',
    position: 1,
    comparePositionTo: jest.fn(() => 0),
    ...overrides
  };
}

function createMockGuild(overrides = {}) {
  return {
    id: 'guild-123',
    name: 'Test Guild',
    members: {
      fetch: jest.fn(),
      cache: new Collection(),
    },
    roles: {
      cache: new Collection(),
      fetch: jest.fn(),
    },
    channels: {
      cache: new Collection(),
      fetch: jest.fn(),
    },
    ...overrides
  };
}

function createMockMessage(overrides = {}) {
  return {
    id: 'msg-123',
    content: 'test message',
    author: { id: 'user-123', username: 'test_user', bot: false },
    member: createMockMember(),
    guild: createMockGuild(),
    channel: { id: 'ch-123', send: jest.fn().mockResolvedValue(true) },
    react: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true),
    reply: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

function createMockButton(overrides = {}) {
  return {
    customId: 'btn-123',
    user: { id: 'user-123' },
    message: createMockMessage(),
    reply: jest.fn().mockResolvedValue(true),
    deferUpdate: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
    isButton: jest.fn(() => true),
    ...overrides
  };
}

module.exports = { 
  createMockInteraction,
  createMockMember,
  createMockRole,
  createMockGuild,
  createMockMessage,
  createMockButton
};