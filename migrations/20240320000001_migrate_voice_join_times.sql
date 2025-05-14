-- Insert existing voice join times into the new recovery table
INSERT INTO main.recovery (type, user_id, join_time)
SELECT 
    'voice_join',
    key,
    to_timestamp(value::bigint / 1000.0) AT TIME ZONE 'UTC'
FROM main.config
WHERE key = 'voice_join_times'
AND value IS NOT NULL;

-- Clean up the old data
DELETE FROM main.config WHERE key = 'voice_join_times'; 