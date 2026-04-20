const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'database.sqlite');
const db = new Database(sqlitePath);

try {
  const legacyPrefixes = [
    'main:message_count:',
    'main:last_message:',
    'main:last_message_channel:',
    'main:invite_usage:',
    'main:invite_join_history:',
    'main:invite_code_to_tag_map:'
  ];

  console.log('--- BEFORE MIGRATION ---');
  for (const prefix of legacyPrefixes) {
    const count = db.prepare("SELECT COUNT(*) AS c FROM keyv WHERE key LIKE ?").get(`${prefix}%`).c;
    console.log(`${prefix}: ${count}`);
  }

  // Define migration map
  const migrationMap = {
    'main:message_count:': 'messages:count:',
    'main:last_message:': 'messages:time:',
    'main:last_message_channel:': 'messages:channel:',
    'main:invite_usage:': 'invites:usage:',
    'main:invite_join_history:': 'invites:join_history:',
    'main:invite_code_to_tag_map:': 'invites:code_to_tag_map:'
  };

  db.transaction(() => {
    for (const [oldPrefix, newPrefix] of Object.entries(migrationMap)) {
      const rows = db.prepare("SELECT key, value FROM keyv WHERE key LIKE ?").all(`${oldPrefix}%`);
      for (const row of rows) {
        const newKey = row.key.replace(oldPrefix, newPrefix);
        db.prepare("INSERT INTO keyv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(newKey, row.value);
        db.prepare("DELETE FROM keyv WHERE key = ?").run(row.key);
      }
    }
  })();

  console.log('\n--- AFTER MIGRATION ---');
  for (const prefix of legacyPrefixes) {
    const count = db.prepare("SELECT COUNT(*) AS c FROM keyv WHERE key LIKE ?").get(`${prefix}%`).c;
    console.log(`${prefix}: ${count}`);
  }

  const newPrefixes = Object.values(migrationMap);
  console.log('\n--- NEW NAMESPACES ---');
  for (const prefix of newPrefixes) {
    const count = db.prepare("SELECT COUNT(*) AS c FROM keyv WHERE key LIKE ?").get(`${prefix}%`).c;
    console.log(`${prefix}: ${count}`);
  }

} finally {
  db.close();
}
