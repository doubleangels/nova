# Troll Mode and Automatic Translation Feature Files

This folder contains all the files needed for the **Troll Mode** and **Automatic Translation** features from the Nova Discord bot.

## Files Included

### Troll Mode Feature
- `commands/trollMode.js` - Slash command for managing troll mode settings
- `utils/trollModeUtils.js` - Utility functions for checking account age and performing kicks
- `events/guildMemberAdd.js` - Event handler that checks new members against troll mode settings

### Automatic Translation Feature
- `events/messageReactionAdd.js` - Event handler that processes flag emoji reactions for translation
- `utils/languageUtils.js` - Language mapping utilities (flag emojis to language codes)

### Common Dependencies
- `logger.js` - Logging utility (used by all features)
- `utils/database.js` - Database utilities for storing/retrieving configuration values
- `config.js` - Configuration file (needed for Google API key used in translation)

## Dependencies Required

From `package.json`, these features require:
- `discord.js` - Discord bot framework
- `dayjs` - Date manipulation (used in troll mode for account age calculation)
- `axios` - HTTP client (used for Google Translate API)
- `keyv` and `@keyv/sqlite` - Database storage
- `pino` and `pino-pretty` - Logging
- `dotenv` - Environment variable management

## How These Features Work

### Troll Mode
1. Administrators can enable/disable troll mode and set minimum account age via `/trollmode` command
2. When a new member joins (`guildMemberAdd` event), the bot checks their account age
3. If the account is too new (based on configured age requirement), the member is automatically kicked
4. Bot accounts are exempt from this check

### Automatic Translation
1. Users can react to messages with flag emojis (🇺🇸, 🇪🇸, 🇫🇷, etc.)
2. The `messageReactionAdd` event detects valid flag emojis
3. The bot translates the message content to the language associated with the flag
4. Translation is done via Google Translate API
5. The translated text is sent as a reply embed

## Database Keys Used

### Troll Mode
- `troll_mode_enabled` - Boolean indicating if troll mode is active
- `troll_mode_account_age` - Minimum account age in days (default: 30)

### Translation
- No database keys required (uses Google Translate API directly)

