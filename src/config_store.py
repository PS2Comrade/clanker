import asyncio
import json
import os
import tempfile
import logging
from typing import Dict, List, Optional

log = logging.getLogger("deepl-translate-reply-bot.config")

# JSON structure:
# {
#   "guilds": { "<guild_id>": ["<channel_id>", ...] },
#   "blacklist": { "<guild_id>": ["ID","ET"] },
#   "settings": {
#       "<guild_id>": {
#           "provider": "deepl",
#           "deepl_api_key": "...",
#           "libre_url": "...",
#           "libre_api_key": "...",
#           "lingva_url": "...",
#           "simply_url": "..."
#       }
#   }
# }

_DEFAULT: Dict[str, dict] = {
    "guilds": {},
    "blacklist": {},
    "settings": {}
}
_LOCK = asyncio.Lock()

SENSITIVE_KEYS = {"deepl_api_key", "libre_api_key"}

class ConfigStore:
    def __init__(self, path: str = "config.json"):
        self.path = path
        self.data = dict(_DEFAULT)

    async def load(self) -> None:
        async with _LOCK:
            if not os.path.exists(self.path):
                self.data = dict(_DEFAULT)
                return
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
                for key in _DEFAULT:
                    if key not in self.data or not isinstance(self.data[key], dict):
                        self.data[key] = _DEFAULT[key]
            except Exception as e:
                log.error("Failed to load %s: %s", self.path, e)
                self.data = dict(_DEFAULT)

    async def save(self) -> None:
        async with _LOCK:
            dirpath = os.path.dirname(self.path) or "."
            os.makedirs(dirpath, exist_ok=True)
            tmp_fd, tmp_path = tempfile.mkstemp(prefix=".cfg-", suffix=".json.tmp", dir=dirpath)
            try:
                with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                    json.dump(self.data, f, ensure_ascii=False, indent=2)
                os.replace(tmp_path, self.path)
            except Exception as e:
                log.error("Failed to save config to %s (tmp %s): %s", self.path, tmp_path, e)
                try:
                    with open(self.path, "w", encoding="utf-8") as f:
                        json.dump(self.data, f, ensure_ascii=False, indent=2)
                except Exception as e2:
                    log.error("Fallback save failed for %s: %s", self.path, e2)
            finally:
                try:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                except Exception:
                    pass

    def _g(self, guild_id: int) -> str:
        return str(guild_id)

    # Auto-translate channels
    async def list_channels(self, guild_id: int) -> List[int]:
        arr = self.data.get("guilds", {}).get(self._g(guild_id), [])
        return [int(x) for x in arr]

    async def add_channel(self, guild_id: int, channel_id: int) -> None:
        g = self._g(guild_id)
        self.data.setdefault("guilds", {})
        self.data["guilds"].setdefault(g, [])
        if str(channel_id) not in self.data["guilds"][g]:
            self.data["guilds"][g].append(str(channel_id))
        await self.save()

    async def remove_channel(self, guild_id: int, channel_id: int) -> None:
        g = self._g(guild_id)
        arr = self.data.get("guilds", {}).get(g, [])
        self.data["guilds"][g] = [x for x in arr if x != str(channel_id)]
        await self.save()

    async def has_channel(self, guild_id: int, channel_id: int) -> bool:
        g = self._g(guild_id)
        arr = self.data.get("guilds", {}).get(g, [])
        return str(channel_id) in arr

    # Blacklist
    async def list_blacklist(self, guild_id: int) -> List[str]:
        return [x.upper() for x in self.data.get("blacklist", {}).get(self._g(guild_id), [])]

    async def add_blacklist(self, guild_id: int, code: str) -> None:
        code = code.upper().strip()
        if not code:
            return
        g = self._g(guild_id)
        self.data.setdefault("blacklist", {})
        self.data["blacklist"].setdefault(g, [])
        if code not in self.data["blacklist"][g]:
            self.data["blacklist"][g].append(code)
        await self.save()

    async def remove_blacklist(self, guild_id: int, code: str) -> None:
        code = code.upper().strip()
        g = self._g(guild_id)
        arr = self.data.get("blacklist", {}).get(g, [])
        self.data["blacklist"][g] = [x for x in arr if x != code]
        await self.save()

    # Settings (per guild)
    async def get_settings(self, guild_id: int) -> dict:
        g = self._g(guild_id)
        self.data.setdefault("settings", {})
        self.data["settings"].setdefault(g, {})
        return self.data["settings"][g]

    async def update_settings(self, guild_id: int, **kwargs) -> dict:
        st = await self.get_settings(guild_id)
        for k, v in kwargs.items():
            if v is None:
                continue
            st[k] = v
        await self.save()
        return st

    def masked_settings(self, st: dict) -> dict:
        out = {}
        for k, v in st.items():
            if k in SENSITIVE_KEYS and isinstance(v, str) and v:
                out[k] = v[:4] + "…" + str(len(v))
            else:
                out[k] = v
        return out