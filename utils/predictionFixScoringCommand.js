const { AttachmentBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const msgs = require('./predictionMessages');
const { truncateEmbedDescription } = require('./embedUtils');
const {
  parseScoreArg,
  fixFixtureScoringAll,
  resolveNamespacesToProcess,
  detectNamespacesWithPredictions,
  formatMultiNamespaceFixtureScoringReport
} = require('./fixFixtureScoring');

const REPORT_ATTACHMENT_THRESHOLD = 3500;

/**
 * @param {ReturnType<typeof buildFixtureScoringReport>[]} reports
 * @returns {{ totalChanges: number, netDelta: number, anyCommitted: boolean }}
 */
function summarizeReports(reports) {
  const totalChanges = reports.reduce((sum, report) => sum + report.changes.length, 0);
  const netDelta = reports.reduce(
    (sum, report) => sum + report.changes.reduce((inner, change) => inner + change.delta, 0),
    0
  );
  const anyCommitted = reports.some(report => report.committed);
  return { totalChanges, netDelta, anyCommitted };
}

/**
 * @param {number} fixtureId
 * @param {string} fullReport
 * @returns {import('discord.js').AttachmentBuilder|null}
 */
function buildReportAttachment(fixtureId, fullReport) {
  if (fullReport.length <= REPORT_ATTACHMENT_THRESHOLD) {
    return null;
  }

  return new AttachmentBuilder(Buffer.from(fullReport, 'utf8'), {
    name: `fixture-${fixtureId}-scoring-fix.txt`
  });
}

/**
 * @param {{
 *   fixtureId: number,
 *   wrong: string,
 *   correct: string,
 *   namespace?: string,
 *   commit?: boolean,
 *   db: import('better-sqlite3').Database
 * }} params
 * @returns {{
 *   reports: ReturnType<typeof fixFixtureScoringAll>,
 *   namespaces: string[],
 *   namespaceWarning: string|null,
 *   fullReport: string,
 *   wrongActual: { home: number, away: number },
 *   correctActual: { home: number, away: number },
 *   summary: ReturnType<typeof summarizeReports>
 * }}
 */
function runFixtureScoringFix(params) {
  const {
    fixtureId,
    wrong,
    correct,
    namespace: requestedNamespace,
    commit = true,
    db
  } = params;

  const wrongActual = parseScoreArg(wrong);
  const correctActual = parseScoreArg(correct);
  const namespaces = resolveNamespacesToProcess(db, fixtureId, requestedNamespace);

  let namespaceWarning = null;
  if (requestedNamespace) {
    const found = detectNamespacesWithPredictions(db, fixtureId);
    if (!found.includes(requestedNamespace) && found.length > 0) {
      namespaceWarning =
        `Warning: no predictions in "${requestedNamespace}" for fixture ${fixtureId}. ` +
        `Predictions exist in: ${found.join(', ')}. ` +
        'Re-run without namespace to process them automatically.';
    }
  }

  const reports = fixFixtureScoringAll(
    db,
    fixtureId,
    wrongActual,
    correctActual,
    { commit, namespace: requestedNamespace }
  );

  const reportParts = [];
  if (namespaceWarning) {
    reportParts.push(namespaceWarning, '');
  }
  reportParts.push(formatMultiNamespaceFixtureScoringReport(reports));

  return {
    reports,
    namespaces,
    namespaceWarning,
    fullReport: reportParts.join('\n'),
    wrongActual,
    correctActual,
    summary: summarizeReports(reports)
  };
}

/**
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {{
 *   gameId: import('./predictionMessages').PredictionGameId,
 *   isApiConfigured: () => boolean,
 *   getWritableDb: () => import('better-sqlite3').Database,
 *   logger: { info: Function }
 * }} deps
 */
async function handleFixScoringSubcommand(interaction, deps) {
  if (!interaction.guild) {
    await interaction.reply({
      content: msgs.ERR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: msgs.errAdminFixScoringOnly(deps.gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!deps.isApiConfigured()) {
    await interaction.reply({
      content: msgs.errNotConfigured(deps.gameId),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fixtureId = interaction.options.getInteger('fixture', true);
  const wrong = interaction.options.getString('wrong', true).trim();
  const correct = interaction.options.getString('correct', true).trim();
  const requestedNamespace = interaction.options.getString('namespace') || undefined;

  let wrongActual;
  let correctActual;
  try {
    wrongActual = parseScoreArg(wrong);
    correctActual = parseScoreArg(correct);
  } catch (err) {
    await interaction.reply({
      content: `⚠️ ${err.message}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = runFixtureScoringFix({
    fixtureId,
    wrong,
    correct,
    namespace: requestedNamespace,
    commit: true,
    db: deps.getWritableDb()
  });

  const { summary, fullReport, namespaces, namespaceWarning } = result;
  const netSign = summary.netDelta > 0 ? '+' : '';
  const appliedChanges = summary.anyCommitted && summary.totalChanges > 0;

  deps.logger.info('Administrator ran fixture scoring fix.', {
    adminUserId: interaction.user.id,
    guildId: interaction.guild.id,
    fixtureId,
    wrong: `${wrongActual.home}-${wrongActual.away}`,
    correct: `${correctActual.home}-${correctActual.away}`,
    namespace: requestedNamespace || '(auto)',
    totalChanges: summary.totalChanges,
    netDelta: summary.netDelta,
    gameId: deps.gameId,
    report: fullReport
  });

  const embed = new EmbedBuilder()
    .setColor(msgs.GAME[deps.gameId].embedColor)
    .setTitle(appliedChanges ? 'Fixture Scoring Changes Applied' : 'Fix Fixture Scoring')
    .setDescription(
      truncateEmbedDescription(
        msgs.buildFixScoringSummaryDescription({
          fixtureId,
          wrong: `${wrongActual.home}-${wrongActual.away}`,
          correct: `${correctActual.home}-${correctActual.away}`,
          namespaces,
          namespaceWarning,
          totalChanges: summary.totalChanges,
          netDelta: summary.netDelta,
          anyCommitted: summary.anyCommitted,
          reportTruncated: fullReport.length > REPORT_ATTACHMENT_THRESHOLD
        })
      )
    )
    .addFields(
      {
        name: 'Users adjusted',
        value: String(summary.totalChanges),
        inline: true
      },
      {
        name: 'Net points delta',
        value: summary.totalChanges > 0 ? `${netSign}${summary.netDelta}` : '0',
        inline: true
      }
    );

  const attachment = buildReportAttachment(fixtureId, fullReport);
  const payload = { embeds: [embed] };
  if (attachment) {
    payload.files = [attachment];
  }

  if (summary.totalChanges === 0) {
    payload.content = '_No database changes were written._';
  }

  await interaction.editReply(payload);
}

module.exports = {
  REPORT_ATTACHMENT_THRESHOLD,
  summarizeReports,
  buildReportAttachment,
  runFixtureScoringFix,
  handleFixScoringSubcommand
};
