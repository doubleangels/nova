const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

async function migrateVoiceJoinTimes() {
  try {
    // First, ensure the recovery table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS main.recovery (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        user_id VARCHAR(20) NOT NULL,
        join_time TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index if it doesn't exist
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_type_user 
      ON main.recovery(type, user_id);
    `);

    // Insert the specific voice join time
    await pool.query(`
      INSERT INTO main.recovery (type, user_id, join_time)
      VALUES (
        'voice_join',
        '324432387356360705',
        to_timestamp(1747210190709 / 1000.0) AT TIME ZONE 'UTC'
      )
      ON CONFLICT (type, user_id) 
      DO UPDATE SET 
        join_time = EXCLUDED.join_time,
        updated_at = CURRENT_TIMESTAMP;
    `);

    console.log('Successfully migrated voice join times to recovery table');
  } catch (error) {
    console.error('Error migrating voice join times:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the migration
migrateVoiceJoinTimes().catch(console.error); 