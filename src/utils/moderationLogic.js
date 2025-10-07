import { moderation } from '../database/db.js';

// Trial system configuration
const TRIAL_CONFIG = {
  1: { maxWarns: 5, appealDays: 7 },      // First Trial
  2: { maxWarns: 4, appealDays: 14 },     // Second Trial
  3: { maxWarns: 3, appealDays: 90 },     // Third Trial
  4: { maxWarns: 5, appealDays: null }    // Great Trial (permanent)
};

/**
 * Process a warning for a user
 * Returns: { banned: boolean, trialStage: number, warnCount: number, appealDate: Date|null }
 */
export function processWarning(guildId, userId, moderatorId, reason) {
  const trial = moderation.getTrial(guildId, userId);
  const newWarnCount = trial.warn_count + 1;
  const currentStage = trial.trial_stage;
  const config = TRIAL_CONFIG[currentStage];
  
  // Add warning to history
  moderation.addAction(guildId, userId, moderatorId, 'warn', reason);
  
  // Check if ban threshold reached
  if (newWarnCount >= config.maxWarns) {
    // Ban the user
    moderation.addAction(guildId, userId, moderatorId, 'ban', `Trial ${currentStage} completed`);
    
    // Calculate appeal date
    let appealDate = null;
    if (config.appealDays !== null) {
      appealDate = Math.floor(Date.now() / 1000) + (config.appealDays * 24 * 60 * 60);
    }
    
    // Move to next trial stage
    const nextStage = currentStage < 4 ? currentStage + 1 : 4;
    moderation.updateTrial(guildId, userId, nextStage, 0, appealDate);
    
    return {
      banned: true,
      trialStage: currentStage,
      warnCount: newWarnCount,
      appealDate: appealDate ? new Date(appealDate * 1000) : null,
      nextStage
    };
  } else {
    // Update warn count
    moderation.updateTrial(guildId, userId, currentStage, newWarnCount, trial.ban_appeal_date);
    
    return {
      banned: false,
      trialStage: currentStage,
      warnCount: newWarnCount,
      appealDate: null,
      nextStage: currentStage
    };
  }
}

/**
 * Get user's moderation stats
 */
export function getUserStats(guildId, userId) {
  const trial = moderation.getTrial(guildId, userId);
  const history = moderation.getHistory(guildId, userId);
  const config = TRIAL_CONFIG[trial.trial_stage];
  
  // Check if user can appeal
  let canAppeal = false;
  if (trial.ban_appeal_date) {
    const now = Math.floor(Date.now() / 1000);
    canAppeal = now >= trial.ban_appeal_date;
  }
  
  return {
    trialStage: trial.trial_stage,
    warnCount: trial.warn_count,
    maxWarns: config.maxWarns,
    warnsUntilBan: config.maxWarns - trial.warn_count,
    banAppealDate: trial.ban_appeal_date ? new Date(trial.ban_appeal_date * 1000) : null,
    canAppeal,
    isPermanent: trial.trial_stage === 4 && trial.ban_appeal_date === null,
    history: history.slice(0, 10) // Last 10 actions
  };
}

/**
 * Get trial stage name
 */
export function getTrialName(stage) {
  const names = {
    1: 'First Trial',
    2: 'Second Trial',
    3: 'Third Trial',
    4: 'Great Trial'
  };
  return names[stage] || 'Unknown';
}

/**
 * Clear user warnings (admin only)
 */
export function clearUserWarnings(guildId, userId) {
  moderation.clearWarnings(guildId, userId);
}

/**
 * Parse duration string (e.g., "1h", "30m", "1d")
 */
export function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };
  
  return value * (multipliers[unit] || 0);
}

/**
 * Format duration for display
 */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
