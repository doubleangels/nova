-- Create recovery table for storing various recovery states
CREATE TABLE IF NOT EXISTS main.recovery (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    join_time TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_recovery_type_user ON main.recovery(type, user_id);

-- Add comment to table
COMMENT ON TABLE main.recovery IS 'Stores recovery states for various features like voice join times'; 