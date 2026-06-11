/**
 * Shared user-facing copy for World Cup and club football prediction games.
 * Keep tone direct, friendly, and consistent across commands, embeds, and interactions.
 */

/** @typedef {'worldcup' | 'club'} PredictionGameId */

/** @type {Record<PredictionGameId, { label: string, embedColor: number, registerCommand: string, leaderboardCommand: string, rulesCommand: string, predictionsTitleSelf: string, predictionsTitleAll: string, resetTitle: string, leaderboardTitle: string, rulesTitle: string, matchesTitle: string, leaderboardFooter: string }> */
const GAME = {
  worldcup: {
    label: 'World Cup',
    embedColor: 0xEB9D57,
    registerCommand: '/worldcup register',
    leaderboardCommand: '/worldcup leaderboard',
    rulesCommand: '/worldcup rules',
    predictionsTitleSelf: 'Your World Cup Predictions',
    predictionsTitleAll: 'World Cup Predictions',
    resetTitle: 'World Cup Predictions Reset',
    leaderboardTitle: 'World Cup Leaderboard',
    rulesTitle: 'World Cup - How It Works',
    matchesTitle: 'World Cup Fixtures',
    leaderboardFooter: 'FIFA World Cup 2026'
  },
  club: {
    label: 'Club football',
    embedColor: 0xB0F246,
    registerCommand: '/football register',
    leaderboardCommand: '/football leaderboard',
    rulesCommand: '/football rules',
    predictionsTitleSelf: 'Your Club Football Predictions',
    predictionsTitleAll: 'Club Football Predictions',
    resetTitle: 'Club Football Predictions Reset',
    leaderboardTitle: 'Club Football Leaderboard',
    rulesTitle: 'Club Football - How It Works',
    matchesTitle: 'Club Football Fixtures',
    leaderboardFooter: 'Premier League · Bundesliga · La Liga · Champions League'
  }
};
const SUBMIT_BUTTON_LABEL = 'Submit Prediction';
const AI_PICK_FIELD_NAME = 'AI Prediction:';
/** Max characters for Gemini reasoning (fits Discord embed field with score line). */
const AI_REASONING_MAX_LENGTH = 120;
/** Max characters for the full AI pick embed field value. */
const AI_FIELD_MAX_LENGTH = 400;

/**
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateForEmbed(text, maxLength) {
  const s = String(text || '').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, Math.max(0, maxLength - 1))}…`;
}
const ROLE_PING =
  '<@&{roleId}> A new match is open for predictions - submit yours before kickoff.';

const ERR_UNKNOWN_SUBCOMMAND = '⚠️ Unknown subcommand.';
const ERR_UNEXPECTED = '⚠️ Something went wrong. Please try again in a moment.';
const ERR_GUILD_ONLY = '⚠️ This command only works in a server.';
const ERR_INVALID_MATCH = '⚠️ That match link is invalid.';
const ERR_USE_IN_SERVER = '⚠️ Use this button in a server.';
const ERR_MATCH_LOAD = '⚠️ Could not load this match. Try again in a moment.';
const ERR_PREDICTIONS_CLOSED =
  '⚠️ Predictions are closed for this match (it has started or finished).';
const ERR_PREDICTIONS_CLOSED_SHORT = '⚠️ Predictions are closed for this match.';
const ERR_ALREADY_PREDICTED = '⚠️ You already submitted a prediction for this match.';
const ERR_GOALS_RANGE = '⚠️ Goals must be a whole number from 0 to 15.';
const ERR_INVALID_WINNER = '⚠️ Invalid winner selection.';
const NOTE_WINNER_REALIGNED =
  '_Your winner pick was adjusted to match your scoreline._';
/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function errRegisterFirst(gameId) {
  return `⚠️ Run ${GAME[gameId].registerCommand} first to join predictions.`;
}
const ERR_REGISTER_NOT_CONFIGURED =
  '⚠️ Registration is not set up. Set `FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID`.';
const ERR_PARTICIPANT_ROLE_MISSING =
  '⚠️ The participant role was not found. Check `FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID`.';
const ERR_MANAGE_ROLES_REQUIRED =
  '⚠️ I need the **Manage Roles** permission to assign the participant role.';
const ERR_ROLE_HIERARCHY =
  '⚠️ My highest role must be above the participant role in the role list.';

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function msgEmptyLeaderboard(gameId) {
  return `The leaderboard is empty. Run ${GAME[gameId].registerCommand} to join.`;
}
const MSG_NO_MATCHES_FILTER =
  'No matches match that filter. The schedule may not be published yet.';
const MSG_NO_PREDICTIONS =
  'You have not submitted any predictions yet. Use **Submit Prediction** on match posts in the prediction channel.';

/**
 * @param {string} displayName
 * @returns {string}
 */
