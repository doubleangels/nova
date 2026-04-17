/**
 * Validates and applies Nova Keyv JSON backups (same shape as GET /api/database/export).
 * All validation runs before any database write.
 */

const path = require('path');

const FORMAT_ID = 'nova-keyv-backup';
const SUPPORTED_FORMAT_VERSION = 1;

const MAX_ENTRIES = 50_000;
/** Matches @keyv/sqlite default key VARCHAR(255). */
const MAX_FULL_KEY_LENGTH = 255;
/** Per-row encoded payload cap (UTF-8 bytes). */
const MAX_ENCODED_VALUE_BYTES = 2 * 1024 * 1024;

/** First path segment of fullKey must be one of these Keyv namespaces used by Nova. */
const ALLOWED_NAMESPACES = new Set(['main', 'invites', 'sessions', 'nova_reminders']);

const FULL_KEY_RE = /^[a-zA-Z0-9_:.\-]+$/;

/**
 * @param {unknown} payload
 * @returns {{ ok: true, entries: Array<{ fullKey: string, value: unknown }>, warnings: string[] } | { ok: false, error: string }}
 */
function validateNovaKeyvBackup(payload) {
  const warnings = [];

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Backup root must be a JSON object.' };
  }

  if (payload.format !== FORMAT_ID) {
    return { ok: false, error: `Invalid or missing format (expected "${FORMAT_ID}").` };
  }

  if (payload.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported formatVersion (supported: ${SUPPORTED_FORMAT_VERSION}).`
    };
  }

  if (!Array.isArray(payload.entries)) {
    return { ok: false, error: 'Backup must include an "entries" array.' };
  }

  if (payload.entries.length > MAX_ENTRIES) {
    return { ok: false, error: `Too many entries (max ${MAX_ENTRIES}).` };
  }

  if (
    typeof payload.entryCount === 'number' &&
    Number.isFinite(payload.entryCount) &&
    payload.entryCount !== payload.entries.length
  ) {
    warnings.push(
      `entryCount (${payload.entryCount}) does not match entries.length (${payload.entries.length}); using entries array.`
    );
  }

  /** @type {Map<string, { fullKey: string, value: unknown }>} */
  const byKey = new Map();

  for (let i = 0; i < payload.entries.length; i++) {
    const row = payload.entries[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `entries[${i}] must be an object.` };
    }

    const fullKey = row.fullKey;
    if (typeof fullKey !== 'string') {
      return { ok: false, error: `entries[${i}].fullKey must be a non-empty string.` };
    }
    if (fullKey.length === 0 || fullKey.length > MAX_FULL_KEY_LENGTH) {
      return {
        ok: false,
        error: `entries[${i}].fullKey length must be between 1 and ${MAX_FULL_KEY_LENGTH}.`
      };
    }
    if (!FULL_KEY_RE.test(fullKey)) {
      return {
        ok: false,
        error: `entries[${i}].fullKey contains invalid characters (allowed: letters, digits, _, :, ., -).`
      };
    }

    const colon = fullKey.indexOf(':');
    if (colon < 1) {
      return { ok: false, error: `entries[${i}].fullKey must include a namespace prefix (e.g. "main:...").` };
    }
    const ns = fullKey.slice(0, colon);
    if (!ALLOWED_NAMESPACES.has(ns)) {
      return {
        ok: false,
        error: `entries[${i}] namespace "${ns}" is not allowed (allowed: ${[...ALLOWED_NAMESPACES].join(', ')}).`
      };
    }

    if (!('value' in row)) {
      return { ok: false, error: `entries[${i}] is missing "value".` };
    }

    let encoded;
    try {
      assertJsonSafeValue(row.value);
      encoded = JSON.stringify({ value: row.value, expires: null });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      return { ok: false, error: `entries[${i}].value is not safe to store: ${msg}` };
    }

    const byteLen = Buffer.byteLength(encoded, 'utf8');
    if (byteLen > MAX_ENCODED_VALUE_BYTES) {
      return {
        ok: false,
        error: `entries[${i}] encoded value exceeds ${MAX_ENCODED_VALUE_BYTES} bytes (${byteLen}).`
      };
    }

    if (byKey.has(fullKey)) {
      warnings.push(`Duplicate fullKey "${fullKey}" — last occurrence wins.`);
    }
    byKey.set(fullKey, { fullKey, value: row.value });
  }

  return {
    ok: true,
    entries: [...byKey.values()],
    warnings
  };
}

/**
 * Rejects types that JSON cannot represent faithfully or that are risky to persist.
 * @param {unknown} val
 * @param {string} path
 */
function assertJsonSafeValue(val, path = 'value') {
  if (val === undefined) {
    throw new Error(`${path} must not be undefined`);
  }
  const t = typeof val;
  if (t === 'function' || t === 'symbol') {
    throw new Error(`${path} must not be a ${t}`);
  }
  if (t === 'bigint') {
    throw new Error(`${path} must not be a bigint`);
  }
  if (val === null || t === 'string' || t === 'number' || t === 'boolean') {
    if (t === 'number' && !Number.isFinite(val)) {
      throw new Error(`${path} must be a finite number`);
    }
    return;
  }

  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      assertJsonSafeValue(val[i], `${path}[${i}]`);
    }
    return;
  }

  if (t === 'object') {
    const proto = Object.getPrototypeOf(val);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path} must be a plain object or array (no class instances)`);
    }
    for (const k of Object.keys(val)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        throw new Error(`${path} must not include disallowed key "${k}"`);
      }
      assertJsonSafeValue(val[k], `${path}.${k}`);
    }
    return;
  }

  throw new Error(`${path} has unsupported type`);
}

function getSqlitePath() {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'database.sqlite');
}

/**
 * Upserts validated entries in a single transaction.
 * @param {Array<{ fullKey: string, value: unknown }>} entries
 * @returns {{ written: number }}
 */
function applyNovaKeyvBackupEntries(entries) {
  const Database = require('better-sqlite3');
  const sqlitePath = getSqlitePath();
  const db = new Database(sqlitePath);

  const upsert = db.prepare(`
    INSERT INTO keyv (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const run = db.transaction(() => {
    let n = 0;
    for (const { fullKey, value } of entries) {
      const encoded = JSON.stringify({ value, expires: null });
      upsert.run(fullKey, encoded);
      n++;
    }
    return n;
  });

  const written = run();
  db.close();
  return { written };
}

/**
 * @param {string | object} input - Raw JSON string or already-parsed object
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
function parseBackupPayload(input) {
  if (typeof input === 'string') {
    try {
      return { ok: true, payload: JSON.parse(input) };
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e && e.message ? e.message : String(e)}` };
    }
  }
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    return { ok: true, payload: input };
  }
  return { ok: false, error: 'Backup must be a JSON object or a JSON string.' };
}

module.exports = {
  FORMAT_ID,
  SUPPORTED_FORMAT_VERSION,
  MAX_ENTRIES,
  validateNovaKeyvBackup,
  applyNovaKeyvBackupEntries,
  parseBackupPayload
};
