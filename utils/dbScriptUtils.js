/**
 * Shared utilities for database CLI scripts (set-value, remove-value, list-values)
 */

const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
const path = require('path');
const fs = require('fs');

// Configuration constants
const NAMESPACES = ['main', 'invites'];
const KNOWN_SECTIONS = ['config:', 'tags:', 'invite_usage:', 'invite_code_to_tag_map:'];

// Ensure data directory exists
// Allow override via environment variable for container usage
const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'database.sqlite');

/**
 * Ensures the data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Get debug information about the database path
 * @returns {Object} Debug information
 */
function getDatabasePathInfo() {
  return {
    dataDir,
    sqlitePath,
    cwd: process.cwd(),
    dataDirExists: fs.existsSync(dataDir),
    databaseExists: fs.existsSync(sqlitePath),
    envDataDir: process.env.DATA_DIR
  };
}

/**
 * Parse a key into namespace, section, and actual key
 * @param {string} key - The key to parse
 * @returns {{namespace: string, section: string|null, actualKey: string, fullKey: string}}
 */
function parseKey(key) {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new Error('Key must be a non-empty string');
  }

  const parts = key.split(':');
  
  // Check if first part is a namespace
  let namespace = 'main'; // default
  let section = null;
  let actualKey = key;
  
  if (NAMESPACES.includes(parts[0])) {
    namespace = parts[0];
    const remaining = parts.slice(1).join(':');
    
    // Check if there's a section (second part after namespace)
    if (remaining.includes(':')) {
      const sectionParts = remaining.split(':');
      section = sectionParts[0] + ':';
      actualKey = sectionParts.slice(1).join(':');
    } else {
      // No section, entire remaining is the key
      actualKey = remaining;
    }
  } else {
    // No namespace specified, check if it starts with a known section
    for (const knownSection of KNOWN_SECTIONS) {
      if (key.startsWith(knownSection)) {
        section = knownSection;
        actualKey = key.substring(knownSection.length);
        break;
      }
    }
  }
  
  // Build full key for Keyv
  let fullKey = actualKey;
  if (section) {
    fullKey = section + fullKey;
  }
  
  return { namespace, section, actualKey, fullKey };
}

/**
 * Get Keyv instance for a namespace
 * @param {string} namespace - The namespace
 * @returns {Keyv}
 */
function getKeyvForNamespace(namespace) {
  if (!NAMESPACES.includes(namespace)) {
    throw new Error(`Invalid namespace: ${namespace}. Must be one of: ${NAMESPACES.join(', ')}`);
  }

  ensureDataDir();
  
  return new Keyv({
    store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
      table: 'keyv',
      busyTimeout: 10000
    }),
    namespace: namespace
  });
}

/**
 * Parse a value string into appropriate JavaScript type
 * @param {string} value - The value string to parse
 * @returns {any} The parsed value
 */
function parseValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  
  // Try to parse as JSON if it looks like JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // If JSON parsing fails, use as string
      return value;
    }
  }
  
  // Try to parse as boolean
  if (trimmed.toLowerCase() === 'true') {
    return true;
  } else if (trimmed.toLowerCase() === 'false') {
    return false;
  } else if (trimmed.toLowerCase() === 'null') {
    return null;
  }
  
  // Try to parse as number, but preserve large numbers (Discord IDs) as strings
  const numValue = Number(trimmed);
  if (!isNaN(numValue) && trimmed !== '') {
    // Discord snowflake IDs are 64-bit integers that exceed JavaScript's safe integer range
    // Keep them as strings to preserve precision
    if (numValue > Number.MAX_SAFE_INTEGER || numValue < Number.MIN_SAFE_INTEGER) {
      return value; // Keep as string for large numbers
    } else {
      return numValue;
    }
  }
  
  // Use as string
  return value;
}

/**
 * Helper function to ensure Keyv instance is properly disconnected
 * @param {Keyv} keyv - The Keyv instance
 * @param {Function} fn - Async function to execute with the Keyv instance
 * @returns {Promise<any>} The result of the function
 */
async function withKeyv(keyv, fn) {
  try {
    return await fn(keyv);
  } finally {
    if (keyv && typeof keyv.disconnect === 'function') {
      await keyv.disconnect();
    }
  }
}

/**
 * Parse a database key (format: namespace:section:key or namespace:key)
 * This is used when reading keys directly from the database
 * @param {string} dbKey - The database key to parse
 * @returns {{namespace: string, section: string|null, actualKey: string, fullKey: string}}
 */
function parseDatabaseKey(dbKey) {
  const parts = dbKey.split(':');
  
  // First part should be the namespace
  const namespace = NAMESPACES.includes(parts[0]) ? parts[0] : 'main';
  const restOfKey = parts.slice(1).join(':');
  
  if (!restOfKey) {
    return { namespace, section: null, actualKey: '', fullKey: '' };
  }
  
  // Check if there's a section (second part after namespace)
  let section = null;
  let actualKey = restOfKey;
  
  // Check if it starts with a known section
  for (const knownSection of KNOWN_SECTIONS) {
    if (restOfKey.startsWith(knownSection)) {
      section = knownSection;
      actualKey = restOfKey.substring(knownSection.length);
      break;
    }
  }
  
  // If no known section found but there's a colon, treat first part as section
  if (!section && restOfKey.includes(':')) {
    const sectionParts = restOfKey.split(':');
    section = sectionParts[0] + ':';
    actualKey = sectionParts.slice(1).join(':');
  }
  
  // Build full key (what Keyv uses internally)
  const fullKey = section ? section + actualKey : actualKey;
  
  return { namespace, section, actualKey, fullKey };
}

/**
 * Format section name for display (remove trailing colon)
 * @param {string|null} section - The section name
 * @returns {string} Formatted section name
 */
function formatSectionName(section) {
  return section ? section.substring(0, section.length - 1) : '';
}

module.exports = {
  ensureDataDir,
  parseKey,
  parseDatabaseKey,
  getKeyvForNamespace,
  parseValue,
  withKeyv,
  formatSectionName,
  getDatabasePathInfo,
  sqlitePath,
  NAMESPACES,
  KNOWN_SECTIONS
};

