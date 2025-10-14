# Quick Start Guide

Get Clanker bot up and running in minutes!

## 🚀 5-Minute Setup

### 1. Prerequisites
- Node.js 18 or higher
- A Discord bot token ([Get one here](https://discord.com/developers/applications))

### 2. Install

```bash
# Clone or download the repository
git clone https://github.com/PS2Comrade/clanker.git
cd clanker

# Install dependencies
npm install
```

### 3. Configure

Create a `.env` file or edit `config.json`:

**Option A: Using .env file** (recommended)
```bash
cp .env.example .env
# Edit .env and add your token
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
```

**Option B: Using config.json**
```json
{
  "discord_token": "YOUR_BOT_TOKEN",
  "client_id": "YOUR_CLIENT_ID"
}
```

### 4. Run

```bash
npm start
```

You should see:
```
🚀 Starting Clanker bot...
✅ Logged in as YourBot#1234
📊 Serving X guilds
Database initialized successfully
Successfully registered 12 application commands.
🤖 Bot is ready!
```

## 🎯 Test It Works

In Discord:
1. Type `/tr` - You should see the translation command
2. Type `/warn` - You should see the warn command
3. Type `!tr hello` - Should respond with translation

## ⚙️ Configuration Options

### Translation Providers

Edit `config.json` to configure translation providers:

```json
{
  "translation": {
    "providers": {
      "lingva": {
        "url": "https://lingva.ml"
      },
      "libretranslate": {
        "url": "https://libretranslate.com",
        "api_key": ""
      },
      "deepl": {
        "api_key": ""
      }
    }
  }
}
```

**No API keys required!** The bot works with free providers by default.

### Optional: DeepL (Better Quality)

1. Get a free API key: https://www.deepl.com/pro-api
2. Add to config:
```json
"deepl": {
  "api_key": "your_deepl_key_here"
}
```

## 📝 Basic Commands

### For Everyone
- `/tr [text]` - Translate text to English
- `!tr [text]` - Same as above (prefix version)
- `/warns @user` - Check user's warnings
- `/modstats @user` - View user's moderation stats

### For Moderators
- `/warn @user [reason]` - Warn a user
- `/mute @user <duration> [reason]` - Timeout (e.g., `1h`, `30m`)
- `/kick @user [reason]` - Kick a user
- `/ban @user [reason]` - Ban a user

### For Admins
- `/tr_auto add` - Enable auto-translation in current channel
- `/tr_auto list` - Show auto-translate channels
- `/clearwarns @user` - Reset user's warnings

## 🔧 Troubleshooting

### Commands not showing?
1. Make sure `CLIENT_ID` is set in config
2. Wait a few minutes for Discord to sync
3. Restart the bot

### Bot not responding?
1. Check the console for errors
2. Verify bot has required permissions:
   - Read Messages
   - Send Messages
   - Embed Links
   - Moderate Members (for moderation)

### Translation not working?
- The bot tries multiple providers automatically
- Check console for provider errors
- Consider adding a DeepL API key for better results

## 🎮 Next Steps

1. **Set up auto-translation**: `/tr_auto add` in your desired channels
2. **Configure moderation**: Use `/warn` to test the 3-trial system
3. **Customize settings**: Edit `config.json` for advanced options

## 📚 Full Documentation

See [README.md](README.md) for complete documentation including:
- All commands and features
- 3-trial moderation system details
- Translation provider setup
- Database structure
- Development guide

## ❓ Need Help?

- Check [MIGRATION.md](MIGRATION.md) if upgrading from Python version
- Open an issue on GitHub for bugs
- Read the full README for detailed information

## 🧪 Running Tests

Verify everything works:
```bash
npm test
```

All tests should pass with a green checkmark! ✅
