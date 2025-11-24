import { moderation, botModeration, guildConfig } from '../database/db.js';

const TRIAL_CONFIG = {
  1: { maxWarns: 5, appealDays: 7 },
  2: { maxWarns: 4, appealDays: 14 },
  3: { maxWarns: 3, appealDays: 90 },
  4: { maxWarns: 5, appealDays: null }
};

export function processWarning(guildId, userId, moderatorId, reason) {
  const trial = moderation.getTrial(guildId, userId);
  const newWarnCount = trial.warn_count + 1;
  const currentStage = trial.trial_stage;
  const config = TRIAL_CONFIG[currentStage];
  
  const caseNumber = moderation.addActionWithCase(guildId, userId, moderatorId, 'warn', reason);
  
  if (newWarnCount >= config.maxWarns) {
    moderation.addActionWithCase(guildId, userId, moderatorId, 'ban', `Trial ${currentStage} completed`);
    
    let appealDate = null;
    if (config.appealDays !== null) {
      appealDate = Math.floor(Date.now() / 1000) + (config.appealDays * 24 * 60 * 60);
    }
    
    const nextStage = currentStage < 4 ? currentStage + 1 : 4;
    moderation.updateTrial(guildId, userId, nextStage, 0, appealDate);
    
    return {
      banned: true,
      trialStage: currentStage,
      warnCount: newWarnCount,
      appealDate: appealDate ? new Date(appealDate * 1000) : null,
      nextStage,
      caseNumber
    };
  } else {
    moderation.updateTrial(guildId, userId, currentStage, newWarnCount, trial.ban_appeal_date);
    
    return {
      banned: false,
      trialStage: currentStage,
      warnCount: newWarnCount,
      appealDate: null,
      nextStage: currentStage,
      caseNumber
    };
  }
}

export async function logModerationAction(guild, action, moderator, target, reason, caseNumber, duration = null) {
  const config = guildConfig.get(guild.id);
  if (!config.mod_log_channel_id) return;

  try {
    const channel = await guild.channels.fetch(config.mod_log_channel_id);
    if (!channel) {
      console.error(`Mod log channel ${config.mod_log_channel_id} not found in guild ${guild.id}`);
      return;
    }

    const { EmbedBuilder } = await import('discord.js');

    const actionColors = {
      warn: 0xFFAA00,
      mute: 0xFFAA00,
      unmute: 0x00FF00,
      kick: 0xFF6600,
      ban: 0xFF0000,
      unban: 0x00FF00,
      tempban: 0xFF0000,
      hackban: 0xFF0000,
      bot_warn: 0xFFAA00,
      bot_ban: 0xFF0000
    };

    const embed = new EmbedBuilder()
      .setColor(actionColors[action] || 0x5865F2)
      .setTitle(`${action.toUpperCase()} | Case #${caseNumber}`)
      .addFields(
        { name: 'User', value: `${target}`, inline: true },
        { name: 'Moderator', value: `${moderator.tag}`, inline: true }
      )
      .setTimestamp();

    if (reason) {
      embed.addFields({ name: 'Reason', value: reason });
    }

    if (duration) {
      embed.addFields({ name: 'Duration', value: formatDuration(duration) });
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to log moderation action:', error);
  }
}

export function getUserStats(guildId, userId) {
  const trial = moderation.getTrial(guildId, userId);
  const history = moderation.getHistory(guildId, userId);
  const config = TRIAL_CONFIG[trial.trial_stage];
  
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
    history: history.slice(0, 10)
  };
}

export function getTrialName(stage) {
  const names = {
    1: 'First Trial',
    2: 'Second Trial',
    3: 'Third Trial',
    4: 'Great Trial'
  };
  return names[stage] || 'Unknown';
}

export function clearUserWarnings(guildId, userId) {
  moderation.clearWarnings(guildId, userId);
}

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