function msgNoPredictionsForUser(displayName) {
  return `${displayName} has not submitted any predictions yet.`;
}

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function msgNoPredictionsAnywhere(gameId) {
  return `No one has submitted ${GAME[gameId].label.toLowerCase()} predictions yet.`;
}

/**
 * @param {string} displayName
 * @returns {string}
 */
function predictionsTitleOther(displayName) {
  return `${displayName}'s Predictions`;
}
const MSG_MISSING_PREDICTION =
  'prediction data missing (try again or contact an admin)';
/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function msgAlreadyRegistered(gameId) {
  return `You are already registered for the ${GAME[gameId].label} predictions game.`;
}

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function msgRegisterSuccess(gameId) {
  return `You are registered for the ${GAME[gameId].label} predictions game. Watch {channel} for match posts and submit your predictions.`;
}
const REGISTER_EMBED_TITLE_SUCCESS = 'Registered for Predictions!';
const REGISTER_EMBED_TITLE_ALREADY = 'Already Registered!';
const REGISTER_EMBED_TITLE_ERROR = 'Could Not Register!';

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function errNotConfigured(gameId) {
  const game = GAME[gameId].label;
  return (
    `⚠️ ${game} predictions are not set up. Set \`FOOTBALL_DATA_API_KEY\` or ` +
    '`FOOTBALL_PREDICTION_MOCK_API=true`.'
  );
}

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function errAdminResetOnly(gameId) {
  return `⚠️ Only administrators can reset ${GAME[gameId].label.toLowerCase()} predictions.`;
}

/**
 * @param {string} roleId
 * @returns {string}
 */
function buildRolePing(roleId) {
  return ROLE_PING.replace('{roleId}', roleId);
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture | import('./footballUtils').NormalizedFixture} fixture
 * @param {(fixture: unknown, side: 'home'|'away') => string} formatTeam
 * @returns {string}
 */
function buildPromptDescription(fixture, formatTeam) {
  const home = formatTeam(fixture, 'home');
  const away = formatTeam(fixture, 'away');
  return (
    `Tap **${SUBMIT_BUTTON_LABEL}**, then choose goals for **${home}** and **${away}** ` +
    'and pick the winner. You can fill the menus in any order. Predictions lock at kickoff.'
  );
}

const PROMPT_FOOTER = `Tap ${SUBMIT_BUTTON_LABEL} below to open the form.`;

/**
 * @param {PredictionGameId} gameId
 * @param {string} [competitionLabel] Club only - e.g. "Premier League"
 * @returns {string}
 */
function buildPromptTitle(gameId, competitionLabel) {
  if (gameId === 'worldcup') return 'World Cup - Match Open';
  if (competitionLabel) return `${competitionLabel} - Match Open`;
  return 'Club Football - Match Open';
}

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function buildRulesDescription(gameId) {
  const g = GAME[gameId];
  const lines = [
    `**Join** with ${g.registerCommand}.`,
    ''
  ];

  if (gameId === 'club') {
    lines.push(
      '**Competitions:** Premier League, Bundesliga, La Liga, and UEFA Champions League.',
      '**Demo mode:** one sample Premier League fixture when `FOOTBALL_PREDICTION_MOCK_API=true`.',
      ''
    );
  }

  lines.push(
    '**Before kickoff** match posts appear in the prediction channel.',
    'Open the form and set:',
    '• Home goals (0-15)',
    '• Away goals (0-15)',
    '• Winner (home team, draw, or away team)',
    '',
    '**Scoring (per match, max 4 points)**',
    '• Exact score - **3** points',
    '• Correct winner pick - **1** point',
    '',
    'After full time, results and points are posted in the channel. ' +
    `Check standings anytime with ${g.leaderboardCommand}.`
  );

  return lines.join('\n');
}

