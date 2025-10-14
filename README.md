# Clanker Bot

A powerful Discord bot with advanced translation capabilities and a 3-trial moderation system.

## Features

### 🌐 Translation System
- **Multiple Providers**: DeepL, LibreTranslate, Lingva, SimplyTranslate, Google Translate
- **Smart Fallback**: Automatically tries multiple providers if one fails
- **Auto-Translation**: Configure channels for automatic translation
- **Language Detection**: Automatically detects source language
- **Custom Emoji Support**: Ignores Discord custom emojis (`:emoji:` and `<:emoji:123>`)
- **Blacklist Support**: Block specific languages per server
- **Rate Limiting**: Built-in rate limiting to prevent API abuse

### ⚖️ 3-Trial Moderation System

The bot implements a progressive punishment system:

- **First Trial**: 5 warns → ban (appeal after 1 week)
- **Second Trial**: 4 warns → ban (appeal after 2 weeks)
- **Third Trial**: 3 warns → ban (appeal after 3 months)
- **Great Trial**: 5 warns → permanent ban (no appeal)

## Setup

### Prerequisites
- Node.js 18+ 
- Discord Bot Token
- (Optional) Translation API keys

### Installation

1. Clone the repository:
```bash
git clone https://github.com/PS2Comrade/clanker.git
cd clanker
```

2. Install dependencies:
```bash
npm install
```

3. Configure the bot:
   - Copy `config.json` and fill in your bot token
   - Or set environment variables: `DISCORD_TOKEN`, `CLIENT_ID`

4. Start the bot:
```bash
npm start
```

## Commands

### Translation Commands

#### Slash Commands
- `/tr [text]` — Translate text or message link to English
- `/tr_auto add [channel]` — Add channel for auto-translation (Admin)
- `/tr_auto remove [channel]` — Remove channel from auto-translation (Admin)
- `/tr_auto list` — List auto-translation channels (Admin)
- `/tr_status` — Show translation configuration

#### Prefix Commands
- `!tr <text>` — Translate text to English
- `!tr` (as reply) — Translate replied message
- `!tr <message_link>` — Translate message from link
- `!tr_status` — Show translation status

### Moderation Commands

#### Slash Commands
- `/warn <user> [reason]` — Warn a user
- `/mute <user> <duration> [reason]` — Timeout a user (e.g., 1h, 30m, 1d)
- `/unmute <user>` — Remove timeout from a user
- `/kick <user> [reason]` — Kick a user
- `/ban <user> [reason]` — Ban a user
- `/unban <user_id>` — Unban a user
- `/warns <user>` — Check user's warnings
- `/clearwarns <user>` — Clear user's warnings (Admin only)
- `/modstats <user>` — Show user's trial stage and history

#### Prefix Commands
All moderation commands work with `!` prefix as well (e.g., `!warn @user reason`)

## Configuration

### config.json Structure

```json
{
  "discord_token": "YOUR_BOT_TOKEN",
  "client_id": "YOUR_BOT_CLIENT_ID",
  "translation": {
    "default_provider": "lingva",
    "providers": {
      "deepl": { "api_key": "" },
      "libretranslate": { "url": "https://libretranslate.com", "api_key": "" },
      "lingva": { "url": "https://lingva.ml" },
      "simplytranslate": { "url": "https://simplytranslate.org" }
    },
    "ignore_numeric_like": true,
    "auto_min_words": 2,
    "max_input_chars": 1800
  },
  "moderation": {
    "log_channel_id": ""
  }
}
```

### Translation Providers

#### DeepL
- High quality translations
- Requires API key (free tier available)
- Get key at: https://www.deepl.com/pro-api

#### LibreTranslate
- Open source, self-hostable
- Public instances available
- Optional API key for rate limiting
- URL: https://libretranslate.com

#### Lingva
- Google Translate proxy
- No API key required
- Fast and reliable
- URL: https://lingva.ml

#### SimplyTranslate
- Meta-translator service
- Free and open source
- URL: https://simplytranslate.org

#### Google Translate
- Fallback provider through Lingva
- Always available as last resort

## Features Details

### Auto-Translation
- Automatically translates messages in configured channels
- Ignores messages that are already in English
- Skips numeric content and short messages
- Respects language blacklist

### Moderation System
- Progressive punishment system
- Automatic ban when threshold reached
- Appeal system with timed cooldowns
- Complete moderation history tracking
- Protection against moderating bots

### Error Handling
- Graceful fallback between translation providers
- Rate limiting protection
- Detailed error logging
- User-friendly error messages

## Database

The bot uses SQLite to store:
- Guild configurations (auto-translate channels, blacklisted languages)
- User moderation history
- Trial stages and warn counts
- Ban appeal dates

Database file is stored in `data/bot.db`

## Permissions Required

### Translation Commands
- Read Messages
- Send Messages
- Embed Links

### Moderation Commands
- Moderate Members (for warn, mute, unmute)
- Kick Members (for kick)
- Ban Members (for ban, unban)
- Manage Guild (for configuration)

## Development

```bash
# Run with auto-reload
npm run dev
```

## License

MIT

## Support

For issues and feature requests, please use the GitHub issue tracker.
