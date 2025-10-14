import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, '../../data/bot.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
export function initDatabase() {
  // Guild configuration table
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      auto_translate_channels TEXT DEFAULT '[]',
      blacklisted_languages TEXT DEFAULT '[]',
      translation_provider TEXT DEFAULT 'lingva',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // User moderation history
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_moderation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(guild_id, user_id, id)
    )
  `);

  // User trial stages
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_trials (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      trial_stage INTEGER DEFAULT 1,
      warn_count INTEGER DEFAULT 0,
      ban_appeal_date INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  console.log('Database initialized successfully');
}

// Guild configuration queries
export const guildConfig = {
  get: (guildId) => {
    const stmt = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?');
    const result = stmt.get(guildId);
    if (result) {
      result.auto_translate_channels = JSON.parse(result.auto_translate_channels);
      result.blacklisted_languages = JSON.parse(result.blacklisted_languages);
    }
    return result || {
      guild_id: guildId,
      auto_translate_channels: [],
      blacklisted_languages: [],
      translation_provider: 'lingva'
    };
  },

  set: (guildId, config) => {
    const stmt = db.prepare(`
      INSERT INTO guild_config (guild_id, auto_translate_channels, blacklisted_languages, translation_provider)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        auto_translate_channels = excluded.auto_translate_channels,
        blacklisted_languages = excluded.blacklisted_languages,
        translation_provider = excluded.translation_provider
    `);
    stmt.run(
      guildId,
      JSON.stringify(config.auto_translate_channels || []),
      JSON.stringify(config.blacklisted_languages || []),
      config.translation_provider || 'lingva'
    );
  },

  addAutoTranslateChannel: (guildId, channelId) => {
    const config = guildConfig.get(guildId);
    if (!config.auto_translate_channels.includes(channelId)) {
      config.auto_translate_channels.push(channelId);
      guildConfig.set(guildId, config);
    }
  },

  removeAutoTranslateChannel: (guildId, channelId) => {
    const config = guildConfig.get(guildId);
    config.auto_translate_channels = config.auto_translate_channels.filter(id => id !== channelId);
    guildConfig.set(guildId, config);
  },

  addBlacklistedLanguage: (guildId, langCode) => {
    const config = guildConfig.get(guildId);
    if (!config.blacklisted_languages.includes(langCode.toUpperCase())) {
      config.blacklisted_languages.push(langCode.toUpperCase());
      guildConfig.set(guildId, config);
    }
  },

  removeBlacklistedLanguage: (guildId, langCode) => {
    const config = guildConfig.get(guildId);
    config.blacklisted_languages = config.blacklisted_languages.filter(
      code => code !== langCode.toUpperCase()
    );
    guildConfig.set(guildId, config);
  }
};

// Moderation queries
export const moderation = {
  addAction: (guildId, userId, moderatorId, action, reason = null) => {
    const stmt = db.prepare(`
      INSERT INTO user_moderation (guild_id, user_id, moderator_id, action, reason)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(guildId, userId, moderatorId, action, reason);
  },

  getHistory: (guildId, userId) => {
    const stmt = db.prepare(`
      SELECT * FROM user_moderation
      WHERE guild_id = ? AND user_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(guildId, userId);
  },

  getTrial: (guildId, userId) => {
    const stmt = db.prepare('SELECT * FROM user_trials WHERE guild_id = ? AND user_id = ?');
    return stmt.get(guildId, userId) || {
      guild_id: guildId,
      user_id: userId,
      trial_stage: 1,
      warn_count: 0,
      ban_appeal_date: null
    };
  },

  updateTrial: (guildId, userId, trialStage, warnCount, banAppealDate = null) => {
    const stmt = db.prepare(`
      INSERT INTO user_trials (guild_id, user_id, trial_stage, warn_count, ban_appeal_date, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        trial_stage = excluded.trial_stage,
        warn_count = excluded.warn_count,
        ban_appeal_date = excluded.ban_appeal_date,
        updated_at = excluded.updated_at
    `);
    stmt.run(guildId, userId, trialStage, warnCount, banAppealDate);
  },

  clearWarnings: (guildId, userId) => {
    const stmt = db.prepare(`
      UPDATE user_trials
      SET warn_count = 0, updated_at = strftime('%s', 'now')
      WHERE guild_id = ? AND user_id = ?
    `);
    stmt.run(guildId, userId);
  }
};

export default db;
