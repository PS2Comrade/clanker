# Migration Guide: Python to Node.js

This bot has been completely rewritten from Python to Node.js/Discord.js v14.

## What Changed

### Technology Stack
- **Old**: Python with discord.py
- **New**: Node.js with Discord.js v14

### Key Improvements
1. ✅ Fixed `EmbedBuilder` typo (now using proper Discord.js imports)
2. ✅ Complete translation system rewrite with multiple providers
3. ✅ New 3-trial moderation system
4. ✅ Both slash (/) and prefix (!) commands working
5. ✅ SQLite database for persistence
6. ✅ Proper error handling and rate limiting
7. ✅ Custom emoji filtering
8. ✅ Auto-translation in configured channels

## Old Files (Deprecated)

The following Python files are now deprecated:
- `src/app.py` - Old Python bot
- `src/config_store.py` - Old config system
- `src/providers.py` - Old translation providers

These are kept for reference only. **Do not run them.**

## New Structure

```
src/
├── index.js                      # Main bot entry point
├── commands/
│   ├── translation.js            # Translation commands
│   └── moderation.js             # Moderation commands
├── database/
│   └── db.js                     # SQLite database
└── utils/
    ├── translationProviders.js   # Translation APIs
    └── moderationLogic.js        # 3-trial system
```

## How to Run the New Bot

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure
Edit `config.json` with your bot token and settings, or use environment variables:
```bash
export DISCORD_TOKEN="your_token_here"
export CLIENT_ID="your_client_id_here"
```

### 3. Start the Bot
```bash
npm start
```

## Configuration Migration

### Old Python Config (.env)
```env
DISCORD_TOKEN=...
DEEPL_API_KEY=...
LIBRE_URL=...
```

### New Node.js Config (config.json)
```json
{
  "discord_token": "...",
  "translation": {
    "providers": {
      "deepl": { "api_key": "..." },
      "libretranslate": { "url": "..." }
    }
  }
}
```

## Command Changes

All commands remain the same! Both slash (/) and prefix (!) commands work.

### Translation Commands
- `/tr` or `!tr` - Translate text
- `/tr_auto` - Manage auto-translation
- `/tr_status` - Show configuration

### New Moderation Commands
- `/warn` or `!warn` - Warn a user
- `/mute` - Timeout a user
- `/kick` - Kick a user
- `/ban` - Ban a user
- `/warns` or `!warns` - Check warnings
- `/modstats` or `!modstats` - Show trial stats

## Database

The new bot uses SQLite instead of JSON files:
- Old: `config.json` (config storage)
- New: `data/bot.db` (SQLite database)

The database stores:
- Guild configurations
- User moderation history
- Trial stages and warn counts
- Ban appeal dates

## Features Added

1. **3-Trial Moderation System**
   - Progressive punishment
   - Automatic bans
   - Appeal system

2. **Multiple Translation Providers**
   - DeepL
   - LibreTranslate
   - Lingva
   - SimplyTranslate
   - Google Translate (fallback)

3. **Better Error Handling**
   - Graceful provider fallbacks
   - Rate limiting
   - Detailed logging

4. **Custom Emoji Support**
   - Ignores `:emoji:` and `<:emoji:123>` formats

## Troubleshooting

### Bot won't start
- Check `config.json` has valid token
- Run `npm install` to ensure dependencies are installed
- Check Node.js version (requires 18+)

### Commands not appearing
- Set `client_id` in config.json
- Wait up to 1 hour for global command sync
- Or use guild-specific sync (faster)

### Database errors
- Ensure `data/` directory exists
- Check file permissions
- Delete `data/bot.db` to reset (will lose all data)

## Need Help?

Open an issue on GitHub with:
- Bot version
- Error messages
- Steps to reproduce
