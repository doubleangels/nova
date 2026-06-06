const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const path = require('path');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { getBotMember } = require('../utils/asyncUtils');
const { isApiConfigured, getSeasonFixtures } = require('../utils/worldCupClient');
const {
  isUserRegistered,
  addRegisteredUser,
  getLeaderboard,
  scoreFinishedFixtures,
  formatFixtureLine,
  formatResultPickDisplay,
  getPredictionsForUser,
  getUserPredictionFixtureIds,
  getUserPoints,
  resetWorldCupGame,
  isWorldCupGameConfigured,
  setPromptingPaused
} = require('../utils/worldCupUtils');
const msgs = require('../utils/predictionMessages');

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('worldcup')
    .setDescription('Predict FIFA World Cup 2026 match results.')
    .setDefaultMemberPermissions(null)
    .addSubcommand(sub =>
      sub
        .setName('register')
        .setDescription('Join World Cup predictions and receive the participant role.')
    )
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('Show the points leaderboard.')
        .addIntegerOption(opt =>
          opt
            .setName('limit')
            .setDescription('Number of players to show (1-25)')
            .setMinValue(1)
            .setMaxValue(25)
        )
    )
    .addSubcommand(sub =>
      sub.setName('rules').setDescription('How predictions and scoring work.')
    )
    .addSubcommand(sub =>
      sub
        .setName('matches')
        .setDescription('List upcoming, live, or finished matches.')
        .addStringOption(opt =>
          opt
            .setName('status')
            .setDescription('Filter by match status')
            .addChoices(
              { name: 'Upcoming', value: 'upcoming' },
              { name: 'Live', value: 'live' },
              { name: 'Finished', value: 'finished' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('mypicks').setDescription('View your predictions and points per match.')
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Clear all World Cup prediction data (administrators).')
        .addBooleanOption(opt =>
          opt
            .setName('repost')
            .setDescription('Re-post open match prompts after reset')
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'register':
          await this.handleRegister(interaction);
          break;
        case 'leaderboard':
          await this.handleLeaderboard(interaction);
          break;
        case 'rules':
          await this.handleRules(interaction);
          break;
        case 'matches':
          await this.handleMatches(interaction);
          break;
        case 'mypicks':
          await this.handleMyPicks(interaction);
          break;
        case 'reset':
          await this.handleReset(interaction);
          break;
        default:
          await interaction.reply({
            content: msgs.ERR_UNKNOWN_SUBCOMMAND,
            flags: MessageFlags.Ephemeral
          });
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  async handleRegister(interaction) {
    const roleId = config.worldCupParticipantRoleId;
    if (!roleId) {
      await interaction.reply({
        content: msgs.ERR_REGISTER_NOT_CONFIGURED,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: msgs.ERR_GUILD_ONLY,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const inWorldCup = await isUserRegistered(interaction.user.id);
    const hasRole = roleId && interaction.member.roles?.cache?.has(roleId);

    if (hasRole && inWorldCup) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(msgs.GAME.worldcup.embedColor)
            .setTitle(msgs.REGISTER_EMBED_TITLE_ALREADY)
            .setDescription(msgs.buildRegisterAlreadyDescription('worldcup'))
        ]
      });
      return;
    }

    const role = interaction.guild.roles.cache.get(roleId) ||
      await interaction.guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(msgs.GAME.worldcup.embedColor)
            .setTitle(msgs.REGISTER_EMBED_TITLE_ERROR)
            .setDescription(msgs.ERR_PARTICIPANT_ROLE_MISSING)
        ]
      });
      return;
    }

    const me = await getBotMember(interaction);
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(msgs.GAME.worldcup.embedColor)
            .setTitle(msgs.REGISTER_EMBED_TITLE_ERROR)
            .setDescription(msgs.ERR_MANAGE_ROLES_REQUIRED)
        ]
      });
      return;
    }

    if (role.position >= me.roles.highest.position) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(msgs.GAME.worldcup.embedColor)
            .setTitle(msgs.REGISTER_EMBED_TITLE_ERROR)
            .setDescription(msgs.ERR_ROLE_HIERARCHY)
        ]
      });
      return;
    }

    await addRegisteredUser(interaction.user.id);
    await interaction.member.roles.add(role, 'Prediction game registration');

    const channelRef = config.worldCupChannelId
      ? `<#${config.worldCupChannelId}>`
      : 'the prediction channel';
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(msgs.GAME.worldcup.embedColor)
          .setTitle(msgs.REGISTER_EMBED_TITLE_SUCCESS)
          .setDescription(msgs.buildRegisterSuccessDescription('worldcup', channelRef, role.name))
      ]
    });

    logger.info('/worldcup register completed.', {
      userId: interaction.user.id,
      guildId: interaction.guild.id
    });
  },

  async handleLeaderboard(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: msgs.errNotConfigured('worldcup'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply();

    await scoreFinishedFixtures(interaction.client);

    const limit = interaction.options.getInteger('limit') ?? 10;
    const board = await getLeaderboard(limit);

    if (board.length === 0) {
      await interaction.editReply({
        content: msgs.msgEmptyLeaderboard('worldcup')
      });
      return;
    }

    const lines = board.map((entry, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${entry.userId}> -  **${entry.points}** pts`;
    });

    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.worldcup.embedColor)
      .setTitle(msgs.GAME.worldcup.leaderboardTitle)
      .setDescription(lines.join('\n'))
      .setFooter({ text: msgs.GAME.worldcup.leaderboardFooter });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleRules(interaction) {
    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.worldcup.embedColor)
      .setTitle(msgs.GAME.worldcup.rulesTitle)
      .setDescription(msgs.buildRulesDescription('worldcup'));

    await interaction.reply({ embeds: [embed] });
  },

  async handleMatches(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: msgs.errNotConfigured('worldcup'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply();

    const filter = interaction.options.getString('status');
    let fixtures = await getSeasonFixtures();

    if (filter === 'upcoming') {
      fixtures = fixtures.filter(f => ['NS', 'TBD', 'PST'].includes(f.status));
    } else if (filter === 'live') {
      fixtures = fixtures.filter(f => LIVE_STATUSES.has(f.status));
    } else if (filter === 'finished') {
      fixtures = fixtures.filter(f => f.status === 'FT');
    }

    fixtures = fixtures
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
      .slice(0, 15);

    if (fixtures.length === 0) {
      await interaction.editReply({
        content: msgs.MSG_NO_MATCHES_FILTER
      });
      return;
    }

    const lines = fixtures.map(f => `• \`${f.id}\` ${formatFixtureLine(f)}`);
    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.worldcup.embedColor)
      .setTitle(msgs.GAME.worldcup.matchesTitle)
      .setDescription(lines.join('\n').slice(0, 4000));

    await interaction.editReply({ embeds: [embed] });
  },

  async handleMyPicks(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: msgs.errNotConfigured('worldcup'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const fixtures = await getSeasonFixtures();
    const fixtureMap = new Map(fixtures.map(f => [f.id, f]));

    const fixtureIds = await getUserPredictionFixtureIds(interaction.user.id);

    if (fixtureIds.length === 0) {
      await interaction.editReply({
        content: msgs.MSG_NO_PREDICTIONS
      });
      return;
    }

    const predictionEntries = await getPredictionsForUser(
      interaction.user.id,
      fixtureIds
    );

    const lines = [];
    for (const { fixtureId, prediction } of predictionEntries) {
      if (!prediction) {
        lines.push(`• Match \`${fixtureId}\`: ${msgs.MSG_MISSING_PREDICTION}`);
        continue;
      }
      const fixture = fixtureMap.get(fixtureId);
      const label = fixture
        ? formatFixtureLine(fixture)
        : `Match \`${fixtureId}\``;
      const resultLabel = fixture
        ? formatResultPickDisplay(fixture, prediction.resultPick)
        : prediction.resultPick;
      const pick = msgs.formatMyPickLine(
        prediction.homeScore,
        prediction.awayScore,
        resultLabel,
        prediction.scored,
        prediction.pointsAwarded
      );
      lines.push(`• ${label}: ${pick}`);
    }

    const total = await getUserPoints(interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.worldcup.embedColor)
      .setTitle(msgs.GAME.worldcup.myPicksTitle)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: `Total points: ${total}` });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleReset(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: msgs.ERR_GUILD_ONLY,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: msgs.errAdminResetOnly('worldcup'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const repost = interaction.options.getBoolean('repost') ?? true;

    await resetWorldCupGame();

    if (!repost) {
      await setPromptingPaused(true);
    }

    let repostSucceeded = false;
    let repostSkippedConfig = false;
    if (repost) {
      const { isApiConfigured } = require('../utils/worldCupClient');
      const { runWorldCupStartup } = require('../utils/worldCupScheduler');
      if (isApiConfigured() && isWorldCupGameConfigured()) {
        await runWorldCupStartup(interaction.client);
        repostSucceeded = true;
      } else {
        repostSkippedConfig = true;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.worldcup.embedColor)
      .setTitle(msgs.GAME.worldcup.resetTitle)
      .setDescription(
        msgs.buildResetDescription('worldcup', repost, repostSucceeded, repostSkippedConfig)
      );

    logger.info('World Cup game reset by administrator.', {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      repost
    });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleError(interaction, error) {
    logger.error('Error in worldcup command.', {
      err: error,
      userId: interaction.user?.id,
      subcommand: interaction.options?.getSubcommand?.()
    });

    const message = msgs.ERR_UNEXPECTED;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    } catch (followUpError) {
      logger.error('Failed to send worldcup error reply.', { err: followUpError });
    }
  }
};
