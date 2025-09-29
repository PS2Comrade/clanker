import os
import re
import logging
from typing import List, Optional, Tuple, Union

import discord
from discord import AllowedMentions, app_commands
from discord.ext import commands
from dotenv import load_dotenv

from config_store import ConfigStore
from providers import build_provider_chain, translate_via_chain

load_dotenv()

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("deepl-translate-reply-bot")

# Env config / defaults
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
if not DISCORD_TOKEN:
    raise RuntimeError("DISCORD_TOKEN missing")

DEFAULT_PROVIDER = (os.getenv("DEFAULT_PROVIDER") or "deepl").lower()
DEFAULT_DEEPL_KEY = os.getenv("DEEPL_API_KEY", "").strip()
DEFAULT_LIBRE_URL = os.getenv("LIBRE_URL", "").strip()
DEFAULT_LIBRE_KEY = os.getenv("LIBRE_API_KEY", "").strip()
DEFAULT_LINGVA_URL = os.getenv("LINGVA_URL", "").strip()
DEFAULT_SIMPLY_URL = os.getenv("SIMPLY_URL", "").strip()

ENABLE_DMS = os.getenv("ENABLE_DMS", "false").lower() in ("1", "true", "yes", "on")
MAX_INPUT_CHARS = int(os.getenv("MAX_INPUT_CHARS", "1800"))
SHOW_SOURCE_LANG = os.getenv("SHOW_SOURCE_LANG", "true").lower() in ("1", "true", "yes", "on")

IGNORE_NUMERIC_LIKE = os.getenv("IGNORE_NUMERIC_LIKE", "true").lower() in ("1", "true", "yes", "on")
AUTO_MIN_WORDS = int(os.getenv("AUTO_MIN_WORDS", "2"))
ONLY_WHEN_MENTIONED = os.getenv("ONLY_WHEN_MENTIONED", "false").lower() in ("1", "true", "yes", "on")

ENV_BLACKLIST = {x.strip().upper() for x in os.getenv("BLACKLIST_LANGS", "").split(",") if x.strip()}
APPLY_BLACKLIST_TO_COMMANDS = os.getenv("APPLY_BLACKLIST_TO_COMMANDS", "true").lower() in ("1", "true", "yes", "on")

SKIP_ROMAN_HINDI = os.getenv("SKIP_ROMAN_HINDI", "true").lower() in ("1", "true", "yes", "on")
ROMAN_HINDI_STOPWORDS = [x.strip().lower() for x in os.getenv(
    "ROMAN_HINDI_STOPWORDS",
    "kuch,bhi,apne,apna,apni,hisab,mat,karo,kr,karen,hai,hota,hoti,hote,ye,yaar,bhai,nahi,nahin,kyu,kyun,kya,mera,meri,mere,tera,teri,tere,hum,ham,tha,thi,the,vo,woh,se,ko,mein,me"
).split(",") if x.strip()]
ROMAN_HINDI_MIN_MATCHES = int(os.getenv("ROMAN_HINDI_MIN_MATCHES", "2"))

SYNC_GUILD_ID = int(os.getenv("SYNC_GUILD_ID", "0") or "0")

# Discord client
intents = discord.Intents.default()
intents.guilds = True
intents.messages = True
intents.message_content = True
intents.dm_messages = True
bot = commands.Bot(command_prefix="!", intents=intents)

cfg = ConfigStore()

# Regex stuff
MENTION_RE = re.compile(r"<@!?\d+>")
R_SCORE = re.compile(r"^\s*\d{1,4}\s*/\s*\d{1,4}\s*$")
R_NUMBER = re.compile(r"^\s*[+\-]?\d+(?:[.,]\d+)?\s*%?\s*$")
R_TIME = re.compile(r"^\s*\d{1,2}:\d{2}(:\d{2})?\s*$")
R_DATE = re.compile(r"^\s*\d{1,4}([/\-\.])\d{1,2}\1\d{1,4}\s*$")
R_MIXED_NUM = re.compile(r"^\s*[\d\-\+\(\)\[\]\s]{5,}\s*$")
MSG_LINK = re.compile(r"https?://(?:ptb\.|canary\.)?discord(?:app)?\.com/channels/(?:@me|\d+)/(\d+)/(\d+)", re.IGNORECASE)

