-- Add type column to reminder_recovery table
ALTER TABLE main.reminder_recovery
ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'bump';

-- Add an index on the type column for better query performance
CREATE INDEX idx_reminder_recovery_type ON main.reminder_recovery(type);

-- Update existing records to have the 'bump' type
UPDATE main.reminder_recovery
SET type = 'bump'
WHERE type IS NULL; 