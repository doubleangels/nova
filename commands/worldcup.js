const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const path = require('path');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));
const { isApiConfigured, getSeasonFixtures } = require('../utils/worldCupClient');
const {
  isUserRegistered,
  addRegisteredUser,
  getLeaderboard,
  scoreFinishedFixtures,
  formatFixtureLine,
  getPrediction,
  getUserPredictionFixtureIds,
  getUserPoints
} = require('../utils/worldCupUtils');

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('worldcup')
    .setDescription('FIFA World Cup 2026 prediction game.')
    .setDefaultMemberPermissions(null)
    .addSubcommand(sub =>
      sub.setName('register').setDescription('Join the World Cup prediction game and get the participant role.')
    )
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('See who has the most prediction points.')
        .addIntegerOption(opt =>
          opt
            .setName('limit')
            .setDescription('How many players to show (1–25)')
            .setMinValue(1)
            .setMaxValue(25)
        )
    )
    .addSubcommand(sub =>
      sub.setName('rules').setDescription('How scoring and predictions work.')
    )
    .addSubcommand(sub =>
      sub
        .setName('matches')
        .setDescription('List World Cup fixtures.')
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
      sub.setName('mypicks').setDescription('View your predictions and points earned per match.')
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
        default:
          await interaction.reply({
            content: '⚠️ Unknown subcommand.',
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
        content: '⚠️ World Cup registration is not configured yet (`WORLD_CUP_PARTICIPANT_ROLE_ID`).',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: '⚠️ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const already = await isUserRegistered(interaction.user.id);
    if (already) {
      await interaction.editReply({
        content: 'You are already registered for World Cup predictions.'
      });
      return;
    }

    const role = interaction.guild.roles.cache.get(roleId) ||
      await interaction.guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      await interaction.editReply({
        content: '⚠️ The participant role could not be found. Check `WORLD_CUP_PARTICIPANT_ROLE_ID`.'
      });
      return;
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply({
        content: '⚠️ I need the **Manage Roles** permission to assign the participant role.'
      });
      return;
    }

    if (role.position >= me.roles.highest.position) {
      await interaction.editReply({
        content: '⚠️ My highest role must be above the World Cup participant role.'
      });
      return;
    }

    await interaction.member.roles.add(role, 'World Cup prediction game registration');
    await addRegisteredUser(interaction.user.id);

    await interaction.editReply({
      content: `You are registered for World Cup predictions. Role **${role.name}** assigned. Watch <#${config.worldCupChannelId || 'the World Cup channel'}> for match prompts.`
    });

    logger.info('/worldcup register completed.', {
      userId: interaction.user.id,
      guildId: interaction.guild.id
    });
  },

  async handleLeaderboard(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: '⚠️ World Cup predictions are not configured (missing `FOOTBALL_DATA_API_KEY`).',
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
        content: 'No one is on the leaderboard yet. Run `/worldcup register` to join.'
      });
      return;
    }

    const lines = board.map((entry, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${entry.userId}> — **${entry.points}** pts`;
    });

    const embed = new EmbedBuilder()
      .setColor(config.baseEmbedColor)
      .setTitle('World Cup prediction leaderboard')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'FIFA World Cup 2026' });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleRules(interaction) {
    const embed = new EmbedBuilder()
      .setColor(config.baseEmbedColor)
      .setTitle('World Cup prediction rules')
      .setDescription(
        '**Register** with `/worldcup register` to get the participant role.\n\n' +
        '**Before each match** you will get a channel post and DM with a button. Open the modal and submit:\n' +
        '• Home and away goals (0–15)\n' +
        '• Result pick: `home`, `draw`, or `away`\n\n' +
        'Both score and result are required. Predictions lock at kickoff.\n\n' +
        '**Scoring (per match)**\n' +
        '• Exact score: **3** points\n' +
        '• Correct outcome from your predicted score: **1** point\n' +
        '• Correct separate result pick: **1** point\n' +
        '(Maximum **4** points per match)\n\n' +
        'After full-time, results and points are posted in the World Cup channel. Use `/worldcup leaderboard` anytime.'
      );

    await interaction.reply({ embeds: [embed] });
  },

  async handleMatches(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: '⚠️ World Cup predictions are not configured (missing `FOOTBALL_DATA_API_KEY`).',
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
        content: 'No matches found for this filter. The schedule may not be published yet.'
      });
      return;
    }

    const lines = fixtures.map(f => `• \`${f.id}\` ${formatFixtureLine(f)}`);
    const embed = new EmbedBuilder()
      .setColor(config.baseEmbedColor)
      .setTitle('World Cup fixtures')
      .setDescription(lines.join('\n').slice(0, 4000));

    await interaction.editReply({ embeds: [embed] });
  },

  async handleMyPicks(interaction) {
    if (!isApiConfigured()) {
      await interaction.reply({
        content: '⚠️ World Cup predictions are not configured (missing `FOOTBALL_DATA_API_KEY`).',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await scoreFinishedFixtures(interaction.client);

    const fixtures = await getSeasonFixtures();
    const fixtureMap = new Map(fixtures.map(f => [f.id, f]));

    const fixtureIds = await getUserPredictionFixtureIds(interaction.user.id);

    if (fixtureIds.length === 0) {
      await interaction.editReply({
        content: 'You have no predictions yet. Use the button on match prompts when they appear.'
      });
      return;
    }

    const lines = [];
    for (const fixtureId of fixtureIds) {
      const prediction = await getPrediction(interaction.user.id, fixtureId);
      const fixture = fixtureMap.get(fixtureId);
      const label = fixture
        ? formatFixtureLine(fixture)
        : `Match \`${fixtureId}\``;
      const pick = `Score **${prediction.homeScore}–${prediction.awayScore}**, pick **${prediction.resultPick}**`;
      const pts = prediction.scored
        ? ` — **+${prediction.pointsAwarded ?? 0}** pts`
        : ' — pending';
      lines.push(`• ${label}: ${pick}${pts}`);
    }

    const total = await getUserPoints(interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(config.baseEmbedColor)
      .setTitle('Your World Cup picks')
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: `Total points: ${total}` });

    await interaction.editReply({ embeds: [embed] });
  },

  async handleError(interaction, error) {
    logger.error('Error in worldcup command.', {
      err: error,
      userId: interaction.user?.id,
      subcommand: interaction.options?.getSubcommand?.()
    });

    const message = '⚠️ An unexpected error occurred. Please try again later.';
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
