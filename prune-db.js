/**
 * Script to prune unused, orphaned, or obsolete keys from the Keyv SQLite database.
 *
 * Usage:
 *   node prune-db.js                      # Dry run (default)
 *   node prune-db.js --commit --force       # Delete keys (stop the bot first)
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const { sqlitePath, checkDatabaseAccess, configCacheKeyFromDbKey } = require('./utils/dbScriptUtils');
const { parseDbWriteFlags, resolveDbWriteMode, printDbWriteDryRunHint } = require('./utils/dbWriteCli');
const { analyzeDatabaseKeys } = require('./utils/pruneDb');

async function pruneDatabase() {
  const rawArgs = process.argv.slice(2);
  const { isCommit, isForce, positional } = parseDbWriteFlags(rawArgs);
  if (positional.length > 0) {
    console.error('Unknown argument(s):', positional.join(' '));
    console.error('Usage: node prune-db.js [--commit --force]');
    process.exit(1);
  }

  const writeMode = resolveDbWriteMode({ isCommit, isForce }, { scriptName: 'prune-db.js' });

  console.log('=== Keyv SQLite Database Pruner ===');
  console.log(`Database Path: ${sqlitePath}`);
  console.log(`Mode: ${writeMode.proceed ? 'COMMIT (Keys WILL be deleted)' : 'DRY RUN (Read-only)'}\n`);
  console.log('Stop the Nova bot before running with --commit --force.\n');

  const accessCheck = checkDatabaseAccess();
  if (!accessCheck.accessible && accessCheck.fileExists) {
    console.error('Cannot access the database file due to a permission error.');
    if (accessCheck.recommendation) {
      console.error('\nRecommendation:');
      console.error(accessCheck.recommendation);
    }
    process.exit(1);
  }

  if (!fs.existsSync(sqlitePath)) {
    console.log('Database file does not exist. Nothing to prune.');
    process.exit(0);
  }

  let db;
  try {
    db = new Database(sqlitePath, { readonly: !writeMode.proceed });
  } catch (error) {
    console.error(`Failed to open the database. ${error.message}`);
    process.exit(1);
  }

  try {
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='keyv'
    `).get();

    if (!tableCheck) {
      console.log("The 'keyv' table does not exist in the database yet. Nothing to prune.");
      db.close();
      return;
    }

    const rows = db.prepare('SELECT key FROM keyv').all();
    console.log(`Analyzing ${rows.length} total key(s) in the 'keyv' table...\n`);

    const { keepCount, deleteKeys } = analyzeDatabaseKeys(rows.map((row) => row.key));

    console.log('Analysis Results:');
    console.log(`  - Keys to KEEP:   ${keepCount}`);
    console.log(`  - Keys to DELETE: ${deleteKeys.length}`);
    console.log('');

    if (deleteKeys.length === 0) {
      console.log('No unnecessary or orphaned keys found in the database. Your database is clean!');
      db.close();
      return;
    }

    console.log('Unnecessary / obsolete keys found:');
    deleteKeys.forEach((key) => {
      console.log(`  [DELETE] ${key}`);
    });
    console.log('');

    if (!writeMode.proceed) {
      printDbWriteDryRunHint('prune-db.js');
    } else {
      console.log('Deleting unnecessary keys from the database...');

      const deleteStmt = db.prepare('DELETE FROM keyv WHERE key = ?');
      const transaction = db.transaction((keys) => {
        let count = 0;
        for (const key of keys) {
          const result = deleteStmt.run(key);
          count += result.changes;
        }
        return count;
      });

      const deletedCount = transaction(deleteKeys);
      console.log(`Successfully deleted ${deletedCount} obsolete key(s) from the database.`);

      const invalidatedConfigKeys = new Set();
      for (const key of deleteKeys) {
        const configKey = configCacheKeyFromDbKey(key);
        if (configKey) invalidatedConfigKeys.add(configKey);
      }
      if (invalidatedConfigKeys.size > 0) {
        const { invalidateConfigCache } = require('./utils/database');
        for (const configKey of invalidatedConfigKeys) {
          invalidateConfigCache(configKey);
        }
      }

      console.log('Reclaiming disk space (VACUUM)...');
      db.pragma('journal_mode = DELETE');
      db.prepare('VACUUM').run();
      console.log('Database size optimized successfully. Cleanup complete!');
    }

    db.close();
  } catch (error) {
    console.error(`An error occurred while pruning the database. ${error.message}`);
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors during failure handling.
      }
    }
    process.exit(1);
  }
}

pruneDatabase();
