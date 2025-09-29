import abc
import asyncio
import json
import logging
import urllib.parse
from typing import Optional, Tuple

import deepl
import httpx

log = logging.getLogger("deepl-translate-reply-bot.providers")

# Generic (detected_lang, translated_text) return semantics
# detected_lang should be UPPER (two letters typical) or '' if unknown.

class TranslationProvider(abc.ABC):
    name: str

    @abc.abstractmethod
    async def translate(self, text: str, target_lang: str) -> Optional[Tuple[str, str]]:
        """
        Return (detected_lang, translated_text) or None on failure.
        Raise nothing; swallow internally & log.
        """

    @abc.abstractmethod
    def is_configured(self) -> bool:
        """Return True if provider has minimal config (key/url as needed)."""

class DeepLProvider(TranslationProvider):
    name = "deepl"

    def __init__(self, api_key: Optional[str]):
        self.api_key = (api_key or "").strip()
        self._translator = None
        if self.api_key:
            try:
                self._translator = deepl.Translator(self.api_key)
            except Exception as e:
                log.error("Failed to init DeepL translator: %s", e)

    def is_configured(self) -> bool:
        return bool(self._translator)

    async def translate(self, text: str, target_lang: str) -> Optional[Tuple[str, str]]:
        if not self._translator:
            return None
        loop = asyncio.get_event_loop()
        try:
            # Run blocking DeepL call in executor
            result = await loop.run_in_executor(
                None,
                lambda: self._translator.translateText(
                    text,
                    target_lang=target_lang,
                    preserve_formatting=True,
                    formality="prefer_less",
                )
            )
            detected = (result.detected_source_lang or "").upper()
            translated = result.text or ""
            return detected, translated
        except Exception as e:
            log.warning("DeepL translate failed: %s", e)
            return None

class LibreTranslateProvider(TranslationProvider):
    name = "libre"

    def __init__(self, base_url: Optional[str], api_key: Optional[str]):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = (api_key or "").strip()

    def is_configured(self) -> bool:
        return bool(self.base_url)

    async def translate(self, text: str, target_lang: str) -> Optional[Tuple[str, str]]:
        if not self.is_configured():
            return None
        target = target_lang.split("-")[0].lower()  # libre uses short codes
        async with httpx.AsyncClient(timeout=10) as client:
            # Detect
            detected_lang = ""
            try:
                det_payload = {"q": text}
                if self.api_key:
                    det_payload["api_key"] = self.api_key
                det_r = await client.post(f"{self.base_url}/detect", data=det_payload)
                if det_r.status_code == 200:
                    det_json = det_r.json()
                    # [{'language':'xx','confidence':...}, ...]
                    if det_json and isinstance(det_json, list):
                        detected_lang = (det_json[0].get("language") or "").upper()
            except Exception as e:
                log.debug("Libre detect failed: %s", e)

            try:
                tx_payload = {
                    "q": text,
                    "source": "auto",
                    "target": target,
                    "format": "text"
                }
                if self.api_key:
                    tx_payload["api_key"] = self.api_key
                r = await client.post(f"{self.base_url}/translate", data=tx_payload)
                if r.status_code != 200:
                    log.warning("LibreTranslate non-200: %s %s", r.status_code, r.text[:200])
                    return None
                data = r.json()
                translated = data.get("translatedText", "")
                return detected_lang, translated
            except Exception as e:
                log.warning("LibreTranslate failed: %s", e)
                return None

class LingvaProvider(TranslationProvider):
    name = "lingva"

    def __init__(self, base_url: Optional[str]):
        self.base_url = (base_url or "").rstrip("/")

    def is_configured(self) -> bool:
        return bool(self.base_url)

    async def translate(self, text: str, target_lang: str) -> Optional[Tuple[str, str]]:
        """
        Lingva: GET /api/v1/<source>/<target>/<query>
        Use source=auto for detection.
        JSON: { "translation": "...", "info": { "detectedSource": "..."} } (varies by instance)
        """
        if not self.is_configured():
            return None
        target = target_lang.split("-")[0].lower()
        query = urllib.parse.quote(text, safe="")
        url = f"{self.base_url}/api/v1/auto/{target}/{query}"
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                r = await client.get(url)
                if r.status_code != 200:
                    log.warning("Lingva non-200: %s %s", r.status_code, r.text[:160])
                    return None
                data = r.json()
                translated = data.get("translation", "")
                info = data.get("info") or {}
                detected = (info.get("detectedSource") or info.get("source") or "").upper()
                return detected, translated
            except Exception as e:
                log.warning("Lingva failed: %s", e)
                return None

class SimplyTranslateProvider(TranslationProvider):
    name = "simply"

    def __init__(self, base_url: Optional[str]):
        self.base_url = (base_url or "").rstrip("/")

    def is_configured(self) -> bool:
        return bool(self.base_url)

    async def translate(self, text: str, target_lang: str) -> Optional[Tuple[str, str]]:
        """
        SimplyTranslate API can vary by deployment. Common pattern:
        POST {base}/api/translate  JSON: { "from":"auto","to":"en","text":"..." }
        Response: { "translation":"...", "detected":"xx" } or similar.
        """
        if not self.is_configured():
            return None
        target = target_lang.split("-")[0].lower()
        payload = {"from": "auto", "to": target, "text": text}
        async with httpx.AsyncClient(timeout=12) as client:
            try:
                r = await client.post(f"{self.base_url}/api/translate", json=payload)
                if r.status_code != 200:
                    log.warning("SimplyTranslate non-200: %s %s", r.status_code, r.text[:160])
                    return None
                data = r.json()
                # Try some keys
                translated = data.get("translation") or data.get("result") or ""
                detected = (data.get("detected") or data.get("source") or "").upper()
                return detected, translated
            except Exception as e:
                log.warning("SimplyTranslate failed: %s", e)
                return None


def build_provider_chain(cfg: dict) -> list:
    """
    cfg = {
       'deepl_api_key': str,
       'libre_url': str, 'libre_api_key': str,
       'lingva_url': str,
       'simply_url': str,
       'provider': 'deepl' | 'libre' | 'lingva' | 'simply'
    }
    Build prioritized chain: selected provider first, then others with config.
    """
    selected = (cfg.get("provider") or "deepl").lower()
    p_deepl = DeepLProvider(cfg.get("deepl_api_key"))
    p_libre = LibreTranslateProvider(cfg.get("libre_url"), cfg.get("libre_api_key"))
    p_lingva = LingvaProvider(cfg.get("lingva_url"))
    p_simply = SimplyTranslateProvider(cfg.get("simply_url"))

    all_map = {
        "deepl": p_deepl,
        "libre": p_libre,
        "lingva": p_lingva,
        "simply": p_simply
    }
    order = [selected] + [k for k in all_map.keys() if k != selected]
    chain = []
    for name in order:
        prov = all_map[name]
        if prov.is_configured():
            chain.append(prov)
    # If none configured, still keep selected (will fail fast) to surface config need
    if not chain:
        chain.append(all_map[selected])
    return chain

async def translate_via_chain(chain, text: str, target_lang: str) -> Optional[Tuple[str, str, str]]:
    """
    Iterate providers until success. Return (provider_name, detected, translated).
    """
    for prov in chain:
        res = await prov.translate(text, target_lang)
        if res and res[1].strip():
            detected, translated = res
            return prov.name, detected, translated
    return None