def chunk(s: str, size: int = 1900) -> List[str]:
    return [s[i:i+size] for i in range(0, len(s), size)]

def strip_bot_mention(text: str) -> str:
    return MENTION_RE.sub("", text or "").strip()

def looks_numeric_like(t: str) -> bool:
    if not t:
        return True
    tt = t.strip()
    alpha = sum(1 for c in tt if c.isalpha())
    if alpha == 0: return True
    if any(r.fullmatch(tt) for r in (R_SCORE, R_NUMBER, R_TIME, R_DATE, R_MIXED_NUM)):
        return True
    return False

def has_non_ascii_letter(s: str) -> bool:
    return any(ord(c) > 127 and c.isalpha() for c in s)

def word_count(s: str) -> int:
    return len(re.findall(r"\b\w+\b", s, flags=re.UNICODE))

def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()

def ascii_only(s: str) -> bool:
    return all(ord(c) < 128 for c in s)

def is_roman_hindi(s: str) -> bool:
    if not SKIP_ROMAN_HINDI:
        return False
    t = (s or "").lower()
    if not t.strip() or not ascii_only(t):
        return False
    toks = set(re.findall(r"[a-z]+", t))
    hits = sum(1 for w in ROMAN_HINDI_STOPWORDS if w in toks)
    return hits >= ROMAN_HINDI_MIN_MATCHES

async def guild_blacklist(guild_id: Optional[int]) -> set:
    codes = set(ENV_BLACKLIST)
    if guild_id:
        per = await cfg.list_blacklist(guild_id)
        codes.update(per)
    return codes

def skip_reason(text: str, *, force: bool) -> Optional[str]:
    if not text.strip():
        return "blank"
    if len(text) > MAX_INPUT_CHARS:
        return f"too_long:{len(text)}"
    if IGNORE_NUMERIC_LIKE and looks_numeric_like(text):
        return "numeric_like"
    if not force:
        if is_roman_hindi(text):
            return "roman_hindi"
        if word_count(text) < AUTO_MIN_WORDS and not has_non_ascii_letter(text):
            return "low_signal"
    return None

async def translate_pipeline(
    guild_id: Optional[int],
    text: str,
    *,
    force: bool,
    apply_blacklist: bool
) -> Optional[Tuple[str, str, str]]:
    why = skip_reason(text, force=force)
    if why:
        log.debug("Skip (%s): %r", why, text)
        return None

    # Build provider chain from guild settings + env fallback
    provider_settings = {
        "provider": DEFAULT_PROVIDER,
        "deepl_api_key": DEFAULT_DEEPL_KEY,
        "libre_url": DEFAULT_LIBRE_URL,
        "libre_api_key": DEFAULT_LIBRE_KEY,
        "lingva_url": DEFAULT_LINGVA_URL,
        "simply_url": DEFAULT_SIMPLY_URL
    }
    if guild_id:
        st = await cfg.get_settings(guild_id)
        provider_settings.update(st)

    chain = build_provider_chain(provider_settings)
    result = await translate_via_chain(chain, text, "EN-US")
    if not result:
        return None
    provider_name, detected, translated = result

    if apply_blacklist:
        bl = await guild_blacklist(guild_id)
        if detected and detected.upper() in bl:
            log.debug("Skip (blacklist:%s)", detected)
            return None

    if detected.upper().startswith("EN"):
        return None

    if normalize(translated) == normalize(text):
        log.debug("Skip (no_change)")
        return None

    header = f"Translated from {detected.upper()} via {provider_name}:\n" if SHOW_SOURCE_LANG and detected else ""
    return provider_name, detected.upper(), header + translated

async def reply_translation(target_msg: discord.Message, composed: str):
    parts = chunk(composed)
    no_mentions = AllowedMentions.none()
    await target_msg.reply(parts[0], allowed_mentions=no_mentions, mention_author=False)
    for p in parts[1:]:
        await target_msg.channel.send(p, allowed_mentions=no_mentions)

