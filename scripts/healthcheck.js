#!/usr/bin/env node
const { isBotHeartbeatFresh, DEFAULT_MAX_AGE_MS } = require('../utils/botHealth');

process.exit(isBotHeartbeatFresh(DEFAULT_MAX_AGE_MS) ? 0 : 1);
