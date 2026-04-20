const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'database.sqlite');

if (!fs.existsSync(sqlitePath)) {
  console.error('Database not found at', sqlitePath);
  process.exit(1);
}

const db = new Database(sqlitePath);

try {
  const testData = [
    { key: 'main:message_count:test_user', value: JSON.stringify({ value: 42, expires: null }) },
    { key: 'main:last_message:test_user', value: JSON.stringify({ value: Date.now(), expires: null }) },
    { key: 'main:invite_usage:test_guild', value: JSON.stringify({ value: { 'ABC': 5 }, expires: null }) }
  ];

  const insert = db.prepare('INSERT INTO keyv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  
  for (const { key, value } of testData) {
    insert.run(key, value);
    console.log('Inserted legacy key:', key);
  }

  console.log('Test legacy data inserted successfully.');
} catch (err) {
  console.error('Error inserting test data:', err);
} finally {
  db.close();
}
