const {
  isGuildOwner,
  canBotManageRole,
  canInvokerManageRole,
  canInvokerModerateMember,
  canBotManageRolePosition,
  canInvokerManageRolePosition,
  validateExistingRoleChange
} = require('../../utils/roleHierarchyUtils');

function mockGuild(ownerId = 'owner-1') {
  return { id: 'guild-1', ownerId };
}

function mockMember({ id = 'mem-1', highestPosition = 5, guildOwner = false } = {}) {
  const guild = mockGuild(guildOwner ? id : 'owner-1');
  return {
    id,
    roles: { highest: { position: highestPosition } },
    guild
  };
}

function mockRole({ position = 3, managed = false } = {}) {
  return { position, managed };
}

describe('roleHierarchyUtils', () => {
  describe('isGuildOwner', () => {
    it('should return true when member is guild owner', () => {
      const guild = mockGuild('owner-1');
      expect(isGuildOwner({ id: 'owner-1' }, guild)).toBe(true);
    });

    it('should return false for non-owner members', () => {
      const guild = mockGuild('owner-1');
      expect(isGuildOwner({ id: 'other' }, guild)).toBe(false);
    });
  });

  describe('canBotManageRole', () => {
    it('should reject missing inputs', () => {
      expect(canBotManageRole(null, mockRole())).toBe(false);
      expect(canBotManageRole(mockMember({ highestPosition: 10 }), null)).toBe(false);
    });

    it('should reject managed roles', () => {
      const bot = mockMember({ highestPosition: 10 });
      expect(canBotManageRole(bot, mockRole({ position: 5, managed: true }))).toBe(false);
    });

    it('should require bot highest role above target role', () => {
      const bot = mockMember({ highestPosition: 5 });
      expect(canBotManageRole(bot, mockRole({ position: 5 }))).toBe(false);
      expect(canBotManageRole(bot, mockRole({ position: 3 }))).toBe(true);
    });
  });

  describe('canInvokerManageRole', () => {
    it('should reject missing inputs', () => {
      expect(canInvokerManageRole(null, mockRole(), mockGuild())).toBe(false);
    });

    it('should allow guild owner bypass', () => {
      const invoker = mockMember({ id: 'owner-1', highestPosition: 1, guildOwner: true });
      const guild = mockGuild('owner-1');
      expect(canInvokerManageRole(invoker, mockRole({ position: 99 }), guild)).toBe(true);
    });

    it('should require invoker highest role above target role', () => {
      const guild = mockGuild();
      const invoker = mockMember({ highestPosition: 4 });
      expect(canInvokerManageRole(invoker, mockRole({ position: 4 }), guild)).toBe(false);
      expect(canInvokerManageRole(invoker, mockRole({ position: 3 }), guild)).toBe(true);
    });
  });

  describe('canInvokerModerateMember', () => {
    it('should reject missing inputs', () => {
      expect(canInvokerModerateMember(null, { roles: { highest: { position: 1 } } }, mockGuild())).toBe(false);
    });

    it('should block moderating the guild owner', () => {
      const guild = mockGuild('owner-1');
      const invoker = mockMember({ highestPosition: 99 });
      const target = {
        id: 'owner-1',
        roles: { highest: { position: 1 } }
      };
      expect(canInvokerModerateMember(invoker, target, guild)).toBe(false);
    });

    it('should allow owner to moderate non-owner members', () => {
      const guild = mockGuild('owner-1');
      const invoker = mockMember({ id: 'owner-1', highestPosition: 1, guildOwner: true });
      const target = {
        id: 'target',
        roles: { highest: { position: 50 } }
      };
      expect(canInvokerModerateMember(invoker, target, guild)).toBe(true);
    });

    it('should require invoker role above target highest role', () => {
      const guild = mockGuild();
      const invoker = mockMember({ highestPosition: 5 });
      const target = {
        id: 'target',
        roles: { highest: { position: 5 } }
      };
      expect(canInvokerModerateMember(invoker, target, guild)).toBe(false);
      expect(canInvokerModerateMember(invoker, { ...target, roles: { highest: { position: 4 } } }, guild)).toBe(true);
    });

    it('should not treat missing member ids as guild owner', () => {
      const guild = {};
      const invoker = mockMember({ highestPosition: 10 });
      const target = {
        roles: { highest: { position: 5 } }
      };
      expect(canInvokerModerateMember(invoker, target, guild)).toBe(true);
    });
  });

  describe('canBotManageRolePosition', () => {
    it('should require bot highest above requested position', () => {
      const bot = mockMember({ highestPosition: 8 });
      expect(canBotManageRolePosition(bot, 8)).toBe(false);
      expect(canBotManageRolePosition(bot, 7)).toBe(true);
    });
  });

  describe('canInvokerManageRolePosition', () => {
    it('should allow guild owner bypass', () => {
      const guild = mockGuild('owner-1');
      const invoker = mockMember({ id: 'owner-1', highestPosition: 1, guildOwner: true });
      expect(canInvokerManageRolePosition(invoker, 99, guild)).toBe(true);
    });

    it('should reject invalid role position inputs', () => {
      const guild = mockGuild();
      const invoker = mockMember({ highestPosition: 10 });
      expect(canInvokerManageRolePosition(invoker, NaN, guild)).toBe(false);
      expect(canInvokerManageRolePosition(null, 5, guild)).toBe(false);
      expect(canBotManageRolePosition(mockMember({ highestPosition: 10 }), NaN)).toBe(false);
    });

    it('should require invoker role position above requested role position', () => {
      const guild = mockGuild();
      const invoker = mockMember({ highestPosition: 5 });
      expect(canInvokerManageRolePosition(invoker, 5, guild)).toBe(false);
      expect(canInvokerManageRolePosition(invoker, 4, guild)).toBe(true);
    });
  });

  describe('validateExistingRoleChange', () => {
    const guild = mockGuild();

    it('should reject managed roles', () => {
      const result = validateExistingRoleChange({
        botMember: mockMember({ highestPosition: 10 }),
        invokerMember: mockMember({ highestPosition: 10 }),
        role: mockRole({ managed: true }),
        guild
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('integration');
    });

    it('should reject when bot cannot manage role', () => {
      const result = validateExistingRoleChange({
        botMember: mockMember({ highestPosition: 2 }),
        invokerMember: mockMember({ highestPosition: 10 }),
        role: mockRole({ position: 5 }),
        guild
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("I don't");
    });

    it('should reject when invoker cannot manage role', () => {
      const result = validateExistingRoleChange({
        botMember: mockMember({ highestPosition: 10 }),
        invokerMember: mockMember({ highestPosition: 2 }),
        role: mockRole({ position: 5 }),
        guild
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('You cannot manage');
    });

    it('should reject when invoker cannot moderate target member', () => {
      const result = validateExistingRoleChange({
        botMember: mockMember({ highestPosition: 10 }),
        invokerMember: mockMember({ highestPosition: 5 }),
        role: mockRole({ position: 3 }),
        targetMember: {
          id: 'target',
          roles: { highest: { position: 6 } }
        },
        guild
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('cannot manage this member');
    });

    it('should succeed when all checks pass', () => {
      const result = validateExistingRoleChange({
        botMember: mockMember({ highestPosition: 10 }),
        invokerMember: mockMember({ highestPosition: 8 }),
        role: mockRole({ position: 5 }),
        targetMember: {
          id: 'target',
          roles: { highest: { position: 4 } }
        },
        guild
      });
      expect(result).toEqual({ ok: true });
    });
  });
});