/**
 * @param {Array<{ userId: string, scorePoints: number, resultPoints: number, total: number }>} earners
 * @returns {string}
 */
function formatPointsEarnedField(earners) {
  if (earners.length === 0) {
    return 'Nobody scored points on this match.';
  }
  return earners
    .sort((a, b) => b.total - a.total)
    .map(
      e =>
        `<@${e.userId}> - **+${e.total}** pts (${e.scorePoints} score, ${e.resultPoints} result)`
    )
    .join('\n');
}

const POINTS_FIELD_NAME = 'Points';

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function buildResultsFooter(gameId) {
  return `Standings: ${GAME[gameId].leaderboardCommand}`;
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture} fixture
 * @param {(fixture: unknown, side: 'home'|'away') => string} formatTeam
 * @param {import('./worldCupUtils').PendingPrediction | null} pending
 * @param {(fixture: unknown, pick: string) => string} formatResultPick
 * @returns {string}
 */
function buildPredictionFormContentWithPick(
  fixture,
  formatTeam,
  formatResultPick,
  pending = null
) {
  const lines = [
    `**${formatTeam(fixture, 'home')}** vs **${formatTeam(fixture, 'away')}**`,
    ''
  ];

  if (pending?.homeScore != null && pending?.awayScore != null) {
    lines.push(`Score: **${pending.homeScore}-${pending.awayScore}**`);
  }
  if (pending?.resultPick) {
    lines.push(`Winner: **${formatResultPick(fixture, pending.resultPick)}**`);
  }

  const complete =
    pending?.homeScore != null &&
    pending?.awayScore != null &&
    pending?.resultPick != null;

  if (complete) {
    lines.push('', 'Saving your prediction…');
  } else {
    lines.push('', 'Choose home goals, away goals, and the winner below (any order).');
  }

  return lines.join('\n');
}

const SAVED_PREDICTION_TITLE = 'Prediction Saved';
const WINNER_PLACEHOLDER = 'Pick the winner';
const WINNER_PLACEHOLDER_SELECTED = 'Winner: {label}';

/**
 * @param {string} label
 * @returns {string}
 */
function winnerPlaceholderSelected(label) {
  return WINNER_PLACEHOLDER_SELECTED.replace('{label}', label);
}

/**
 * @param {PredictionGameId} gameId
 * @param {boolean} repost
 * @param {boolean} repostSucceeded
 * @param {boolean} repostSkippedConfig
 * @returns {string}
 */
function buildResetDescription(gameId, repost, repostSucceeded, repostSkippedConfig) {
  const g = GAME[gameId];
  const lines = [
    `All ${g.label.toLowerCase()} prediction data has been cleared:`,
    '• Registrations',
    '• Predictions and in-progress picks',
    '• Points and leaderboard',
    '• Prompt and scoring history',
    ''
  ];

  if (!repost) {
    lines.push(
      'Match prompts were not re-posted. New prompts stay paused until an admin runs reset with **repost: true**.'
    );
  } else if (repostSucceeded) {
    lines.push(
      'Open match prompts were re-posted in the prediction channel (if any matches are still open).'
    );
  } else if (repostSkippedConfig) {
    lines.push(
      'Match prompts were not re-posted (API or prediction channel is not configured).'
    );
  }

  return lines.join('\n');
}

/**
 * @param {string} homeScore
 * @param {string} awayScore
 * @param {string} resultLabel
 * @param {boolean} scored
 * @param {number} [pointsAwarded]
 * @returns {string}
 */
function formatMyPickLine(homeScore, awayScore, resultLabel, scored, pointsAwarded) {
  const pick = `**${homeScore}-${awayScore}**, winner **${resultLabel}**`;
  const pts = scored
    ? ` - **+${pointsAwarded ?? 0}** pts`
    : ' - awaiting final score';
  return `${pick}${pts}`;
}