async def fetch_message_by_link(link: str) -> Optional[discord.Message]:
    m = MSG_LINK.search(link)
    if not m:
        return None
    channel_id = int(m.group(1))
    message_id = int(m.group(2))
    channel = bot.get_channel(channel_id)
    if not channel:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception:
            return None
    if not isinstance(channel, (discord.TextChannel, discord.Thread, discord.DMChannel, discord.GroupChannel)):
        return None
    try:
        return await channel.fetch_message(message_id)
    except Exception:
        return None

async def resolve_channel_arg(ctx: commands.Context, arg: Optional[str]) -> Optional[Union[discord.TextChannel, discord.Thread]]:
    if isinstance(ctx.channel, (discord.TextChannel, discord.Thread)) and (arg is None or arg.strip().lower() == "here"):
        return ctx.channel
    if not arg:
        return None
    s = arg.strip()
    m = re.match(r"<#(\d+)>", s)
    if m:
        cid = int(m.group(1))
        ch = ctx.guild.get_channel(cid)
        if isinstance(ch, (discord.TextChannel, discord.Thread)):
            return ch
        return None
    if s.isdigit():
        cid = int(s)
        ch = ctx.guild.get_channel(cid) or await bot.fetch_channel(cid)
        if isinstance(ch, (discord.TextChannel, discord.Thread)):
            return ch
    return None

# Events
@bot.event
async def on_ready():
    await cfg.load()
    log.info("Logged in as %s (%s)", bot.user, bot.user.id if bot.user else "unknown")
    try:
        if SYNC_GUILD_ID:
            guild_obj = discord.Object(id=SYNC_GUILD_ID)
            await bot.tree.sync(guild=guild_obj)
            log.info("Slash commands synced to guild %s", SYNC_GUILD_ID)
        else:
            await bot.tree.sync()
            log.info("Slash commands synced globally (may take up to 1 hour)")
    except Exception as e:
        log.error("Command sync failed: %s", e)

@bot.event
async def on_message(message: discord.Message):
    try:
        if message.author.bot:
            return
        await bot.process_commands(message)

        if isinstance(message.channel, discord.DMChannel) and not ENABLE_DMS:
            return

        guild_id = message.guild.id if message.guild else None
        if message.guild is None:
            return

        if not await cfg.has_channel(guild_id, message.channel.id):
            return

        content = message.content or ""
        if ONLY_WHEN_MENTIONED:
            if not bot.user or bot.user not in message.mentions:
                return
            content = strip_bot_mention(content)

        res = await translate_pipeline(guild_id, content, force=False, apply_blacklist=True)
        if not res:
            return
        _, _, composed = res
        await reply_translation(message, composed)

    except Exception as e:
        log.exception("on_message error: %s", e)

# STATUS

def build_status_embed(
    guild: discord.Guild,
    channels: List[int],
    env_blacklist: set,
    guild_blacklist: List[str],
    heuristics: dict,
    settings_masked: dict
) -> discord.Embed:
    emb = discord.Embed(title="Translation Status", color=0x2b6cb0)
    if channels:
        ch_mentions = []
        for cid in channels:
            ch = guild.get_channel(cid)
            ch_mentions.append(ch.mention if ch else f"<#{cid}>")
        emb.add_field(name="Auto Channels", value=", ".join(ch_mentions), inline=False)
    else:
        emb.add_field(name="Auto Channels", value="(none)", inline=False)

    emb.add_field(name="Env Blacklist", value=", ".join(sorted(env_blacklist)) or "(none)", inline=True)
    emb.add_field(name="Guild Blacklist", value=", ".join(sorted(guild_blacklist)) or "(none)", inline=True)

    heur_val = (
        f"ONLY_WHEN_MENTIONED={heuristics['only_when_mentioned']}\n"
        f"IGNORE_NUMERIC_LIKE={heuristics['ignore_numeric_like']}\n"
        f"AUTO_MIN_WORDS={heuristics['auto_min_words']}\n"
        f"SKIP_ROMAN_HINDI={heuristics['skip_roman_hindi']}"
    )
    emb.add_field(name="Heuristics", value=heur_val, inline=False)

    prov = settings_masked.get("provider", "(default)")
    emb.add_field(name="Provider", value=prov, inline=True)

    for key, label in [
        ("deepl_api_key", "DeepL Key"),
        ("libre_url", "Libre URL"),
        ("lingva_url", "Lingva URL"),
        ("simply_url", "Simply URL")
    ]:
        if key in settings_masked and settings_masked[key]:
            emb.add_field(name=label, value=str(settings_masked[key])[:70], inline=True)

    emb.set_footer(text="Use /tr_settings to adjust. /tr_auto to manage channels.")
    return emb

