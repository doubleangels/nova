const { captureError, closeSentry } = require('./instrument');
const { Client, Collection, GatewayIntentBits, Options } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const { getValue, setValue } = require('./utils/database');

/** @type {GatewayIntentBits[]} Bot intents required for functionality */
const BOT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions,
];

/** @type {Client} Discord client instance */
const client = new Client({
  intents: BOT_INTENTS,
  makeCache: Options.cacheWithLimits({
    MessageManager: 100,
    ReactionManager: 50,
    ReactionUserManager: 0,
    PresenceManager: 0,
    ThreadManager: 25,
  }),
  sweepers: {
    messages: {
      interval: 1800,
      lifetime: 900,
    },
    users: {
      interval: 3600,
      filter: () => (user) => user.bot === false,
    },
  },
});

/** @type {Collection<string, Command>} Collection of registered commands */
client.commands = new Collection();

const deployCommands = require('./deploy-commands');
deployCommands().then(() => logger.info('Slash commands deployed on startup.')).catch(err => logger.error('Failed to deploy slash commands on startup:', err));

/**
 * Loads all command files from the commands directory
 * @type {string} Path to the commands directory
 */
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
    logger.info(`Loaded command: ${command.data.name}`);
  } catch (error) {
    captureError(error, { source: 'commandLoad', file });
    logger.error(`Error loading command file: ${file}`, {
      error: error.stack,
      message: error.message
    });
  }
}

/**
 * Loads all event files from the events directory
 * @type {string} Path to the events directory
 */
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  try {
    const event = require(path.join(eventsPath, file));

    // Wrap execute so any error that escapes the event's own try/catch is still captured.
    const safeExecute = (...args) =>
      Promise.resolve(event.execute(...args)).catch((error) => {
        captureError(error, { event: event.name, source: 'eventExecute' });
        logger.error(`Unhandled error escaped event handler: ${event.name}`, { err: error });
      });

    if (event.once) {
      client.once(event.name, safeExecute);
    } else {
      client.on(event.name, safeExecute);
    }
    logger.info(`Loaded event: ${event.name}`);
  } catch (error) {
    captureError(error, { source: 'eventLoad', file });
    logger.error(`Error loading event file: ${file}`, {
      error: error.stack,
      message: error.message
    });
  }
}

client.login(config.token);

// ─── Dashboard ───────────────────────────────────────────────────────────────
// Starts the web dashboard in the same process after the Discord client is wired up.
// The dashboard receives the live `client` so it can read guild data and apply changes.
if (process.env.DISCORD_CLIENT_SECRET && process.env.DASHBOARD_SESSION_SECRET) {
  (async () => {
    const createDashboard = require('./dashboard/server');
    const envDashboardPort = parseInt(process.env.DASHBOARD_PORT || '3001', 10);
    const envDashboardBaseUrl = process.env.DASHBOARD_BASE_URL || `http://localhost:${envDashboardPort}`;
    const envCookieSecure = process.env.DASHBOARD_COOKIE_SECURE;

    function hasValue(v) {
      return v != null && String(v).trim() !== '';
    }
    function parseBool(v) {
      if (typeof v === 'boolean') return v;
      if (!hasValue(v)) return null;
      const s = String(v).trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
      return null;
    }

    // Persist once from env, then prefer DB forever so these can be removed from Doppler.
    async function resolveDashboardSetting(key, envValue) {
      const current = await getValue(key);
      if (hasValue(current)) return current;
      if (hasValue(envValue)) {
        await setValue(key, envValue);
        return envValue;
      }
      return null;
    }

    try {
      const dbPortRaw = await resolveDashboardSetting('dashboard_port', envDashboardPort);
      const parsedPort = Number.parseInt(String(dbPortRaw || envDashboardPort), 10);
      const dashboardPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3001;

      const dashboardBaseUrl = String(
        (await resolveDashboardSetting('dashboard_base_url', envDashboardBaseUrl)) || `http://localhost:${dashboardPort}`
      ).replace(/\/$/, '');

      const dbCookieSecureRaw = await resolveDashboardSetting('dashboard_cookie_secure', envCookieSecure);
      const dashboardCookieSecure = parseBool(dbCookieSecureRaw);
      const useSecureCookie = dashboardCookieSecure == null
        ? /^https:\/\//i.test(dashboardBaseUrl)
        : dashboardCookieSecure;

      const dashboardApp = createDashboard(client, {
        dashboardBaseUrl,
        useSecureCookie,
      });

      dashboardApp.listen(dashboardPort, () => {
        logger.info(`Dashboard running on port ${dashboardPort}.`, { url: dashboardBaseUrl });
      });
    } catch (err) {
      logger.error('Failed to start dashboard.', { err });
    }
  })();
} else {
  logger.info('Dashboard not started — set DISCORD_CLIENT_SECRET and DASHBOARD_SESSION_SECRET in Doppler to enable it.');
}

/**
 * Last-resort safety net: catches any exception that escapes all try-catch blocks.
 * Sentry's built-in integrations also handle these, but explicit handlers ensure
 * we flush before the process exits.
 */
process.on('uncaughtException', (error) => {
  captureError(error, { handler: 'uncaughtException' });
  logger.error('Uncaught exception — process will exit.', { err: error });
  closeSentry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  captureError(err, { handler: 'unhandledRejection' });
  logger.error('Unhandled promise rejection.', { err });
});

/**
 * Handles graceful shutdown on SIGINT signal
 */
process.on('SIGINT', async () => {
  logger.info('Shutdown signal (SIGINT) received. Exiting...');
  try {
    await closeSentry();
  } catch (err) {
    logger.error('Error flushing Sentry on shutdown.', { err });
  }
  process.exit(0);
});

/**
 * Handles graceful shutdown on SIGTERM signal
 */
process.on('SIGTERM', async () => {
  logger.info('Shutdown signal (SIGTERM) received. Exiting...');
  try {
    await closeSentry();
  } catch (err) {
    logger.error('Error flushing Sentry on shutdown.', { err });
  }
  process.exit(0);
});