/**
 * @param {import('./matchPredictionAi').AiMatchPrediction} ai
 * @param {unknown} fixture
 * @param {(fixture: unknown, side: 'home'|'away') => string} formatTeam
 * @returns {string}
 */
function formatAiPredictionField(fixture, ai, formatTeam) {
  const home = formatTeam(fixture, 'home');
  const away = formatTeam(fixture, 'away');
  let scoreLine = `**${home} ${ai.homeScore}-${ai.awayScore} ${away}**`;
  if (ai.resultPick === 'draw') {
    scoreLine = `${scoreLine} - Draw`;
  }

  let reasoning = ai.reasoning
    ? truncateForEmbed(ai.reasoning, AI_REASONING_MAX_LENGTH)
    : '';

  let value = reasoning ? `${scoreLine}\n_${reasoning}_` : scoreLine;

  if (value.length > AI_FIELD_MAX_LENGTH) {
    const reasoningBudget = AI_FIELD_MAX_LENGTH - scoreLine.length - 4;
    if (reasoningBudget >= 24 && reasoning) {
      reasoning = truncateForEmbed(reasoning, reasoningBudget);
      value = `${scoreLine}\n_${reasoning}_`;
    } else {
      value = truncateForEmbed(value, AI_FIELD_MAX_LENGTH);
    }
  }

  return value;
}

/**
 * @param {PredictionGameId} gameId
 * @param {string} channelMention
 * @param {string} roleName
 * @returns {string}
 */
function buildRegisterSuccessDescription(gameId, channelMention, roleName) {
  return msgRegisterSuccess(gameId).replace('{channel}', channelMention);
}

/**
 * @param {PredictionGameId} gameId
 * @returns {string}
 */
function buildRegisterAlreadyDescription(gameId) {
  return msgAlreadyRegistered(gameId);
}

module.exports = {
  GAME,
  SUBMIT_BUTTON_LABEL,
  AI_PICK_FIELD_NAME,
  AI_REASONING_MAX_LENGTH,
  AI_FIELD_MAX_LENGTH,
  truncateForEmbed,
  ROLE_PING,
  ERR_UNKNOWN_SUBCOMMAND,
  ERR_UNEXPECTED,
  ERR_GUILD_ONLY,
  ERR_INVALID_MATCH,
  ERR_USE_IN_SERVER,
  ERR_MATCH_LOAD,
  ERR_PREDICTIONS_CLOSED,
  ERR_PREDICTIONS_CLOSED_SHORT,
  ERR_ALREADY_PREDICTED,
  ERR_GOALS_RANGE,
  ERR_INVALID_WINNER,
  NOTE_WINNER_REALIGNED,
  errRegisterFirst,
  ERR_REGISTER_NOT_CONFIGURED,
  ERR_PARTICIPANT_ROLE_MISSING,
  ERR_MANAGE_ROLES_REQUIRED,
  ERR_ROLE_HIERARCHY,
  msgEmptyLeaderboard,
  MSG_NO_MATCHES_FILTER,
  MSG_NO_PREDICTIONS,
  msgNoPredictionsForUser,
  msgNoPredictionsAnywhere,
  predictionsTitleOther,
  MSG_MISSING_PREDICTION,
  REGISTER_EMBED_TITLE_SUCCESS,
  REGISTER_EMBED_TITLE_ALREADY,
  REGISTER_EMBED_TITLE_ERROR,
  SAVED_PREDICTION_TITLE,
  WINNER_PLACEHOLDER,
  POINTS_FIELD_NAME,
  PROMPT_FOOTER,
  errNotConfigured,
  errAdminResetOnly,
  buildRolePing,
  buildPromptDescription,
  buildPromptTitle,
  buildRulesDescription,
  formatPointsEarnedField,
  buildResultsFooter,
  buildPredictionFormContentWithPick,
  winnerPlaceholderSelected,
  buildResetDescription,
  formatMyPickLine,
  formatAiPredictionField,
  buildRegisterSuccessDescription,
  buildRegisterAlreadyDescription
};
