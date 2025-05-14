-- Rename sent_at to remind_at in reminder_recovery
ALTER TABLE main.reminder_recovery RENAME COLUMN sent_at TO remind_at; 