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
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      auto_translate_channels TEXT DEFAULT '[]',
      blacklisted_languages TEXT DEFAULT '[]',
      translation_provider TEXT DEFAULT 'lingva',
      mod_log_channel_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_moderation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      case_number INTEGER,
      duration INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(guild_id, user_id, id)
    )
  `);

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_moderation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      case_number INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      creator_id TEXT NOT NULL,
      claimer_id TEXT,
      channel_id TEXT,
      reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      closed_at INTEGER,
      UNIQUE(guild_id, ticket_number)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS case_numbers (
      guild_id TEXT PRIMARY KEY,
      last_case_number INTEGER DEFAULT 0
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
      translation_provider: 'lingva',
      mod_log_channel_id: null
    };
  },

  set: (guildId, config) => {
    const stmt = db.prepare(`
      INSERT INTO guild_config (guild_id, auto_translate_channels, blacklisted_languages, translation_provider, mod_log_channel_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        auto_translate_channels = excluded.auto_translate_channels,
        blacklisted_languages = excluded.blacklisted_languages,
        translation_provider = excluded.translation_provider,
        mod_log_channel_id = excluded.mod_log_channel_id
    `);
    stmt.run(
      guildId,
      JSON.stringify(config.auto_translate_channels || []),
      JSON.stringify(config.blacklisted_languages || []),
      config.translation_provider || 'lingva',
      config.mod_log_channel_id || null
    );
  },

  setModLogChannel: (guildId, channelId) => {
    const config = guildConfig.get(guildId);
    config.mod_log_channel_id = channelId;
    guildConfig.set(guildId, config);
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
  },

  getNextCaseNumber: (guildId) => {
    const stmt = db.prepare(`
      INSERT INTO case_numbers (guild_id, last_case_number)
      VALUES (?, 1)
      ON CONFLICT(guild_id) DO UPDATE SET
        last_case_number = last_case_number + 1
      RETURNING last_case_number
    `);
    const result = stmt.get(guildId);
    return result.last_case_number;
  },

  addActionWithCase: (guildId, userId, moderatorId, action, reason = null, duration = null) => {
    const caseNumber = moderation.getNextCaseNumber(guildId);
    const stmt = db.prepare(`
      INSERT INTO user_moderation (guild_id, user_id, moderator_id, action, reason, case_number, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(guildId, userId, moderatorId, action, reason, caseNumber, duration);
    return caseNumber;
  },

  getCaseById: (guildId, caseNumber) => {
    const stmt = db.prepare(`
      SELECT * FROM user_moderation
      WHERE guild_id = ? AND case_number = ?
    `);
    return stmt.get(guildId, caseNumber);
  }
};

export const botModeration = {
  addAction: (guildId, botId, moderatorId, action, reason = null) => {
    const caseNumber = moderation.getNextCaseNumber(guildId);
    const stmt = db.prepare(`
      INSERT INTO bot_moderation (guild_id, bot_id, moderator_id, action, reason, case_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(guildId, botId, moderatorId, action, reason, caseNumber);
    return caseNumber;
  },

  getHistory: (guildId, botId) => {
    const stmt = db.prepare(`
      SELECT * FROM bot_moderation
      WHERE guild_id = ? AND bot_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(guildId, botId);
  }
};

export const tickets = {
  create: (guildId, type, creatorId, reason) => {
    const stmt1 = db.prepare(`
      SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
      FROM tickets WHERE guild_id = ?
    `);
    const { next_number } = stmt1.get(guildId);
    
    const stmt2 = db.prepare(`
      INSERT INTO tickets (guild_id, ticket_number, type, creator_id, reason)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);
    const result = stmt2.get(guildId, next_number, type, creatorId, reason);
    return { id: result.id, ticketNumber: next_number };
  },

  setChannelId: (ticketId, channelId) => {
    const stmt = db.prepare(`
      UPDATE tickets SET channel_id = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(channelId, ticketId);
  },

  get: (ticketId) => {
    const stmt = db.prepare('SELECT * FROM tickets WHERE id = ?');
    return stmt.get(ticketId);
  },

  getByNumber: (guildId, ticketNumber) => {
    const stmt = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND ticket_number = ?');
    return stmt.get(guildId, ticketNumber);
  },

  getOpen: (guildId) => {
    const stmt = db.prepare(`
      SELECT * FROM tickets
      WHERE guild_id = ? AND status = 'open'
      ORDER BY created_at DESC
    `);
    return stmt.all(guildId);
  },

  claim: (ticketId, claimerId) => {
    const stmt = db.prepare(`
      UPDATE tickets 
      SET claimer_id = ?, updated_at = strftime('%s', 'now')
      WHERE id = ? AND status = 'open'
    `);
    stmt.run(claimerId, ticketId);
  },

  close: (ticketId) => {
    const stmt = db.prepare(`
      UPDATE tickets 
      SET status = 'closed', closed_at = strftime('%s', 'now'), updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(ticketId);
  },

  reopen: (ticketId) => {
    const stmt = db.prepare(`
      UPDATE tickets 
      SET status = 'open', closed_at = NULL, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(ticketId);
  },

  getAllByCreator: (guildId, creatorId) => {
    const stmt = db.prepare(`
      SELECT * FROM tickets
      WHERE guild_id = ? AND creator_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `);
    return stmt.all(guildId, creatorId);
  }
};

export default db;
