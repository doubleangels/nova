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
const { isApiConfigured, getSeasonFixtures, getFixtureById } = require('../utils/footballClient');
const { repromptFootballFixture } = require('../utils/footballScheduler');
const {
  handlePromptSubcommand,
  handlePromptSelect
} = require('../utils/predictionPromptCommand');
const { getCompetitionName } = require('../utils/footballCompetitions');
const {
  isUserRegistered,
  addRegisteredUser,
  getLeaderboard,
  scoreFinishedFixtures,
  formatFixtureLine,
  formatResultPickDisplay,
  getUserPredictionFixtureIds,
  getPredictionsForUser,
  getUserPoints,
  resetFootballGame,
  isFootballGameConfigured,
  setPromptingPaused
} = require('../utils/footballUtils');
const { handlePredictionsSubcommand } = require('../utils/predictionListCommand');
const msgs = require('../utils/predictionMessages');

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('football')
    .setDescription('Predict club match results (Premier League, Bundesliga, La Liga, Champions League).')
    .setDefaultMemberPermissions(null)
    .addSubcommand(sub =>
      sub
        .setName('register')
        .setDescription('Join predictions and receive the participant role.')
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
        .addStringOption(opt =>
          opt
            .setName('competition')
            .setDescription('Filter by competition')
            .addChoices(
              { name: 'Premier League', value: 'PL' },
              { name: 'Bundesliga', value: 'BL1' },
              { name: 'La Liga', value: 'PD' },
              { name: 'Champions League', value: 'CL' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('predictions')
        .setDescription('View predictions and points.')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('User whose predictions to show')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('prompt')
        .setDescription('Re-post a match prediction prompt (administrators).')
        .addStringOption(opt =>
          opt
            .setName('competition')
            .setDescription('Filter by competition')
            .addChoices(
              { name: 'Premier League', value: 'PL' },
              { name: 'Bundesliga', value: 'BL1' },
              { name: 'La Liga', value: 'PD' },
              { name: 'Champions League', value: 'CL' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Clear all club football prediction data (administrators).')
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
        case 'predictions':
          await this.handlePredictions(interaction);
          break;
        case 'prompt':
          await this.handlePrompt(interaction);
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
    const roleId = config.footballParticipantRoleId;
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

    const inFootball = await isUserRegistered(interaction.user.id);
    const hasRole =
      roleId && interaction.member.roles?.cache?.has(roleId);

    if (hasRole && inFootball) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(msgs.GAME.club.embedColor)
            .setTitle(msgs.REGISTER_EMBED_TITLE_ALREADY)
            .setDescription(msgs.buildRegisterAlreadyDescription('club'))
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
            .setColor(msgs.GAME.club.embedColor)
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
            .setColor(msgs.GAME.club.embedColor)
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
            .setColor(msgs.GAME.club.embedColor)
            .setTitle(msgs.REGISTER_EMBED_TITLE_ERROR)
            .setDescription(msgs.ERR_ROLE_HIERARCHY)
        ]
      });
      return;
    }

    await addRegisteredUser(interaction.user.id);
    await interaction.member.roles.add(role, 'Prediction game registration');

    const channelRef = config.footballChannelId
      ? `<#${config.footballChannelId}>`
      : 'the prediction channel';
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(msgs.GAME.club.embedColor)
          .setTitle(msgs.REGISTER_EMBED_TITLE_SUCCESS)
          .setDescription(msgs.buildRegisterSuccessDescription('club', channelRef, role.name))
      ]
    });

    logger.info('/football register completed.', {
      userId: interaction.user.id,
      guildId: interaction.guild.id
    });
  },

  async handleLeaderboard(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: msgs.errNotConfigured('club'),
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
        content: msgs.msgEmptyLeaderboard('club')
      });
      return;
    }

    const lines = board.map((entry, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${entry.userId}> -  **${entry.points}** pts`;
    });

    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.club.embedColor)
      .setTitle(msgs.GAME.club.leaderboardTitle)
      .setDescription(lines.join('\n'))
      .setFooter({ text: msgs.GAME.club.leaderboardFooter });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleRules(interaction) {
    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.club.embedColor)
      .setTitle(msgs.GAME.club.rulesTitle)
      .setDescription(msgs.buildRulesDescription('club'));

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  async handleMatches(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: msgs.errNotConfigured('club'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply();

    const filter = interaction.options.getString('status');
    const competition = interaction.options.getString('competition');
    let fixtures = await getSeasonFixtures(
      competition ? { competition } : {}
    );

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
      .setColor(msgs.GAME.club.embedColor)
      .setTitle(
        competition ? `${getCompetitionName(competition)} Fixtures` : msgs.GAME.club.matchesTitle
      )
      .setDescription(lines.join('\n').slice(0, 4000));

    await interaction.editReply({ embeds: [embed] });
  },

  async handlePredictions(interaction) {
    await handlePredictionsSubcommand(interaction, {
      gameId: 'club',
      paginationPrefix: 'football_predictions',
      logger,
      isApiConfigured,
      getSeasonFixtures,
      getUserPredictionFixtureIds,
      getPredictionsForUser,
      getUserPoints,
      formatFixtureLine,
      formatResultPickDisplay
    });
  },

  async handlePrompt(interaction) {
    const competition = interaction.options.getString('competition');
    await handlePromptSubcommand(interaction, {
      gameId: 'club',
      selectCustomId: 'football:prompt:select',
      isApiConfigured,
      isGameConfigured: isFootballGameConfigured,
      getSeasonFixtures,
      formatFixtureLine,
      competition
    });
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
        content: msgs.errAdminResetOnly('club'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const repost = interaction.options.getBoolean('repost') ?? true;

    await resetFootballGame();

    if (!repost) {
      await setPromptingPaused(true);
    }

    let repostSucceeded = false;
    let repostSkippedConfig = false;
    if (repost) {
      const { isApiConfigured } = require('../utils/footballClient');
      const { runFootballStartup } = require('../utils/footballScheduler');
      if (isApiConfigured() && isFootballGameConfigured()) {
        await runFootballStartup(interaction.client);
        repostSucceeded = true;
      } else {
        repostSkippedConfig = true;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(msgs.GAME.club.embedColor)
      .setTitle(msgs.GAME.club.resetTitle)
      .setDescription(
        msgs.buildResetDescription('club', repost, repostSucceeded, repostSkippedConfig)
      );

    logger.info('Football game reset by administrator.', {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      repost
    });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleError(interaction, error) {
    logger.error('Error in football command.', {
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
      logger.error('Failed to send football error reply.', { err: followUpError });
    }
  },

  async handlePromptSelect(interaction) {
    await handlePromptSelect(interaction, {
      gameId: 'club',
      isApiConfigured,
      isGameConfigured: isFootballGameConfigured,
      getFixtureById,
      formatFixtureLine,
      repromptFixture: repromptFootballFixture,
      logger
    });
  }
};