# Slash Commands

@bot.tree.command(name="tr_status", description="Show translation status for this server")
async def tr_status_slash(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    if not interaction.guild:
        await interaction.followup.send("Run in a server.", ephemeral=True)
        return
    channels = await cfg.list_channels(interaction.guild_id)
    bl_guild = await cfg.list_blacklist(interaction.guild_id)
    st = await cfg.get_settings(interaction.guild_id)
    masked = cfg.masked_settings(st)
    embed = build_status_embed(
        interaction.guild,
        channels,
        ENV_BLACKLIST,
        bl_guild,
        {
            "only_when_mentioned": ONLY_WHEN_MENTIONED,
            "ignore_numeric_like": IGNORE_NUMERIC_LIKE,
            "auto_min_words": AUTO_MIN_WORDS,
            "skip_roman_hindi": SKIP_ROMAN_HINDI
        },
        masked
    )
    await interaction.followup.send(embed=embed, ephemeral=True)

@bot.command(name="tr_status", help="Show translation status (prefix)")
async def tr_status_prefix(ctx: commands.Context):
    if not ctx.guild:
        await ctx.reply("Run in a server.", mention_author=False)
        return
    channels = await cfg.list_channels(ctx.guild.id)
    bl_guild = await cfg.list_blacklist(ctx.guild.id)
    st = await cfg.get_settings(ctx.guild.id)
    masked = cfg.masked_settings(st)
    embed = build_status_embed(
        ctx.guild,
        channels,
        ENV_BLACKLIST,
        bl_guild,
        {
            "only_when_mentioned": ONLY_WHEN_MENTIONED,
            "ignore_numeric_like": IGNORE_NUMERIC_LIKE,
            "auto_min_words": AUTO_MIN_WORDS,
            "skip_roman_hindi": SKIP_ROMAN_HINDI
        },
        masked
    )
    await ctx.reply(embed=embed, mention_author=False)

# Translation commands

@bot.command(name="tr", help="Translate to English (reply / message link / text).")
async def tr_prefix(ctx: commands.Context, *, arg: Optional[str] = None):
    try:
        text = None
        target_msg = None
        if ctx.message.reference and ctx.message.reference.message_id:
            try:
                target_msg = await ctx.channel.fetch_message(ctx.message.reference.message_id)
                text = target_msg.content or ""
            except Exception:
                pass
        if not text and arg:
            maybe = await fetch_message_by_link(arg)
            if maybe:
                target_msg = maybe
                text = maybe.content or ""
        if not text:
            text = (arg or "").strip()
            target_msg = ctx.message
        res = await translate_pipeline(ctx.guild.id if ctx.guild else None, text, force=True,
                                       apply_blacklist=APPLY_BLACKLIST_TO_COMMANDS)
        if not res:
            await ctx.reply("Nothing to translate (filtered or identical).", mention_author=False)
            return
        _, _, composed = res
        await reply_translation(target_msg, composed)
    except Exception as e:
        log.exception("!tr failed: %s", e)
        await ctx.reply("Translation failed.", mention_author=False)

@bot.tree.command(name="tr", description="Translate a message (link) or text.")
@app_commands.describe(message_link="Discord message link", text="Text if no link")
async def tr_slash(interaction: discord.Interaction, message_link: Optional[str] = None, text: Optional[str] = None):
    await interaction.response.defer(ephemeral=True)
    src_text = None
    target_msg = None
    if message_link:
        maybe = await fetch_message_by_link(message_link)
        if maybe:
            target_msg = maybe
            src_text = maybe.content or ""
    if not src_text and text:
        src_text = text
    if not src_text:
        await interaction.followup.send("Provide a message link or text.", ephemeral=True)
        return
    res = await translate_pipeline(interaction.guild_id, src_text, force=True,
                                   apply_blacklist=APPLY_BLACKLIST_TO_COMMANDS)
    if not res:
        await interaction.followup.send("Nothing to translate (filtered or identical).", ephemeral=True)
        return
    _, _, composed = res
    if target_msg:
        await reply_translation(target_msg, composed)
        await interaction.followup.send("Done.", ephemeral=True)
    else:
        await interaction.channel.send(composed, allowed_mentions=AllowedMentions.none())
        await interaction.followup.send("Sent.", ephemeral=True)

# Context menu
@bot.tree.context_menu(name="Translate to English")
async def translate_message_ctx(interaction: discord.Interaction, message: discord.Message):
    await interaction.response.defer(ephemeral=True)
    res = await translate_pipeline(interaction.guild_id, message.content or "", force=True,
                                   apply_blacklist=APPLY_BLACKLIST_TO_COMMANDS)
    if not res:
        await interaction.followup.send("Nothing to translate (filtered or identical).", ephemeral=True)
        return
    _, _, composed = res
    await reply_translation(message, composed)
    await interaction.followup.send("Done.", ephemeral=True)

# Auto channel management (slash + prefix)

class AutoGroup(app_commands.Group):
    def __init__(self):
        super().__init__(name="tr_auto", description="Manage auto-translate channels")

    async def _perm(self, interaction: discord.Interaction) -> bool:
        perms = getattr(interaction.user, "guild_permissions", None)
        if perms and (perms.manage_guild or perms.administrator):
            return True
        await interaction.response.send_message("Need Manage Server permission.", ephemeral=True)
        return False

    @app_commands.command(name="add", description="Enable auto in channel (defaults current)")
    async def add(self, interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None):
        if not await self._perm(interaction): return
        ch = channel or interaction.channel
        if not isinstance(ch, (discord.TextChannel, discord.Thread)):
            await interaction.response.send_message("Not a text channel.", ephemeral=True)
            return
        await cfg.add_channel(interaction.guild_id, ch.id)
        await interaction.response.send_message(f"Enabled in {ch.mention}", ephemeral=True)

    @app_commands.command(name="remove", description="Disable auto in channel (defaults current)")
    async def remove(self, interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None):
        if not await self._perm(interaction): return
        ch = channel or interaction.channel
        if not isinstance(ch, (discord.TextChannel, discord.Thread)):
            await interaction.response.send_message("Not a text channel.", ephemeral=True)
            return
        await cfg.remove_channel(interaction.guild_id, ch.id)
        await interaction.response.send_message(f"Disabled in {ch.mention}", ephemeral=True)

    @app_commands.command(name="list", description="List auto channels")
    async def list(self, interaction: discord.Interaction):
        if not await self._perm(interaction): return
        ids = await cfg.list_channels(interaction.guild_id)
        if not ids:
            await interaction.response.send_message("None.", ephemeral=True)
            return
        out = []
        for cid in ids:
            ch = interaction.guild.get_channel(cid)
            out.append(ch.mention if ch else f"<#{cid}>")
        await interaction.response.send_message("Channels: " + ", ".join(out), ephemeral=True)

bot.tree.add_command(AutoGroup())

@bot.group(name="tr_auto", invoke_without_command=True)
@commands.has_guild_permissions(manage_guild=True)
async def tr_auto_group(ctx: commands.Context):
    await ctx.reply("Usage: !tr_auto add [here|#ch|id] | remove [here|#ch|id] | list", mention_author=False)

@tr_auto_group.command(name="add")
@commands.has_guild_permissions(manage_guild=True)
async def tr_auto_add(ctx: commands.Context, channel: Optional[str] = None):
    ch = await resolve_channel_arg(ctx, channel)
    if not ch:
        await ctx.reply("Channel?", mention_author=False)
        return
    await cfg.add_channel(ctx.guild.id, ch.id)
    await ctx.reply(f"Enabled in {ch.mention}", mention_author=False)

@tr_auto_group.command(name="remove")
@commands.has_guild_permissions(manage_guild=True)
async def tr_auto_remove(ctx: commands.Context, channel: Optional[str] = None):
    ch = await resolve_channel_arg(ctx, channel)
    if not ch:
        await ctx.reply("Channel?", mention_author=False)
        return
    await cfg.remove_channel(ctx.guild.id, ch.id)
    await ctx.reply(f"Disabled in {ch.mention}", mention_author=False)

@tr_auto_group.command(name="list")
@commands.has_guild_permissions(manage_guild=True)
async def tr_auto_list(ctx: commands.Context):
    ids = await cfg.list_channels(ctx.guild.id)
    if not ids:
        await ctx.reply("None.", mention_author=False)
        return
    out = []
    for cid in ids:
        ch = ctx.guild.get_channel(cid)
        out.append(ch.mention if ch else f"<#{cid}>")
    await ctx.reply("Channels: " + ", ".join(out), mention_author=False)

# Blacklist
class BlacklistGroup(app_commands.Group):
    def __init__(self):
        super().__init__(name="tr_blacklist", description="Manage language blacklist")

    async def _perm(self, interaction: discord.Interaction) -> bool:
        perms = getattr(interaction.user, "guild_permissions", None)
        if perms and (perms.manage_guild or perms.administrator):
            return True
        await interaction.response.send_message("Need Manage Server permission.", ephemeral=True)
        return False

    @app_commands.command(name="add")
    async def add(self, interaction: discord.Interaction, code: str):
        if not await self._perm(interaction): return
        await cfg.add_blacklist(interaction.guild_id, code)
        await interaction.response.send_message(f"Added {code.upper()}", ephemeral=True)

    @app_commands.command(name="remove")
    async def remove(self, interaction: discord.Interaction, code: str):
        if not await self._perm(interaction): return
        await cfg.remove_blacklist(interaction.guild_id, code)
        await interaction.response.send_message(f"Removed {code.upper()}", ephemeral=True)

    @app_commands.command(name="list")
    async def list(self, interaction: discord.Interaction):
        if not await self._perm(interaction): return
        per = await cfg.list_blacklist(interaction.guild_id)
        await interaction.response.send_message("Guild blacklist: " + (", ".join(per) or "(none)"), ephemeral=True)

bot.tree.add_command(BlacklistGroup())

# Settings group (providers & keys)
class SettingsGroup(app_commands.Group):
    def __init__(self):
        super().__init__(name="tr_settings", description="Configure translation provider & keys")

    async def _perm(self, interaction: discord.Interaction) -> bool:
        perms = getattr(interaction.user, "guild_permissions", None)
        if perms and (perms.manage_guild or perms.administrator):
            return True
        await interaction.response.send_message("Need Manage Server permission.", ephemeral=True)
        return False

    @app_commands.command(name="show", description="Show masked provider settings")
    async def show(self, interaction: discord.Interaction):
        if not await self._perm(interaction): return
        st = await cfg.get_settings(interaction.guild_id)
        masked = cfg.masked_settings(st)
        if not masked:
            await interaction.response.send_message("No custom settings; using defaults.", ephemeral=True)
            return
        lines = [f"{k}={v}" for k, v in masked.items()]
        await interaction.response.send_message("Settings:\n" + "\n".join(lines), ephemeral=True)

    @app_commands.command(name="set-provider", description="Set provider (deepl|libre|lingva|simply)")
    async def set_provider(self, interaction: discord.Interaction, provider: str):
        if not await self._perm(interaction): return
        provider = provider.lower()
        if provider not in ("deepl", "libre", "lingva", "simply"):
            await interaction.response.send_message("Invalid provider.", ephemeral=True)
            return
        await cfg.update_settings(interaction.guild_id, provider=provider)
        await interaction.response.send_message(f"Provider set to {provider}", ephemeral=True)

    @app_commands.command(name="set-deepl-key", description="Set DeepL API key")
    async def set_deepl_key(self, interaction: discord.Interaction, key: str):
        if not await self._perm(interaction): return
        await cfg.update_settings(interaction.guild_id, deepl_api_key=key.strip())
        await interaction.response.send_message("DeepL key updated (masked in status).", ephemeral=True)

    @app_commands.command(name="set-libre-url", description="Set LibreTranslate base URL")
    async def set_libre_url(self, interaction: discord.Interaction, url: str):
        if not await self._perm(interaction): return
        await cfg.update_settings(interaction.guild_id, libre_url=url.strip())
        await interaction.response.send_message("Libre URL set.", ephemeral=True)

    @app_commands.command(name="set-libre-key", description="Set LibreTranslate API key (optional)")
    async def set_libre_key(self, interaction: discord.Interaction, key: str):
        if not await self._perm(interaction): return
        await cfg.update_settings(interaction.guild_id, libre_api_key=key.strip())
        await interaction.response.send_message("Libre key updated.", ephemeral=True)

    @app_commands.command(name="set-lingva-url", description="Set Lingva instance URL")
    async def set_lingva_url(self, interaction: discord.Interaction, url: str):
        if not await self._perm(interaction): return
        await cfg.update_settings(interaction.guild_id, lingva_url=url.strip())
        await interaction.response.send_message("Lingva URL set.", ephemeral=True)

    @app_commands.command(name="set-simply-url", description="Set SimplyTranslate instance URL")
    async def set_simply_url(self, interaction: discord.Interaction, url: str):
        if not await self._perm(interaction): return
        await cfg.update_settings(interaction.guild_id, simply_url=url.strip())
        await interaction.response.send_message("Simply URL set.", ephemeral=True)

bot.tree.add_command(SettingsGroup())

# Prefix equivalents (minimal)
@bot.group(name="tr_settings", invoke_without_command=True)
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_group(ctx: commands.Context):
    await ctx.reply("Subcommands: provider <name> | deepl_key <key> | libre_url <url> | libre_key <key> | lingva_url <url> | simply_url <url>", mention_author=False)

@tr_settings_group.command(name="provider")
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_provider(ctx: commands.Context, provider: str):
    provider = provider.lower()
    if provider not in ("deepl", "libre", "lingva", "simply"):
        await ctx.reply("Invalid provider.", mention_author=False)
        return
    await cfg.update_settings(ctx.guild.id, provider=provider)
    await ctx.reply(f"Provider set to {provider}", mention_author=False)

@tr_settings_group.command(name="deepl_key")
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_deepl_key(ctx: commands.Context, *, key: str):
    await cfg.update_settings(ctx.guild.id, deepl_api_key=key.strip())
    await ctx.reply("DeepL key set.", mention_author=False)

@tr_settings_group.command(name="libre_url")
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_libre_url(ctx: commands.Context, *, url: str):
    await cfg.update_settings(ctx.guild.id, libre_url=url.strip())
    await ctx.reply("Libre URL set.", mention_author=False)

@tr_settings_group.command(name="libre_key")
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_libre_key(ctx: commands.Context, *, key: str):
    await cfg.update_settings(ctx.guild.id, libre_api_key=key.strip())
    await ctx.reply("Libre key set.", mention_author=False)

@tr_settings_group.command(name="lingva_url")
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_lingva_url(ctx: commands.Context, *, url: str):
    await cfg.update_settings(ctx.guild.id, lingva_url=url.strip())
    await ctx.reply("Lingva URL set.", mention_author=False)

@tr_settings_group.command(name="simply_url")
@commands.has_guild_permissions(manage_guild=True)
async def tr_settings_simply_url(ctx: commands.Context, *, url: str):
    await cfg.update_settings(ctx.guild.id, simply_url=url.strip())
    await ctx.reply("Simply URL set.", mention_author=False)


if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)