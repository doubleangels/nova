-- Rename sent_reminders table to reminder_recovery
ALTER TABLE main.sent_reminders RENAME TO reminder_recovery;

-- Add comment to explain the table's purpose
COMMENT ON TABLE main.reminder_recovery IS 'Stores message IDs for reminder recovery in case of bot restart'; 