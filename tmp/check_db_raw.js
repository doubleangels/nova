const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);

const rows = db.prepare("SELECT key, value FROM keyv WHERE key IN ('reminder_role', 'reminder_channel')").all();

console.log(JSON.stringify(rows, null, 2));
db.close();
