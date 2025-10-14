import axios from 'axios';

const TIMEOUT = 10000;

// Provider health cache (simple in-memory)
const healthCache = new Map();
const HEALTH_CACHE_TTL = 300000; // 5 minutes

// Rate limiting
const rateLimiters = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // max requests per window

function checkRateLimit(providerName) {
  const now = Date.now();
  if (!rateLimiters.has(providerName)) {
    rateLimiters.set(providerName, []);
  }
  const requests = rateLimiters.get(providerName);
  const recent = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  rateLimiters.set(providerName, recent);
  
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  return true;
}

function setHealthStatus(provider, healthy) {
  healthCache.set(provider, { healthy, timestamp: Date.now() });
}

function getHealthStatus(provider) {
  const cached = healthCache.get(provider);
  if (!cached) return { healthy: true, timestamp: 0 };
  if (Date.now() - cached.timestamp > HEALTH_CACHE_TTL) {
    return { healthy: true, timestamp: 0 };
  }
  return cached;
}

// DeepL Provider
export async function translateWithDeepL(text, targetLang, apiKey) {
  if (!apiKey) return null;
  if (!checkRateLimit('deepl')) return null;
  
  const health = getHealthStatus('deepl');
  if (!health.healthy) return null;
  
  try {
    const response = await axios.post(
      'https://api-free.deepl.com/v2/translate',
      new URLSearchParams({
        text,
        target_lang: targetLang.toUpperCase(),
        auth_key: apiKey
      }),
      { timeout: TIMEOUT }
    );
    
    if (response.data.translations && response.data.translations[0]) {
      const translation = response.data.translations[0];
      setHealthStatus('deepl', true);
      return {
        text: translation.text,
        detectedLanguage: translation.detected_source_language || 'UNKNOWN',
        provider: 'DeepL'
      };
    }
    return null;
  } catch (error) {
    console.error('DeepL translation error:', error.message);
    setHealthStatus('deepl', false);
    return null;
  }
}

// LibreTranslate Provider
export async function translateWithLibreTranslate(text, targetLang, baseUrl, apiKey) {
  if (!baseUrl) return null;
  if (!checkRateLimit('libretranslate')) return null;
  
  const health = getHealthStatus('libretranslate');
  if (!health.healthy) return null;
  
  try {
    const target = targetLang.split('-')[0].toLowerCase();
    
    // Detect language first
    let detectedLang = 'UNKNOWN';
    try {
      const detectPayload = { q: text };
      if (apiKey) detectPayload.api_key = apiKey;
      
      const detectResponse = await axios.post(
        `${baseUrl}/detect`,
        detectPayload,
        { timeout: TIMEOUT }
      );
      
      if (detectResponse.data && Array.isArray(detectResponse.data) && detectResponse.data[0]) {
        detectedLang = detectResponse.data[0].language.toUpperCase();
      }
    } catch (e) {
      // Ignore detection errors
    }
    
    // Translate
    const translatePayload = {
      q: text,
      source: 'auto',
      target,
      format: 'text'
    };
    if (apiKey) translatePayload.api_key = apiKey;
    
    const response = await axios.post(
      `${baseUrl}/translate`,
      translatePayload,
      { timeout: TIMEOUT }
    );
    
    if (response.data && response.data.translatedText) {
      setHealthStatus('libretranslate', true);
      return {
        text: response.data.translatedText,
        detectedLanguage: detectedLang,
        provider: 'LibreTranslate'
      };
    }
    return null;
  } catch (error) {
    console.error('LibreTranslate error:', error.message);
    setHealthStatus('libretranslate', false);
    return null;
  }
}

// Lingva Provider
export async function translateWithLingva(text, targetLang, baseUrl) {
  if (!baseUrl) return null;
  if (!checkRateLimit('lingva')) return null;
  
  const health = getHealthStatus('lingva');
  if (!health.healthy) return null;
  
  try {
    const target = targetLang.split('-')[0].toLowerCase();
    const encodedText = encodeURIComponent(text);
    
    const response = await axios.get(
      `${baseUrl}/api/v1/auto/${target}/${encodedText}`,
      { timeout: TIMEOUT }
    );
    
    if (response.data && response.data.translation) {
      const info = response.data.info || {};
      const detected = (info.detectedSource || info.source || '').toUpperCase();
      setHealthStatus('lingva', true);
      return {
        text: response.data.translation,
        detectedLanguage: detected || 'UNKNOWN',
        provider: 'Lingva'
      };
    }
    return null;
  } catch (error) {
    console.error('Lingva error:', error.message);
    setHealthStatus('lingva', false);
    return null;
  }
}

// SimplyTranslate Provider
export async function translateWithSimplyTranslate(text, targetLang, baseUrl) {
  if (!baseUrl) return null;
  if (!checkRateLimit('simplytranslate')) return null;
  
  const health = getHealthStatus('simplytranslate');
  if (!health.healthy) return null;
  
  try {
    const target = targetLang.split('-')[0].toLowerCase();
    
    const response = await axios.get(`${baseUrl}/api/translate`, {
      params: {
        engine: 'google',
        from: 'auto',
        to: target,
        text
      },
      timeout: TIMEOUT
    });
    
    if (response.data && response.data.translated_text) {
      setHealthStatus('simplytranslate', true);
      return {
        text: response.data.translated_text,
        detectedLanguage: (response.data.source_language || '').toUpperCase() || 'UNKNOWN',
        provider: 'SimplyTranslate'
      };
    }
    return null;
  } catch (error) {
    console.error('SimplyTranslate error:', error.message);
    setHealthStatus('simplytranslate', false);
    return null;
  }
}

// Google Translate (via Lingva as fallback)
export async function translateWithGoogle(text, targetLang) {
  // Use Lingva's public instance as Google Translate proxy
  return translateWithLingva(text, targetLang, 'https://lingva.ml');
}

// Main translation function with fallback chain
export async function translate(text, targetLang = 'en', config = {}) {
  const providers = [];
  
  // Build provider chain based on config
  if (config.deepl?.api_key) {
    providers.push(() => translateWithDeepL(text, targetLang, config.deepl.api_key));
  }
  
  if (config.lingva?.url) {
    providers.push(() => translateWithLingva(text, targetLang, config.lingva.url));
  }
  
  if (config.libretranslate?.url) {
    providers.push(() => translateWithLibreTranslate(
      text,
      targetLang,
      config.libretranslate.url,
      config.libretranslate.api_key
    ));
  }
  
  if (config.simplytranslate?.url) {
    providers.push(() => translateWithSimplyTranslate(text, targetLang, config.simplytranslate.url));
  }
  
  // Always add Google Translate as final fallback
  providers.push(() => translateWithGoogle(text, targetLang));
  
  // Try each provider in order
  for (const provider of providers) {
    try {
      const result = await provider();
      if (result) {
        return result;
      }
    } catch (error) {
      console.error('Provider failed:', error.message);
      continue;
    }
  }
  
  return null;
}
