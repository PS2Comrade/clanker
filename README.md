# Clanker bot


## Commands

### Slash
- `/tr_status` — show embed status.
- `/tr` — translate text or message link.
- Context menu “Translate to English”.
- `/tr_auto add|remove|list`
- `/tr_blacklist add|remove|list`
- `/tr_settings show`
- `/tr_settings set-provider <name>`
- `/tr_settings set-deepl-key <key>`
- `/tr_settings set-libre-url <url>`
- `/tr_settings set-libre-key <key>`
- `/tr_settings set-lingva-url <url>`
- `/tr_settings set-simply-url <url>`

### Prefix
- `!tr <text|message_link>` or reply and `!tr`
- `!tr_auto add|remove|list`
- `!tr_status`
- `!tr_settings provider <name>`
- `!tr_settings deepl_key <key>`
- `!tr_settings libre_url <url>` etc.

## Provider Notes
- DeepL: high quality, requires API key.
- LibreTranslate: self-host or public instance; slower, free.
- Lingva: front-end to Google Translate; accuracy good, availability varies.
- SimplyTranslate: meta service; endpoints differ slightly by deployment.
